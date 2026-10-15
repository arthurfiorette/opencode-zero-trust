import { fork } from 'node:child_process';
import type { OpenCodeClient } from '@opencode/client';
import type { TunnelOptions } from './config.js';
import { CredentialsError, readTunnelID } from './credentials.js';
import { connectDaemon, DaemonError } from './daemon.js';
import { childEnvironment } from './environment.js';
import { helperStatusSchema, type StartMessage } from './helper-protocol.js';
import type { Pairing, Status } from './rpc.js';

const key = Symbol.for('opencode-zero-trust.manager.v1');
const shared = globalThis as typeof globalThis & { [key]?: TunnelManager };

export class ConfigurationConflict extends Error {
  constructor() {
    super(
      'This daemon already owns a tunnel with different options. Restart the daemon to change its configuration.'
    );
  }
}

export function getManager(options: TunnelOptions): TunnelManager {
  if (shared[key]) {
    if (shared[key].configuration !== JSON.stringify(options)) throw new ConfigurationConflict();
    return shared[key];
  }
  const manager = new TunnelManager(options);
  shared[key] = manager;
  return manager;
}

export class TunnelManager {
  readonly configuration: string;
  private current: Status;
  private client: OpenCodeClient | undefined;
  private readonly options: TunnelOptions;

  constructor(options: TunnelOptions) {
    this.options = options;
    this.configuration = JSON.stringify(options);
    this.current = {
      state: 'starting',
      hostname: options.hostname,
      url: `https://${options.hostname}`
    };
    void this.start().catch(() => this.fail('helper-unavailable'));
  }

  status(): Status {
    return { ...this.current };
  }

  async pair(): Promise<Pairing | undefined> {
    if (this.current.state !== 'ready' || !this.client) return undefined;
    const pairing = await this.client.server.pair();
    return {
      url: new URL(`/auth/connect/${encodeURIComponent(pairing.code)}`, this.current.url).href,
      expiresIn: pairing.expires_in
    };
  }

  private fail(error: NonNullable<Status['error']>) {
    this.current = {
      state: 'error',
      hostname: this.options.hostname,
      url: `https://${this.options.hostname}`,
      error
    };
  }

  private async start() {
    const tunnelID = await readTunnelID(this.options.credentialsFile).catch((error: unknown) => {
      this.fail(error instanceof CredentialsError ? error.code : 'credentials-invalid');
      return undefined;
    });
    if (!tunnelID) return;
    const daemon = await connectDaemon(
      this.options.serviceFile ? { serviceFile: this.options.serviceFile } : {}
    ).catch((error: unknown) => {
      this.fail(error instanceof DaemonError ? error.code : 'daemon-unavailable');
      return undefined;
    });
    if (!daemon) return;
    this.client = daemon.client;

    const helper = fork(new URL('./helper.js', import.meta.url), [], {
      execPath: this.options.nodePath,
      execArgv: [],
      env: childEnvironment(),
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      windowsHide: true
    });
    helper.on('message', (message: unknown) => {
      const result = helperStatusSchema.safeParse(message);
      if (!result.success) {
        this.fail('helper-protocol-error');
        if (helper.connected) helper.send({ type: 'stop' });
        return;
      }
      this.current = {
        state: result.data.state,
        hostname: this.options.hostname,
        url: `https://${this.options.hostname}`,
        ...(helper.pid ? { helperPid: helper.pid } : {}),
        ...(result.data.pid ? { connectorPid: result.data.pid } : {}),
        ...(result.data.error ? { error: result.data.error } : {})
      };
    });
    helper.on('error', () => this.fail('node-unavailable'));
    // A killed helper may leave its connector alive; do not blindly launch a second one.
    helper.on('exit', () => this.fail('helper-unavailable'));
    const message: StartMessage = {
      type: 'start',
      executable: this.options.cloudflaredPath,
      prefixArgs: [],
      config: {
        tunnel: tunnelID,
        'credentials-file': this.options.credentialsFile,
        ingress: [
          {
            hostname: this.options.hostname,
            service: daemon.url,
            originRequest: {
              access: {
                required: true,
                teamName: this.options.access.teamName,
                audTag: [this.options.access.audience]
              }
            }
          },
          { service: 'http_status:404' }
        ]
      }
    };
    helper.send(message, (error) => {
      if (error) this.fail('helper-unavailable');
      helper.channel?.unref();
    });
    helper.unref();
    helper.channel?.unref();
  }
}
