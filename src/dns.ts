import childProcess from 'node:child_process';
import { Resolver } from 'node:dns/promises';
import { childEnvironment } from './environment.js';

export class DnsError extends Error {
  readonly code: 'dns-check-failed' | 'dns-route-failed';

  constructor(code: DnsError['code']) {
    super(code);
    this.code = code;
  }
}

export async function ensureDNS(options: {
  hostname: string;
  tunnelID: string;
  cloudflaredPath: string;
  signal?: AbortSignal;
}): Promise<'resolved' | 'created'> {
  if (options.signal?.aborted) throw new DnsError('dns-check-failed');
  let missing = false;
  try {
    const resolver = new Resolver({ timeout: 2000, tries: 1 });
    const cancel = () => resolver.cancel();
    options.signal?.addEventListener('abort', cancel, { once: true });
    try {
      const answers = await Promise.allSettled([
        resolver.resolve4(options.hostname),
        resolver.resolve6(options.hostname),
        resolver.resolveCname(options.hostname)
      ]);
      if (options.signal?.aborted) throw new DnsError('dns-check-failed');
      if (answers.some((answer) => answer.status === 'fulfilled' && answer.value.length > 0)) {
        return 'resolved';
      }
      // A transient failure must never be interpreted as permission to create a record.
      missing = answers.every(
        (answer) =>
          answer.status === 'rejected' &&
          (answer.reason?.code === 'ENODATA' || answer.reason?.code === 'ENOTFOUND')
      );
    } finally {
      options.signal?.removeEventListener('abort', cancel);
      resolver.cancel();
    }
  } catch {
    throw new DnsError('dns-check-failed');
  }
  if (!missing) throw new DnsError('dns-check-failed');
  if (options.signal?.aborted) throw new DnsError('dns-check-failed');

  try {
    await new Promise<void>((resolve, reject) => {
      childProcess.execFile(
        options.cloudflaredPath,
        ['tunnel', 'route', 'dns', options.tunnelID, options.hostname],
        {
          shell: false,
          timeout: 20_000,
          maxBuffer: 64 * 1024,
          windowsHide: true,
          env: childEnvironment(),
          ...(options.signal ? { signal: options.signal } : {})
        },
        (error) => (error ? reject(error) : resolve())
      );
    });
  } catch {
    throw new DnsError('dns-route-failed');
  }
  // CLI success does not establish public DNS propagation or connector readiness.
  return 'created';
}
