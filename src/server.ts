import { createServer } from 'node:http';
import { parse as parseQuery } from 'node:querystring';
import type { IncomingMessage } from 'node:http';
import type { UrlWithParsedQuery } from 'node:url';
import next from 'next';

if (!process.env.NODE_ENV) Reflect.set(process.env, 'NODE_ENV', 'production');
const dev = false;
// HOSTNAME 在容器中是 pod 主机名（绑定后外部不可达），监听地址一律 0.0.0.0。
const hostname = process.env.HOST || '0.0.0.0';
// 平台端口优先 DEPLOY_RUN_PORT，其次 PORT，最后默认 5173（沙箱约定端口）。
const port = Number.parseInt(process.env.DEPLOY_RUN_PORT || process.env.PORT || '5173', 10);
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
    const startedAt = Date.now();
    // 沙箱网关会把「相对 Location」改写为代理前缀路径（/sandboxes/<id>/proxy/5173/...），
    // 而该前缀路径请求不会被网关剥离即透传给应用，导致浏览器 404。
    // 统一在出口处把相对 Location 补全为对外 https 绝对 URL，网关对绝对 Location 不做前缀改写。
    const originalSetHeader = res.setHeader.bind(res);
    res.setHeader = ((name: string, value: unknown) => {
      if (name.toLowerCase() === 'location' && typeof value === 'string' && !/^https?:\/\//i.test(value)) {
        const platform = process.env.CODER_PROJECTS_DOMAIN?.trim();
        const origin = platform
          ? (platform.startsWith('http') ? platform : `https://${platform}`)
          : `https://${req.headers.host || `${hostname}:${port}`}`;
        try {
          return originalSetHeader(name, new URL(value, origin).toString());
        } catch {
          /* 非法 Location 原样保留 */
        }
      }
      return originalSetHeader(name, value as never);
    }) as typeof res.setHeader;
    try {
      await handle(req, res, parseRequestUrl(req));
    } catch (error) {
      console.error('Request handling failed', req.url, error);
      res.statusCode = 500;
      res.end('Internal server error');
    } finally {
      // 全局请求日志：仅记录方法/路径/状态/耗时与 cookie 名（不含值），供部署后运行日志读取。
      const cookieNames = (req.headers.cookie || '').split(';').map((c) => c.split('=')[0].trim()).filter(Boolean).join(',');
      console.log(
        `[req] ${new Date().toISOString()} ${req.method} ${req.url?.split('?')[0]} -> ${res.statusCode} ${Date.now() - startedAt}ms cookies:${cookieNames || 'none'}`,
      );
    }
  });
  server.listen(port, hostname, () => {
    console.log(`> Luojia Pediatrics Agent ready at http://${hostname}:${port}`);
    startSyncWorker();
  });
});
