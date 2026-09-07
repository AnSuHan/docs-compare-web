#!/usr/bin/env node
/**
 * T-007 — D-01("파일은 서버로 전송되지 않는다")을 코드로 보증한다.
 *
 * 카피가 아니라 계약이다. 누군가 무심코 파일 바이트를 네트워크로 보내는 코드를
 * 추가하면 CI 에서 막는다. 화이트리스트가 필요하면 ALLOW 에 사유와 함께 적는다.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC = join(ROOT, 'src');

/** 파일 내용이 네트워크로 나갈 수 있는 표현들. */
const FORBIDDEN = [
  { re: /\bfetch\s*\(/, why: 'fetch 로 외부 전송 가능' },
  { re: /XMLHttpRequest/, why: 'XHR 로 외부 전송 가능' },
  { re: /navigator\.sendBeacon/, why: 'sendBeacon 으로 외부 전송 가능' },
  { re: /new\s+WebSocket/, why: 'WebSocket 으로 외부 전송 가능' },
  { re: /new\s+FormData/, why: 'FormData 는 업로드 신호' },
  { re: /new\s+EventSource/, why: 'EventSource 는 서버 연결' },
];

/** 사유를 반드시 적어야 통과한다. */
const ALLOW = new Set([
  // 예: 'src/analytics/plausible.ts'  // 파일 내용이 아닌 집계 이벤트만 전송
]);

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(name)) out.push(p);
  }
  return out;
}

let failed = 0;
for (const file of walk(SRC)) {
  const rel = relative(ROOT, file);
  if (ALLOW.has(rel)) continue;

  const text = readFileSync(file, 'utf8');
  text.split('\n').forEach((line, i) => {
    if (/^\s*(\/\/|\*)/.test(line)) return; // 주석은 건너뛴다
    for (const { re, why } of FORBIDDEN) {
      if (re.test(line)) {
        console.error(`${rel}:${i + 1}  ${why}\n    ${line.trim()}`);
        failed++;
      }
    }
  });
}

if (failed > 0) {
  console.error(`\n네트워크 전송 가능성 ${failed}건. D-01 위반입니다.`);
  console.error('정말 필요하다면 scripts/check-no-upload.mjs 의 ALLOW 에 사유와 함께 추가하세요.');
  process.exit(1);
}
console.log('D-01 확인: 파일을 전송할 수 있는 코드가 없습니다.');
