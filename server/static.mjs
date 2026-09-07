#!/usr/bin/env node
/**
 * 배포용 정적 서버 — dist/ 를 서빙한다. 의존성 0 (node:http 만 쓴다).
 *
 * DocDiff 는 전부 브라우저에서 도는 SPA 다. 서버는 파일을 내려주기만 하고
 * 문서 바이트는 절대 서버로 오지 않는다 (D-01).
 *
 * 두 가지를 견딘다.
 *  - 마운트 경로: /docdiff 같은 prefix 뒤에 붙어도, 리버스 프록시가 prefix 를
 *    떼든 안 떼든 양쪽 다 찾는다. (vite base 가 './' 라 자산은 상대경로다)
 *  - 새로고침: 자산이 아닌 경로는 index.html 로 떨어뜨린다.
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('../dist', import.meta.url)));
const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST || '0.0.0.0';

if (!existsSync(join(ROOT, 'index.html'))) {
  console.error(`dist 가 없습니다: ${ROOT}\n먼저 "npm run build" 를 실행하세요.`);
  process.exit(1);
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
};

/** dist 밖으로 나가는 경로는 전부 거절한다. */
function safeJoin(urlPath) {
  const decoded = decodeURIComponent(urlPath);
  const target = resolve(join(ROOT, normalize(decoded)));
  if (target !== ROOT && !target.startsWith(ROOT + sep)) return null;
  return target;
}

function fileAt(urlPath) {
  const p = safeJoin(urlPath);
  if (!p || !existsSync(p)) return null;
  const st = statSync(p);
  if (st.isDirectory()) return null;
  return { path: p, size: st.size, mtime: st.mtimeMs };
}

/**
 * 요청 경로를 dist 안의 파일로 푼다.
 * /docdiff/assets/x.js 처럼 마운트 prefix 가 붙어 온 경우를 위해
 * 앞 세그먼트를 하나씩 떼어 가며 찾는다.
 */
function resolveFile(urlPath) {
  const direct = fileAt(urlPath);
  if (direct) return direct;

  const segments = urlPath.split('/').filter(Boolean);
  for (let i = 1; i < segments.length; i++) {
    const hit = fileAt('/' + segments.slice(i).join('/'));
    if (hit) return hit;
  }
  return null;
}

const server = createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { allow: 'GET, HEAD' }).end();
    return;
  }

  const urlPath = (req.url || '/').split('?')[0].split('#')[0];
  let hit = resolveFile(urlPath);
  let fallback = false;

  if (!hit) {
    // 자산 확장자가 붙은 요청이 없으면 진짜 404 다. 나머지는 SPA 진입점으로.
    if (extname(urlPath)) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('404');
      return;
    }
    hit = fileAt('/index.html');
    fallback = true;
    if (!hit) {
      res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' }).end('index.html 없음');
      return;
    }
  }

  const ext = extname(hit.path).toLowerCase();
  const immutable = !fallback && ext !== '.html' && /-[\w-]{8,}\./.test(hit.path);

  res.writeHead(200, {
    'content-type': MIME[ext] || 'application/octet-stream',
    'content-length': hit.size,
    'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    'x-content-type-options': 'nosniff',
  });

  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  createReadStream(hit.path).pipe(res);
});

server.listen(PORT, HOST, () => {
  console.log(`DocDiff static server → http://${HOST}:${PORT} (${ROOT})`);
});
