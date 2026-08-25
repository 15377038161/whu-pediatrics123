import { createServer } from 'node:http';
import { parse as parseQuery } from 'node:querystring';
import type { IncomingMessage } from 'node:http';
import type { UrlWithParsedQuery } from 'node:url';
import next from 'next';

if (!process.env.NODE_ENV) Reflect.set(process.env, 'NODE_ENV', 'production');
const dev = false;
const hostname = process.env.HOSTNAME || '127.0.0.1';
const port = Number.parseInt(process.env.PORT || '5000', 10);
const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

function parseRequestUrl(req: IncomingMessage): UrlWithParsedQuery {
  const url = new URL(req.url || '/', `http://${req.headers.host || `${hostname}:${port}`}`);
  return {
    protocol: null,
    slashes: null,
    auth: null,
    host: null,
    port: null,
    hostname: null,
    hash: url.hash || null,
    search: url.search || null,
    query: parseQuery(url.searchParams.toString()),
    pathname: url.pathname,
    path: `${url.pathname}${url.search}`,
    href: `${url.pathname}${url.search}${url.hash}`,
  };
}

function startSyncWorker(): void {
  const tick = async () => {
    const secret = process.env.SYNC_WORKER_SECRET?.trim();
    if (!secret) return;
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/internal/sync-chaoxing`, {
        method: 'POST',
        headers: { authorization: `Bearer ${secret}` },
        signal: AbortSignal.timeout(55_000),
      });
      if (!response.ok && response.status !== 503) {
        console.warn('[chaoxing-sync] unexpected status', response.status);
      }
    } catch (error) {
      console.warn('[chaoxing-sync] worker failed', error instanceof Error ? error.message : String(error));
    }
  };
  setTimeout(tick, 30_000);
  setInterval(tick, 5 * 60_000);
}

app.prepare().then(() => {
  const server = createServer(async (req, res) => {
    try {
      await handle(req, res, parseRequestUrl(req));
    } catch (error) {
      console.error('Request handling failed', req.url, error);
      res.statusCode = 500;
      res.end('Internal server error');
    }
  });
  server.listen(port, hostname, () => {
    console.log(`> Luojia Pediatrics Agent ready at http://${hostname}:${port}`);
    startSyncWorker();
  });
});
