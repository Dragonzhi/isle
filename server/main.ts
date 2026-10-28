import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import * as fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { Store, AppError } from './store.ts';
import { hash } from './tasks.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mime: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

function equal(a: string, b: string) {
  const first = Buffer.from(a), second = Buffer.from(b);
  return first.length === second.length && timingSafeEqual(first, second);
}

async function body(req: http.IncomingMessage) {
  if (req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new AppError('API 只接受 application/json。', 415);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 32_768) throw new AppError('请求内容过长。', 413);
    chunks.push(chunk);
  }
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw 0;
    return parsed as Record<string, unknown>;
  } catch { throw new AppError('请求须为有效的 JSON 对象。'); }
}

export async function createApplication(options: { home: string; dev?: boolean; port?: number; reveal?: (directory: string) => Promise<void> }) {
  const store = new Store(options.home, options.reveal);
  await store.init();
  const token = randomBytes(32).toString('hex');
  const homeId = hash(path.resolve(options.home));
  const vite = options.dev ? await (await import('vite')).createServer({ root, server: { middlewareMode: true, hmr: false }, appType: 'custom' }) : undefined;
  let port = options.port ?? 4317;
  let origin = '';
  const server = http.createServer(async (req, res) => {
    const json = (value: unknown, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); };
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; font-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try {
      if (req.headers.host !== `127.0.0.1:${port}` || (req.headers.origin !== undefined && req.headers.origin !== origin) || req.headers['sec-fetch-site'] === 'cross-site') {
        throw new AppError('请求来源不受信任。请使用终端打印的本机地址。', 403);
      }
      const url = new URL(req.url ?? '/', origin);
      const cookieName = `isle_session_${port}`;
      if (url.pathname === '/_instance' && req.method === 'GET') {
        // Only a local non-browser launcher can discover an existing instance. No CORS permission is granted.
        if (req.headers['x-isle-launcher'] !== '1' || req.headers.origin || req.headers['sec-fetch-mode']) throw new AppError('禁止访问。', 403);
        json({ app: 'isle-v0.1', homeId, url: `${origin}/?token=${token}` }); return;
      }
      if (url.pathname === '/' && req.method === 'GET' && url.searchParams.has('token')) {
        if (!equal(url.searchParams.get('token') ?? '', token)) throw new AppError('启动链接已失效，请使用当前终端中的地址。', 401);
        res.writeHead(303, { Location: '/', 'Set-Cookie': `${cookieName}=${token}; HttpOnly; SameSite=Strict; Path=/` }); res.end(); return;
      }
      const cookie = req.headers.cookie?.split(';').map(value => value.trim()).find(value => value.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1) ?? '';
      if (!equal(cookie, token)) {
        if (url.pathname.startsWith('/api/')) throw new AppError('会话已失效，请用终端中的启动地址重新打开。', 401);
        res.writeHead(401, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>案屿 · 请使用启动地址</title><body><h1>案屿</h1><p>请使用启动终端中打印的完整地址打开看板。</p></body></html>'); return;
      }
      if (url.pathname.startsWith('/api/')) {
        if (req.method === 'GET' && url.pathname === '/api/projects') { json(await store.snapshot()); return; }
        const gitRoute = url.pathname.match(/^\/api\/projects\/([a-f0-9]{24})\/git$/);
        if (req.method === 'GET' && gitRoute) { json(await store.gitHistory(gitRoute[1])); return; }
        const skillRoute = url.pathname.match(/^\/api\/projects\/([a-f0-9]{24})\/skill$/);
        if (req.method === 'GET' && skillRoute) { json(await store.projectSkill(skillRoute[1])); return; }
        const revealRoute = url.pathname.match(/^\/api\/projects\/([a-f0-9]{24})\/reveal$/);
        if (revealRoute) {
          if (req.method !== 'POST') throw new AppError('不支持的请求方式。', 405);
          if (req.headers.origin !== origin) throw new AppError('打开目录的请求必须来自案屿页面。', 403);
          await body(req);
          json(await store.openProjectDirectory(revealRoute[1])); return;
        }
        const branchRoute = url.pathname.match(/^\/api\/projects\/([a-f0-9]{24})\/branches$/);
        if (req.method === 'GET' && branchRoute) { json(await store.branches(branchRoute[1])); return; }
        const workspaceRoute = url.pathname.match(/^\/api\/projects\/([a-f0-9]{24})\/workspaces$/);
        if (req.method === 'GET' && workspaceRoute) { json(await store.workspaces(workspaceRoute[1])); return; }
        const taskRoute = url.pathname.match(/^\/api\/projects\/([a-f0-9]{24})\/tasks$/);
        if (!['POST', 'PATCH', 'DELETE'].includes(req.method ?? '')) throw new AppError('不支持的请求方式。', 405);
        if (req.headers.origin !== origin) throw new AppError('写入请求必须来自案屿页面。', 403);
        const input = await body(req);
        if (req.method === 'PATCH' && taskRoute) { json(await store.editTask(taskRoute[1], input.line, input.action, input.hash, input.title)); return; }
        if (req.method === 'POST' && workspaceRoute) { json(await store.addWorkspace(workspaceRoute[1], { path: input.path, name: input.name, registryHash: input.registryHash, installSkill: input.installSkill }), 201); return; }
        if (req.method === 'POST' && skillRoute) { json(await store.installProjectSkill(skillRoute[1])); return; }
        if (req.method === 'PATCH' && url.pathname === '/api/agents') { json(await store.saveAgents(input.agents, input.settingsHash)); return; }
        if (req.method === 'POST' && url.pathname === '/api/projects') { json(await store.register({ path: input.path, name: input.name, registryHash: input.registryHash, installSkill: input.installSkill }), 201); return; }
        const match = url.pathname.match(/^\/api\/projects\/([a-f0-9]{24})(\/repoint)?$/);
        if (!match) throw new AppError('接口不存在。', 404);
        if (match[2] && req.method === 'POST') { json(await store.register({ path: input.path, name: input.name, registryHash: input.registryHash, replaceId: match[1], installSkill: input.installSkill })); return; }
        if (!match[2] && req.method === 'PATCH') {
          if (!Object.hasOwn(input, 'next') && !Object.hasOwn(input, 'summary')) throw new AppError('请提供下一步或交接摘要。');
          json(await store.editRecord(match[1], { next: input.next, summary: input.summary }, input.hash)); return;
        }
        if (!match[2] && req.method === 'DELETE') { json(await store.remove(match[1], input.registryHash)); return; }
        throw new AppError('不支持的请求方式。', 405);
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') throw new AppError('不支持的请求方式。', 405);
      if (vite) {
        if (url.pathname === '/' || url.pathname === '/index.html') {
          const html = await vite.transformIndexHtml('/', await fs.readFile(path.join(root, 'index.html'), 'utf8'));
          res.writeHead(200, { 'Content-Type': mime['.html'] }); res.end(html); return;
        }
        vite.middlewares(req, res, () => { res.writeHead(404); res.end(); }); return;
      }
      const relative = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
      const file = path.resolve(root, 'dist', relative);
      if (!file.startsWith(path.join(root, 'dist') + path.sep) || !mime[path.extname(file)]) throw new AppError('页面不存在。', 404);
      try {
        const data = await fs.readFile(file);
        res.writeHead(200, { 'Content-Type': mime[path.extname(file)] }); res.end(req.method === 'HEAD' ? undefined : data);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new AppError('尚未构建页面，请先运行 npm run build。', 404);
        throw error;
      }
    } catch (error) {
      const status = error instanceof AppError ? error.status : 500;
      const message = error instanceof AppError ? error.message : '操作失败，请检查目录权限或文件是否被其他程序占用。';
      if (!res.headersSent) json({ error: message }, status);
      else res.end();
    }
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  return {
    server, store, token, homeId,
    async listen(requestedPort = port) {
      port = requestedPort;
      await new Promise<void>((resolve, reject) => {
        const onError = (error: Error) => { server.off('listening', onListening); reject(error); };
        const onListening = () => { server.off('error', onError); resolve(); };
        server.once('error', onError); server.once('listening', onListening); server.listen(port, '127.0.0.1');
      });
      port = (server.address() as import('node:net').AddressInfo).port;
      origin = `http://127.0.0.1:${port}`;
      return `${origin}/?token=${token}`;
    },
    async close() { await vite?.close(); server.closeAllConnections(); if (server.listening) await new Promise<void>(resolve => server.close(() => resolve())); },
  };
}

export async function main(): Promise<string> {
  const home = process.env.ISLE_HOME || path.join(os.homedir(), '.isle');
  const basePort = Number(process.env.ISLE_PORT || 4317);
  if (!Number.isInteger(basePort) || basePort < 1024 || basePort > 65535) throw new Error('ISLE_PORT 须为 1024–65535 的整数。');
  const app = await createApplication({ home, dev: process.argv.includes('--dev'), port: basePort });
  for (let port = basePort; port < Math.min(basePort + 20, 65536); port++) {
    try {
      const url = await app.listen(port);
      console.log(`\n案屿 v0.1 · 本机看板\n\n  ${url}\n\n清单：${app.store.registryFile}\n按 Ctrl+C 退出。\n`);
      const stop = async () => { await app.close(); process.exit(0); };
      process.once('SIGINT', stop); process.once('SIGTERM', stop);
      return url;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw error;
      try {
        // Node fetch adds Sec-Fetch-Mode, which is intentionally rejected by the launcher endpoint.
        const instance = await new Promise<{ app?: string; homeId?: string; url?: string }>((resolve, reject) => {
          const request = http.get(`http://127.0.0.1:${port}/_instance`, { headers: { 'X-Isle-Launcher': '1' } }, response => {
            let text = '';
            response.setEncoding('utf8');
            response.on('data', chunk => { text += chunk; if (text.length > 4096) response.destroy(new Error('响应过长。')); });
            response.on('error', reject);
            response.on('end', () => { try { resolve(JSON.parse(text)); } catch (error) { reject(error); } });
          });
          request.setTimeout(800, () => request.destroy(new Error('探测超时。')));
          request.on('error', reject);
        });
        if (instance.app === 'isle-v0.1' && instance.homeId === app.homeId && instance.url) {
          console.log(`案屿已在运行：\n${instance.url}`); await app.close(); return instance.url;
        }
      } catch { /* The port belongs to another app; try the next loopback port. */ }
    }
  }
  await app.close();
  throw new Error('连续 20 个端口被占用，请用 ISLE_PORT 指定其他端口。');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
