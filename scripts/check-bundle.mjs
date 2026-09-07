#!/usr/bin/env node
/**
 * T-070 초안 — 번들 예산.
 * 초기 로드에 들어가는 자바스크립트와 CSS 의 gzip 합이 200KB 를 넘으면 실패한다.
 * 형식별 파서가 실수로 정적 import 되면 여기서 즉시 잡힌다.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BUDGET_KB = 200;
const DIST = fileURLToPath(new URL('../dist/assets', import.meta.url));
const INDEX_HTML = readFileSync(fileURLToPath(new URL('../dist/index.html', import.meta.url)), 'utf8');

// index.html 이 직접 참조하는 것 = 초기 로드. 동적 import 청크는 제외된다.
const referenced = [...INDEX_HTML.matchAll(/assets\/([\w.-]+\.(?:js|css))/g)].map((m) => m[1]);

let total = 0;
const rows = [];
for (const name of new Set(referenced)) {
  if (!readdirSync(DIST).includes(name)) continue;
  const gz = gzipSync(readFileSync(join(DIST, name))).length;
  total += gz;
  rows.push([name, (gz / 1024).toFixed(1) + 'KB']);
}

for (const [n, s] of rows) console.log(`  ${s.padStart(9)}  ${n}`);
const totalKb = total / 1024;
console.log(`  ${(totalKb.toFixed(1) + 'KB').padStart(9)}  초기 로드 합계 (예산 ${BUDGET_KB}KB)`);

if (totalKb > BUDGET_KB) {
  console.error(`\n번들 예산 초과. 형식별 파서가 정적 import 되지 않았는지 확인하세요.`);
  process.exit(1);
}
