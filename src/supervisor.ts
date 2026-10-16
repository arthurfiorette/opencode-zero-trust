import { type ChildProcess, spawn } from 'node:child_process';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import type { Readable } from 'node:stream';
import { childDirectory, childEnvironment } from './environment.js';
import type { HelperStatus, StartMessage } from './helper-protocol.js';
import { startProxy } from './proxy.js';

function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      resolve();
    };
    const timer = setTimeout(finish, milliseconds);
    signal.addEventListener('abort', finish, { once: true });
  });
}

const metricsAnnouncement = /Starting metrics server on 127\.0\.0\.1:(\d{1,5})\/metrics/;

// cloudflared binds an ephemeral port itself, so only its own stderr can say where readiness is served.
// Choosing a port here first would let another local process claim it and fake readiness.
function announcedMetricsPort(stream: Readable, signal: AbortSignal): Promise<number | undefined> {
  return new Promise((resolve) => {
    const finish = () => resolve(undefined);
    signal.addEventListener('abort', finish, { once: true });
    stream.once('error', finish);
    // Keep reading after the announcement so connector logs never fill the pipe.
    const lines = createInterface({ input: stream, crlfDelay: Number.POSITIVE_INFINITY });
    lines.on('line', (line) => {
      const port = Number(metricsAnnouncement.exec(line)?.[1]);
      if (port > 0 && port < 65_536) resolve(port);
    });
    lines.once('close', finish);
  });
}

async function monitorReadiness(
  port: number,
  pid: number,
  report: (status: HelperStatus) => void,
  signal: AbortSignal
): Promise<void> {
  let previous = false;
  while (!signal.aborted) {
    let ready = false;
    try {
      const response = await fetch(`http://127.0.0.1:${port}/ready`, {
        redirect: 'error',
        signal: AbortSignal.any([signal, AbortSignal.timeout(750)])
      });
      ready = response.status === 200;
      await response.body?.cancel();
    } catch {
      // An unreachable metrics endpoint is never evidence of readiness.
      ready = false;
    }
    if (signal.aborted) return;
    if (ready !== previous) {
      report({ state: ready ? 'ready' : 'connecting', pid });
      previous = ready;
    }
    await delay(500, signal);
  }
}

async function runConnector(
  message: StartMessage,
  configFile: string,
  report: (status: HelperStatus) => void,
  signal: AbortSignal
): Promise<{ started: boolean; lifetime: number }> {
  if (signal.aborted) return { started: false, lifetime: 0 };
  const startedAt = Date.now();
  let child: ChildProcess;
  try {
    child = spawn(
      message.executable,
      [
        ...message.prefixArgs,
        'tunnel',
        '--config',
        configFile,
        '--no-autoupdate',
        '--metrics',
        '127.0.0.1:0',
        '--grace-period',
        '2s',
        '--loglevel',
        'info',
        'run',
        message.config.tunnel
      ],
      {
        cwd: childDirectory(),
        env: childEnvironment(),
        stdio: ['ignore', 'ignore', 'pipe'],
        windowsHide: true
      }
    );
  } catch {
    return { started: false, lifetime: 0 };
  }

  const monitor = new AbortController();
  let killTimer: ReturnType<typeof setTimeout> | undefined;
  const terminate = () => {
    monitor.abort();
    child.kill('SIGTERM');
    // cloudflared gets its configured two-second drain before forced termination.
    killTimer = setTimeout(() => child.kill('SIGKILL'), 2500);
  };
  const exited = new Promise<void>((resolve) => {
    child.on('error', () => {
      if (child.pid === undefined) resolve();
    });
    child.once('exit', () => resolve());
  });
  signal.addEventListener('abort', terminate, { once: true });
  if (signal.aborted) terminate();
  const pid = child.pid;
  if (pid) report({ state: 'connecting', pid });
  const monitoring =
    pid && child.stderr
      ? announcedMetricsPort(child.stderr, monitor.signal).then((port) =>
          port === undefined ? undefined : monitorReadiness(port, pid, report, monitor.signal)
        )
      : Promise.resolve();
  await exited;
  monitor.abort();
  if (killTimer) clearTimeout(killTimer);
  signal.removeEventListener('abort', terminate);
  await monitoring;
  return { started: pid !== undefined, lifetime: Date.now() - startedAt };
}

export async function supervise(
  message: StartMessage,
  report: (status: HelperStatus) => void,
  signal: AbortSignal
): Promise<void> {
  let directory: string | undefined;
  let proxy: Awaited<ReturnType<typeof startProxy>> | undefined;
  try {
    if (signal.aborted) return;
    const config = structuredClone(message.config);
    if (message.preventTransform) {
      proxy = await startProxy(config.ingress[0].service);
      config.ingress[0].service = proxy.url;
    }
    if (signal.aborted) return;
    directory = await mkdtemp(join(tmpdir(), 'opencode-zero-trust-'));
    await chmod(directory, 0o700);
    const configFile = join(directory, 'config.json');
    await writeFile(configFile, JSON.stringify(config), { mode: 0o600 });
    let backoff = 500;
    while (!signal.aborted) {
      const result = await runConnector(message, configFile, report, signal);
      if (signal.aborted) return;
      report({
        state: 'restarting',
        error: result.started ? 'cloudflared-exited' : 'cloudflared-unavailable'
      });
      if (result.lifetime >= 30_000) backoff = 500;
      await delay(backoff, signal);
      backoff = Math.min(backoff * 2, 10_000);
    }
  } catch {
    if (!signal.aborted) report({ state: 'error', error: 'helper-unavailable' });
  } finally {
    await proxy?.close();
    if (directory) {
      try {
        await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      } catch {
        report({ state: 'error', error: 'helper-unavailable' });
      }
    }
  }
}
