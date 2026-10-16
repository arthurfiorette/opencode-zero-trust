import { createServer, Agent as HttpAgent, type ServerResponse } from 'node:http';
import { Agent as HttpsAgent } from 'node:https';
import type { Socket } from 'node:net';
import type { Duplex } from 'node:stream';
import httpProxy from 'http-proxy';

function targetUrl(value: string): string {
  try {
    const url = new URL(value);
    // Check the spelling too: URL normalizes numeric and abbreviated IPv4 hosts.
    if (
      !/^https?:\/\/(?:127\.\d{1,3}\.\d{1,3}\.\d{1,3}|\[::1\])(?::\d+)?\/?$/i.test(value) ||
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash ||
      (url.hostname !== '[::1]' && !/^127\.\d+\.\d+\.\d+$/.test(url.hostname))
    ) {
      throw new Error();
    }
    return url.origin;
  } catch {
    throw new Error('Invalid loopback proxy target');
  }
}

function badGateway(response: ServerResponse | Socket): void {
  if ('writeHead' in response) {
    if (!response.headersSent && !response.destroyed) {
      response.writeHead(502, { 'content-type': 'text/plain', connection: 'close' });
      response.end('Bad Gateway');
    } else {
      response.destroy();
    }
  } else {
    response.destroy();
  }
}

export async function startProxy(
  daemonUrl: string
): Promise<{ url: string; close(): Promise<void> }> {
  const target = targetUrl(daemonUrl);
  const sockets = new Set<Duplex>();
  let closing: Promise<void> | undefined;
  const track = (socket: Duplex) => {
    if (sockets.has(socket)) return;
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
    if (closing) socket.destroy();
  };
  const agent = target.startsWith('https:') ? new HttpsAgent() : new HttpAgent();
  const connect = agent.createConnection.bind(agent);
  // Track at connection creation, including Expect requests that skip proxyReq.
  agent.createConnection = (options, callback) => {
    const socket = connect(options, callback);
    if (socket) track(socket);
    return socket;
  };
  const proxy = httpProxy.createProxyServer({
    target,
    agent,
    changeOrigin: false,
    xfwd: false,
    secure: true
  });
  const server = createServer((request, response) => {
    request.on('error', () => response.destroy());
    proxy.web(request, response);
  });
  server.on('connection', track);
  server.on('upgrade', (request, socket, head) => {
    socket.on('error', () => socket.destroy());
    proxy.ws(request, socket, head);
  });
  proxy.on('error', (_error, _request, response) => badGateway(response));
  proxy.on('proxyReq', (upstream, request, response) => {
    // HTTP emits proxyReq from inside the socket event; it is already assigned.
    if (upstream.socket) track(upstream.socket);
    const abort = () => upstream.destroy();
    request.once('aborted', abort);
    // A completed request can still have a streaming response, including SSE.
    response.once('close', abort);
    upstream.once('close', () => {
      request.removeListener('aborted', abort);
      response.removeListener('close', abort);
    });
  });
  proxy.on('proxyReqWs', (upstream, request, socket) => {
    upstream.on('socket', track);
    upstream.once('upgrade', (_response, upstreamSocket) => {
      track(upstreamSocket);
      socket.once('close', () => upstreamSocket.destroy());
    });
    upstream.once('response', (response) => {
      response.on('error', () => socket.destroy());
      socket.once('close', () => response.destroy());
    });
    const abort = () => upstream.destroy();
    socket.once('close', abort);
    request.once('aborted', abort);
    upstream.once('close', () => request.removeListener('aborted', abort));
  });
  proxy.on('proxyRes', (upstream, _request, response) => {
    upstream.on('error', () => response.destroy());
    const abort = () => upstream.destroy();
    response.once('close', abort);
    upstream.once('close', () => response.removeListener('close', abort));
    const type = upstream.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase();
    // XHTML is an HTML document too; all other representations remain untouched.
    if (type !== 'text/html' && type !== 'application/xhtml+xml') return;
    const headers: Record<string, string | string[] | undefined> = upstream.headers;
    const cache = headers['cache-control'];
    const values = Array.isArray(cache) ? cache : [cache ?? ''];
    if (values.some((value) => /(?:^|,)\s*no-transform\s*(?:,|$)/i.test(value))) return;
    headers['cache-control'] = Array.isArray(cache)
      ? [...cache, 'no-transform']
      : cache?.trim()
        ? `${cache}, no-transform`
        : 'no-transform';
  });

  try {
    await new Promise<void>((resolve, reject) => {
      const failed = (error: Error) => {
        server.removeListener('listening', listening);
        reject(error);
      };
      const listening = () => {
        server.removeListener('error', failed);
        resolve();
      };
      server.once('error', failed);
      server.once('listening', listening);
      server.listen(0, '127.0.0.1');
    });
  } catch (error) {
    server.removeAllListeners();
    agent.destroy();
    proxy.close();
    proxy.removeAllListeners();
    throw error;
  }
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Proxy failed to listen');
  return {
    url: `http://127.0.0.1:${address.port}`,
    close() {
      closing ??= new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Proxy shutdown timed out')), 1000);
        const listenerClosed = new Promise<void>((done, failed) => {
          server.close((error) => (error ? failed(error) : done()));
        });
        const connectionsClosed = [...sockets].map(
          (socket) => new Promise<void>((done) => socket.once('close', done))
        );
        // http-proxy's close callback need not fire when it owns no listener.
        proxy.close();
        agent.destroy();
        for (const socket of sockets) socket.destroy();
        void Promise.all([listenerClosed, ...connectionsClosed]).then(
          () => {
            clearTimeout(timeout);
            resolve();
          },
          (error: unknown) => {
            clearTimeout(timeout);
            reject(error);
          }
        );
      });
      return closing;
    }
  };
}
