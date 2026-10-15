import { appendFileSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';

const [directory, ...args] = process.argv.slice(2);
const option = (name) => args[args.indexOf(name) + 1];
const configFile = option('--config');
const config = JSON.parse(readFileSync(configFile, 'utf8'));
const behavior = JSON.parse(readFileSync(join(directory, 'behavior.json'), 'utf8'));
const [host, port] = option('--metrics').split(':');

if (behavior.ignoreTerm) process.on('SIGTERM', () => {});

// These deliberately sensitive lines must never reach the helper's parent.
console.log('FAKE_CONNECTOR_SECRET_STDOUT');
console.error('FAKE_CONNECTOR_SECRET_STDERR');

const server = createServer((request, response) => {
  const state = readFileSync(join(directory, 'ready'), 'utf8');
  if (state === 'offline') {
    request.socket.destroy();
    return;
  }
  response.writeHead(request.url === '/ready' && state === 'ready' ? 200 : 503);
  response.end();
});

server.listen(Number(port), host, () => {
  const record = {
    pid: process.pid,
    at: Date.now(),
    args,
    configFile,
    config,
    configMode: statSync(configFile).mode & 0o777,
    directoryMode: statSync(join(configFile, '..')).mode & 0o777,
    env: process.env
  };
  appendFileSync(join(directory, 'runs.jsonl'), `${JSON.stringify(record)}\n`);
  if (behavior.crash) setTimeout(() => process.exit(23), 100);
});
