import { type HelperStatus, helperStatusSchema, startMessageSchema } from './helper-protocol.js';
import { supervise } from './supervisor.js';

const controller = new AbortController();
let running: Promise<void> | undefined;
let pendingReport: Promise<void> | undefined;
let stopping = false;

function report(status: HelperStatus): void {
  if (!process.connected) return;
  pendingReport = new Promise((resolve) => {
    process.send?.(helperStatusSchema.parse(status), (error) => {
      resolve();
      if (error) void stop();
    });
  });
}

async function stop(): Promise<void> {
  if (stopping) return;
  stopping = true;
  controller.abort();
  await running;
  await pendingReport;
  process.exit(0);
}

process.on('disconnect', () => void stop());
process.on('SIGTERM', () => void stop());
process.on('SIGINT', () => void stop());
process.on('message', (message) => {
  if (
    message &&
    typeof message === 'object' &&
    'type' in message &&
    message.type === 'stop' &&
    Object.keys(message).length === 1
  ) {
    void stop();
    return;
  }
  if (stopping || running) return;
  const parsed = startMessageSchema.safeParse(message);
  if (!parsed.success) {
    report({ state: 'error', error: 'helper-protocol-error' });
    void stop();
    return;
  }
  running = supervise(parsed.data, report, controller.signal);
  void running.finally(() => stop());
});

if (!process.connected) void stop();
