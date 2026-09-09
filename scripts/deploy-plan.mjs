#!/usr/bin/env node
/**
 * 배포 계획 — "이번에 무엇을 올려야 하는가"를 계산한다.
 *
 * 왜 필요한가:
 * 이 프로젝트는 에그호스팅 MCP 로 배포한다. 그 통로는 파일 내용을 그대로
 * 실어 보내는 방식이라, 전체 소스(현재 180KB 남짓)를 매번 올리면 비싸고 느리다.
 * 실제로 바뀌는 건 보통 한두 파일이다.
 *
 * 그래서 배포한 파일의 해시를 매니페스트로 남겨 두고, 다음 배포 때는
 * 달라진 것만 골라낸다. 배포 절차는 이렇게 된다.
 *
 *   1) npm run deploy:plan            무엇이 바뀌었는지 본다
 *   2) 나온 목록만 write_file 로 올린다 (없으면 올릴 것도 없다)
 *   3) 앱을 restart 한다
 *      → vite.config 의 rebuild-if-stale 플러그인이 소스가 dist 보다 새로운 것을
 *        보고 다시 빌드한다. 그래서 "재시작 = 지금 소스대로 서빙"이 성립한다.
 *   4) npm run deploy:record          매니페스트를 갱신한다
 *
 * 옵션
 *   --record            배포에 성공했다고 보고 매니페스트를 지금 상태로 갱신
 *   --out <dir>         바뀐 파일만 그 폴더로 복사 (원본 경로 구조 유지)
 *   --json              결과를 JSON 으로 출력 (자동화용)
 *   --all               변경 여부와 무관하게 전체 목록을 낸다 (첫 배포용)
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const MANIFEST = join(ROOT, 'deploy', 'manifest.json');

/**
 * 배포 대상에서 빼는 것들.
 * 빌드에 필요 없거나(테스트·문서), 서버가 알아서 만드는 것(package-lock, dist)들이다.
 */
const EXCLUDE = [
  /^docs\//,
  /^tests\//,
  /^deploy\//,
  /^dist\//,
  /^node_modules\//,
  /^\.gitignore$/,
  /^README\.md$/,
  /^package-lock\.json$/,
  /^vitest\.config\.ts$/,
  /^scripts\/deploy-plan\.mjs$/, // 로컬 전용 도구. 서버에 올릴 이유가 없다
  /^scripts\/inspect\.ts$/, // 실문서 검수 하네스. 로컬 전용
  /^src\/fixtures\//, // 검수용 문서 자리. 앱이 import 하지 않는다
  /**
   * 배포 서버는 프로덕션 의존성만 설치한 뒤 `npm run build`(= tsc -b)를 돌린다.
   * 이 파일은 tsconfig 의 include 에 들어 있고 @playwright/test 를 import 하므로,
   * 올리면 서버에서 "모듈을 찾을 수 없다" 로 빌드가 통째로 깨진다.
   * (tests/ 를 빼는 이유도 같다 — vitest 가 devDependency 다.)
   */
  /^playwright\..*config\.ts$/, // playwright.config.ts + playwright.shots.config.ts
  /\.tsbuildinfo$/,
];

function deployableFiles() {
  const out = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' });
  return out
    .split('\0')
    .filter(Boolean)
    .filter((p) => !EXCLUDE.some((re) => re.test(p)))
    .sort();
}

function hashOf(relPath) {
  const buf = readFileSync(join(ROOT, relPath));
  return createHash('sha256').update(buf).digest('hex').slice(0, 16);
}

function loadManifest() {
  if (!existsSync(MANIFEST)) return { app: 'docdiff', updatedAt: null, files: {} };
  try {
    return JSON.parse(readFileSync(MANIFEST, 'utf8'));
  } catch {
    return { app: 'docdiff', updatedAt: null, files: {} };
  }
}

function saveManifest(files) {
  mkdirSync(dirname(MANIFEST), { recursive: true });
  const data = {
    app: 'docdiff',
    updatedAt: new Date().toISOString(),
    note: '마지막으로 배포한 파일들의 해시. scripts/deploy-plan.mjs 가 읽고 쓴다.',
    files,
  };
  writeFileSync(MANIFEST, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

// ─────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const optValue = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const previous = loadManifest();
const current = {};
const files = deployableFiles();
for (const f of files) current[f] = hashOf(f);

const added = files.filter((f) => !(f in previous.files));
const changed = files.filter((f) => f in previous.files && previous.files[f] !== current[f]);
const removed = Object.keys(previous.files).filter((f) => !(f in current));
const upload = flag('--all') ? files : [...added, ...changed].sort();

const bytes = upload.reduce((n, f) => n + statSync(join(ROOT, f)).size, 0);
const totalBytes = files.reduce((n, f) => n + statSync(join(ROOT, f)).size, 0);

if (flag('--record')) {
  saveManifest(current);
  console.log(`매니페스트를 갱신했습니다: ${relative(ROOT, MANIFEST)} (${files.length}개 파일)`);
  process.exit(0);
}

const outDir = optValue('--out');
if (outDir) {
  const base = resolve(ROOT, outDir);
  for (const f of upload) {
    const dest = join(base, f);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(join(ROOT, f), dest);
  }
  console.log(`${upload.length}개 파일을 ${relative(ROOT, base)} 로 복사했습니다.`);
}

if (flag('--json')) {
  console.log(JSON.stringify({ upload, added, changed, removed, bytes, totalBytes }, null, 2));
  process.exit(0);
}

const kb = (n) => (n / 1024).toFixed(1) + 'KB';

console.log(`배포 대상 ${files.length}개 / ${kb(totalBytes)}`);
console.log(
  previous.updatedAt ? `마지막 배포: ${previous.updatedAt}` : '매니페스트가 없습니다 — 첫 배포로 봅니다.',
);
console.log('');

if (upload.length === 0 && removed.length === 0) {
  console.log('올릴 것이 없습니다. 소스가 마지막 배포와 같습니다.');
  process.exit(0);
}

if (added.length) {
  console.log(`새 파일 ${added.length}개`);
  for (const f of added) console.log(`  + ${f}`);
}
if (changed.length) {
  console.log(`바뀐 파일 ${changed.length}개`);
  for (const f of changed) console.log(`  ~ ${f}`);
}
if (removed.length) {
  console.log(`지울 파일 ${removed.length}개 (컨테이너에서 delete_file)`);
  for (const f of removed) console.log(`  - ${f}`);
}

console.log('');
console.log(`올릴 용량 ${kb(bytes)} / 전체 ${kb(totalBytes)} (${((bytes / totalBytes) * 100).toFixed(0)}%)`);
console.log('');
console.log('다음 순서로 진행하세요:');
console.log('  1. 위 목록을 write_file 로 올린다 (새 폴더는 make_dir 먼저)');
console.log('  2. 지울 파일이 있으면 delete_file');
console.log('  3. restart_app  → rebuild-if-stale 이 다시 빌드한다');
console.log('  4. npm run deploy:record');
