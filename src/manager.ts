import { type ChildProcess, fork } from 'node:child_process';
import type { OpenCodeClient } from '@opencode/client';
import type { TunnelOptions } from './config.js';
import { CredentialsError, findCredentialsFile, readTunnelID } from './credentials.js';
import { connectDaemon, DaemonError } from './daemon.js';
import { DnsError, ensureDNS } from './dns.js';
import { childDirectory, childEnvironment } from './environment.js';
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
  private dns: NonNullable<Status['dns']> = 'unchecked';
  private initializationAbort = new AbortController();
  private generation = 0;
  private restartBlocked = false;
  private disabled = false;
  private disabling: Promise<Status> | undefined;
  private helper: ChildProcess | undefined;
  private helperExit: Promise<boolean> | undefined;

  constructor(options: TunnelOptions) {
    this.options = options;
    this.configuration = JSON.stringify(options);
    this.current = {
      state: 'stopped',
      dns: this.dns,
      hostname: options.hostname,
      url: `https://${options.hostname}`
    };
    if (options.autoStart !== false) void this.connect();
  }

  status(): Status {
    return { ...this.current };
  }

  async connect(): Promise<Status> {
    if (this.disabling) await this.disabling;
    if (this.restartBlocked) throw new Error('Restart the daemon before connecting again.');
    if (
      this.helper ||
      ['starting', 'connecting', 'ready', 'restarting'].includes(this.current.state)
    ) {
      return this.status();
    }
    this.disabling = undefined;
    this.disabled = false;
    this.helper = undefined;
    this.helperExit = undefined;
    this.client = undefined;
    this.dns = 'unchecked';
    this.initializationAbort = new AbortController();
    const generation = ++this.generation;
    this.current = {
      state: 'starting',
      dns: this.dns,
      hostname: this.options.hostname,
      url: `https://${this.options.hostname}`
    };
    void this.start(generation, this.initializationAbort.signal).catch(() =>
      this.fail('helper-unavailable', generation)
    );
    return this.status();
  }

  disable(): Promise<Status> {
    if (this.disabling) return this.disabling.then(() => this.status());
    if (this.disabled && this.current.state === 'stopped') return Promise.resolve(this.status());
    this.disabled = true;
    ++this.generation;
    this.initializationAbort.abort();
    this.client = undefined;
    this.current = { ...this.current, state: 'stopping' };
    this.disabling = this.stopHelper().then(
      () => {
        this.disabling = undefined;
        this.helper = undefined;
        this.helperExit = undefined;
        this.current = {
          state: 'stopped',
          dns: this.dns,
          hostname: this.options.hostname,
          url: `https://${this.options.hostname}`
        };
        return this.status();
      },
      () => {
        this.restartBlocked = true;
        this.current = { ...this.current, state: 'error', error: 'helper-unavailable' };
        throw new Error('Could not stop the tunnel helper.');
      }
    );
    return this.disabling.then(() => this.status());
  }

  private async stopHelper(): Promise<void> {
    const helper = this.helper;
    if (!helper) return;
    // Disconnect only the owned IPC handle. A stale PID cannot prove connector cleanup.
    if (helper.connected) helper.disconnect();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const exited = await Promise.race([
        this.helperExit,
        new Promise<false>((resolve) => {
          timer = setTimeout(() => resolve(false), 5000);
        })
      ]);
      if (!exited) throw new Error('Could not stop the tunnel helper.');
    } finally {
      clearTimeout(timer);
    }
  }

  async pair(): Promise<Pairing | undefined> {
    if (this.current.state !== 'ready' || !this.client) return undefined;
    const generation = this.generation;
    const pairing = await this.client.server.pair();
    if (!this.isCurrent(generation)) return undefined;
    return {
      url: new URL(`/auth/connect/${encodeURIComponent(pairing.code)}`, this.current.url).href,
      expiresIn: pairing.expires_in
    };
  }

  private isCurrent(generation: number): boolean {
    // Reconnect clears disabled, so old asynchronous work also needs a run identity.
    return !this.disabled && generation === this.generation;
  }

  private fail(error: NonNullable<Status['error']>, generation: number) {
    if (!this.isCurrent(generation)) return;
    this.current = {
      state: 'error',
      dns: this.dns,
      hostname: this.options.hostname,
      url: `https://${this.options.hostname}`,
      error
    };
  }

  private async start(generation: number, signal: AbortSignal) {
    const credentials = await (async () => {
      const file = this.options.credentialsFile ?? (await findCredentialsFile());
      if (!this.isCurrent(generation)) return undefined;
      return { file, tunnelID: await readTunnelID(file) };
    })().catch((error: unknown) => {
      this.fail(error instanceof CredentialsError ? error.code : 'credentials-invalid', generation);
      return undefined;
    });
    if (!this.isCurrent(generation) || !credentials) return;
    const daemon = await connectDaemon(
      this.options.serviceFile ? { serviceFile: this.options.serviceFile } : {}
    ).catch((error: unknown) => {
      this.fail(error instanceof DaemonError ? error.code : 'daemon-unavailable', generation);
      return undefined;
    });
    if (!this.isCurrent(generation) || !daemon) return;
    if (this.options.autoDns) {
      const dns = await ensureDNS({
        hostname: this.options.hostname,
        tunnelID: credentials.tunnelID,
        cloudflaredPath: this.options.cloudflaredPath,
        signal
      }).catch((error: unknown) => {
        this.fail(error instanceof DnsError ? error.code : 'dns-check-failed', generation);
        return undefined;
      });
      if (!this.isCurrent(generation) || !dns) return;
      this.dns = dns;
      this.current = { ...this.current, dns };
    }
    this.client = daemon.client;

    const helper = fork(new URL('./helper.js', import.meta.url), [], {
      execPath: this.options.nodePath,
      execArgv: [],
      cwd: childDirectory(),
      env: childEnvironment(),
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      // Windows otherwise kills the helper with the daemon's child-process job before IPC cleanup can run.
      detached: process.platform === 'win32',
      windowsHide: true
    });
    this.helper = helper;
    this.helperExit = new Promise((resolve) => {
      helper.once('exit', (code, signal) => resolve(code === 0 && signal === null));
      helper.once('error', () => {
        if (!helper.pid) resolve(true);
      });
    });
    helper.on('message', (message: unknown) => {
      if (!this.isCurrent(generation)) return;
      const result = helperStatusSchema.safeParse(message);
      if (!result.success) {
        this.fail('helper-protocol-error', generation);
        if (helper.connected) helper.send({ type: 'stop' });
        return;
      }
      this.current = {
        state: result.data.state,
        dns: this.dns,
        hostname: this.options.hostname,
        url: `https://${this.options.hostname}`,
        ...(helper.pid ? { helperPid: helper.pid } : {}),
        ...(result.data.pid ? { connectorPid: result.data.pid } : {}),
        ...(result.data.error ? { error: result.data.error } : {})
      };
    });
    helper.on('error', () => this.fail('node-unavailable', generation));
    // A killed helper may leave its connector alive; do not blindly launch a second one.
    helper.on('exit', () => {
      if (this.isCurrent(generation)) this.restartBlocked = true;
      this.fail('helper-unavailable', generation);
    });
    const message: StartMessage = {
      type: 'start',
      executable: this.options.cloudflaredPath,
      prefixArgs: [],
      ...(this.options.preventTransform ? { preventTransform: true } : {}),
      config: {
        tunnel: credentials.tunnelID,
        'credentials-file': credentials.file,
        ingress: [
          {
            hostname: this.options.hostname,
            service: daemon.url,
            ...(this.options.access
              ? {
                  originRequest: {
                    access: {
                      required: true,
                      teamName: this.options.access.teamName,
                      audTag: [this.options.access.audience]
                    }
                  }
                }
              : {})
          },
          { service: 'http_status:404' }
        ]
      }
    };
    helper.send(message, (error) => {
      if (error) this.fail('helper-unavailable', generation);
      helper.channel?.unref?.();
    });
    helper.unref();
    helper.channel?.unref?.();
  }
}
