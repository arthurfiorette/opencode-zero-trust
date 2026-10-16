import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { OpenCode, type OpenCodeClient } from '@opencode/client';
import { Service } from '@opencode/client/service';

type DaemonErrorCode =
  | 'daemon-unavailable'
  | 'daemon-mismatch'
  | 'daemon-auth-required'
  | 'daemon-not-loopback';

export class DaemonError extends Error {
  readonly code: DaemonErrorCode;

  constructor(code: DaemonErrorCode) {
    super(code);
    this.name = 'DaemonError';
    this.code = code;
  }
}

function loopbackUrl(value: string): string {
  try {
    const url = new URL(value);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      !/^https?:\/\/[^/?#]+\/?$/i.test(value) ||
      url.username ||
      url.password ||
      /^[a-z]+:\/\/[^/?#]*@/i.test(value) ||
      url.pathname !== '/' ||
      value.includes('?') ||
      value.includes('#')
    ) {
      throw new DaemonError('daemon-not-loopback');
    }
    if (url.hostname === 'localhost') url.hostname = '127.0.0.1';
    if (url.hostname !== '[::1]' && !/^127\.\d+\.\d+\.\d+$/.test(url.hostname)) {
      throw new DaemonError('daemon-not-loopback');
    }
    return url.origin;
  } catch {
    throw new DaemonError('daemon-not-loopback');
  }
}

export async function connectDaemon(
  options: { serviceFile?: string } = {}
): Promise<{ client: OpenCodeClient; url: string }> {
  try {
    const file =
      options.serviceFile ??
      join(
        process.env.XDG_STATE_HOME ?? join(homedir(), '.local', 'state'),
        'opencode',
        'service.json'
      );
    // Discovery probes before returning, so reject unsafe registrations before it can send auth.
    const registration: unknown = JSON.parse(await readFile(file, 'utf8'));
    if (
      !registration ||
      typeof registration !== 'object' ||
      !('url' in registration) ||
      typeof registration.url !== 'string'
    ) {
      throw new DaemonError('daemon-unavailable');
    }
    const registeredUrl = loopbackUrl(registration.url);
    // A stale registration's port may belong to another local user, who would receive the probe's auth.
    if (!('pid' in registration) || registration.pid !== process.pid) {
      throw new DaemonError('daemon-mismatch');
    }
    const endpoint = await Service.discover({ file });
    if (!endpoint) throw new DaemonError('daemon-unavailable');
    const url = loopbackUrl(endpoint.url);
    if (url !== registeredUrl) throw new DaemonError('daemon-unavailable');
    if (endpoint.auth?.type !== 'basic' || !endpoint.auth.password) {
      throw new DaemonError('daemon-auth-required');
    }

    const headers = Service.headers({ url, auth: endpoint.auth });
    const client = OpenCode.make({
      baseUrl: url,
      headers,
      fetch: async (input, init) => {
        try {
          const timeout = AbortSignal.timeout(5000);
          const response = await fetch(input, {
            ...init,
            redirect: 'error',
            signal: init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout
          });
          if (!response.ok) {
            await response.body?.cancel();
            throw new DaemonError('daemon-unavailable');
          }
          return response;
        } catch {
          throw new DaemonError('daemon-unavailable');
        }
      }
    });
    const info = await client.server.info();
    if (info.pid !== process.pid) throw new DaemonError('daemon-mismatch');
    return { client, url };
  } catch (error) {
    if (error instanceof DaemonError) throw error;
    // Native errors may contain registration contents, URLs, auth, or response payloads.
    throw new DaemonError('daemon-unavailable');
  }
}
