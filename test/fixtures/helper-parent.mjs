import { fork } from 'node:child_process';
import { readFileSync } from 'node:fs';

const [helperFile, messageFile] = process.argv.slice(2);
const helper = fork(helperFile, [], {
  stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  detached: process.platform === 'win32',
  windowsHide: true
});
helper.on('message', (message) => process.send?.(message));
helper.send(JSON.parse(readFileSync(messageFile, 'utf8')));
process.send?.({ type: 'parent-ready', pid: helper.pid });
