/**
 * 실문서 검수 하네스 (P0-1) — 겸 골든 스냅샷 생산기 (T-018 의 토대).
 *
 * 브라우저 /docdiff/admin 에 파일을 하나씩 넣는 대신, 터미널에서 폴더째 돌린다.
 * 워커를 거치지 않고 document.worker.ts 와 같은 순서로 직접 파서를 부른다
 * (크기 검사 → resolveFormat → loadParser → parse). 결과 판정 기준은
 * docs/NEXT.md 의 P0-1 에 적힌 네 가지를 그대로 코드로 옮긴 것이다.
 *
 *   npm run inspect                        # src/fixtures/private 전체
 *   npm run inspect -- a.hwp b.pdf         # 파일/폴더 지정
 *   npm run inspect -- --json snapshots/   # NormalizedDoc 스냅샷 저장
 *
 * 옵션
 *   --json <dir>   각 문서의 NormalizedDoc 을 <dir>/<파일명>.json 으로 저장
 *   --preview <n>  블록 미리보기 개수 (기본 3, 0 이면 끔)
 *   --password <pw>  암호가 걸린 PDF 를 열 때 쓴다 (T-040)
 *   --full         경고의 detail 까지 전부 출력
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, extname, join, relative, resolve } from 'node:path';
import { SUPPORTED_EXTS, FORMAT_TO_GROUP, resolveFormat } from '@/core/detect';
import { loadParser } from '@/core/parsers';
import { DEFAULT_NORMALIZE } from '@/core/normalize';
import { AppError } from '@/core/errors';
import { LIMITS } from '@/core/limits';
import type { Format, NormalizedDoc, Progress } from '@/core/types';

const DEFAULT_DIR = 'src/fixtures/private';

// ─────────────────────────────────────────────────────────────── 인자

interface Args {
  targets: string[];
  jsonDir?: string;
  preview: number;
  full: boolean;
  /** 암호가 걸린 문서를 열 때만. 검수는 어차피 로컬에서 도는 일이다. */
  password?: string;
}

function parseArgs(argv: string[]): Args {
  const a: Args = { targets: [], preview: 3, full: false };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i] ?? '';
    if (t === '--json') a.jsonDir = argv[++i];
    else if (t === '--preview') a.preview = Number(argv[++i]) || 0;
    else if (t === '--password') a.password = argv[++i];
    else if (t === '--full') a.full = true;
    else if (t === '--help' || t === '-h') {
      usage();
      process.exit(0);
    } else if (t.startsWith('--')) {
      console.error(`알 수 없는 옵션: ${t}`);
      usage();
      process.exit(2);
    } else a.targets.push(t);
  }
  if (a.targets.length === 0) a.targets.push(DEFAULT_DIR);
  return a;
}

function usage() {
  console.log(`사용법:
  npm run inspect                      ${DEFAULT_DIR} 아래 문서를 전부 검수
  npm run inspect -- <파일|폴더>...    지정한 것만 검수
옵션:
  --json <dir>    NormalizedDoc 스냅샷 저장
  --preview <n>   블록 미리보기 개수 (기본 3)
  --password <pw> 암호가 걸린 PDF 의 비밀번호
  --full          경고 detail 까지 출력`);
}

// ─────────────────────────────────────────────────────────────── 파일 수집

const EXTS = new Set(SUPPORTED_EXTS.map((e) => `.${e}`));

function collect(target: string): string[] {
  const p = resolve(target);
  if (!existsSync(p)) {
    console.error(`[FAIL] 경로가 없습니다: ${target}`);
    return [];
  }
  if (statSync(p).isFile()) return [p];
  const out: string[] = [];
  for (const name of readdirSync(p).sort()) {
    if (name.startsWith('.')) continue;
    const child = join(p, name);
    if (statSync(child).isDirectory()) out.push(...collect(child));
    else if (EXTS.has(extname(name).toLowerCase())) out.push(child);
  }
  return out;
}

// ─────────────────────────────────────────────────────────────── 본문 통계

interface TextStats {
  blocks: number;
  chars: number;
  rawChars: number;
  /** 정규화 뒤 빈 블록. 파서가 걸러야 하므로 0 이어야 한다. */
  empty: number;
  /** C0 제어문자 잔여 (탭·개행 제외). HWP 8 WCHAR 처리 구멍의 신호. */
  ctrl: number;
  /** U+FFFD. 인코딩 판정 또는 글꼴 매핑 실패. */
  fffd: number;
  /** 사용자 영역 문자. 한글 PDF 의 깨진 글꼴 서브셋에서 나온다. */
  pua: number;
  /** 결합 자모. NFC 정규화가 빠졌다는 신호. */
  jamo: number;
  /** 공백 아닌 글자 중 한글 음절 비율. */
  hangul: number;
  byType: Record<string, number>;
}

const RE_CTRL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g;
const RE_FFFD = /\uFFFD/g;
const RE_PUA = /[\uE000-\uF8FF]/g;
const RE_JAMO = /[\u1100-\u11FF\u3130-\u318F]/g;
const RE_HANGUL = /[\uAC00-\uD7A3]/g;

function count(s: string, re: RegExp): number {
  return s.match(re)?.length ?? 0;
}

function statsOf(doc: NormalizedDoc): TextStats {
  const st: TextStats = {
    blocks: doc.blocks.length,
    chars: 0,
    rawChars: 0,
    empty: 0,
    ctrl: 0,
    fffd: 0,
    pua: 0,
    jamo: 0,
    hangul: 0,
    byType: {},
  };
  let hangul = 0;
  let visible = 0;
  for (const b of doc.blocks) {
    st.chars += b.text.length;
    st.rawChars += b.rawText.length;
    if (b.text.length === 0) st.empty++;
    st.ctrl += count(b.rawText, RE_CTRL);
    st.fffd += count(b.rawText, RE_FFFD);
    st.pua += count(b.rawText, RE_PUA);
    st.jamo += count(b.text, RE_JAMO);
    hangul += count(b.text, RE_HANGUL);
    visible += b.text.replace(/\s/g, '').length;
    st.byType[b.type] = (st.byType[b.type] ?? 0) + 1;
  }
  st.hangul = visible ? hangul / visible : 0;
  return st;
}

// ─────────────────────────────────────────────────────────────── 검수

interface Probe {
  path: string;
  name: string;
  bytes: number;
  ms: number;
  format?: Format;
  doc?: NormalizedDoc;
  stats?: TextStats;
  error?: { code: string; message: string; detail?: string };
  /** 사람이 다음에 무엇을 할지 판단할 근거. docs/NEXT.md P0-1 의 판정 규칙. */
  flags: string[];
}

/**
 * node 에는 Worker 전역도 `?url` 임포트도 없다. pdf.js 워커 경로를 미리 못 박아
 * 두면 파서의 loadPdfjs() 가 그걸 그대로 쓴다(같은 모듈 인스턴스를 공유한다).
 */
async function preparePdfjs() {
  const pdfjs = await import('pdfjs-dist');
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    const req = createRequire(import.meta.url);
    pdfjs.GlobalWorkerOptions.workerSrc = req.resolve('pdfjs-dist/build/pdf.worker.mjs');
  }
}

async function probe(path: string, password?: string): Promise<Probe> {
  const name = basename(path);
  const buf = readFileSync(path);
  const bytes = buf.byteLength;
  const p: Probe = { path, name, bytes, ms: 0, flags: [] };
  const t0 = performance.now();

  try {
    if (bytes === 0) throw new AppError('EMPTY_FILE', name);
    if (bytes > LIMITS.MAX_FILE_BYTES) throw new AppError('FILE_TOO_LARGE', name);

    const { format, mismatch } = resolveFormat(name, new Uint8Array(buf));
    p.format = format;
    if (mismatch) p.flags.push('확장자와 실제 형식이 다름 — 실제 형식으로 읽었다');
    if (format === 'pdf') await preparePdfjs();

    const parser = await loadParser(format);
    // Buffer 는 큰 풀 위의 뷰다. 그대로 넘기면 오프셋이 어긋나므로 잘라서 준다.
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    const doc = await parser.parse(ab, name, {
      progress: (_p: Progress) => {},
      shouldAbort: () => false,
      options: DEFAULT_NORMALIZE[FORMAT_TO_GROUP[format]],
      password,
    });
    p.ms = Math.round(performance.now() - t0);
    p.doc = doc;
    p.stats = statsOf(doc);
    judge(p);
  } catch (e) {
    p.ms = Math.round(performance.now() - t0);
    p.error =
      e instanceof AppError
        ? { code: e.code, message: e.message, detail: e.detail }
        : {
            code: 'THROWN',
            message: e instanceof Error ? e.message : String(e),
            detail: e instanceof Error ? e.stack : undefined,
          };
  }
  return p;
}

/** docs/NEXT.md P0-1 의 판정을 그대로 옮긴 것. */
function judge(p: Probe) {
  const { doc, stats } = p;
  if (!doc || !stats) return;
  if (stats.blocks === 0) p.flags.push('블록이 0 — 본문을 하나도 뽑지 못했다');
  if (stats.empty > 0) p.flags.push(`빈 블록 ${stats.empty} — 파서가 걸러야 한다`);
  if (stats.ctrl > 0) p.flags.push(`제어문자 잔여 ${stats.ctrl} — paraText.ts 의 8 WCHAR 처리에 구멍이 있다`);
  if (stats.fffd > 0) p.flags.push(`U+FFFD ${stats.fffd} — 인코딩 판정 또는 글꼴 매핑 실패`);
  if (stats.pua > 0) p.flags.push(`사용자영역 문자 ${stats.pua} — 글꼴 서브셋의 ToUnicode 누락 의심`);
  if (stats.jamo > 0) p.flags.push(`결합 자모 ${stats.jamo} — NFC 정규화가 빠진 경로가 있다`);
  if (doc.confidence === 0) p.flags.push('신뢰도 0 — 비교가 차단된다');
  else if (doc.confidence < 0.7) p.flags.push(`신뢰도 ${doc.confidence.toFixed(2)} — 낮음`);
  if (doc.format === 'hwp' && doc.confidence <= 0.4) p.flags.push('PrvText 폴백으로 보인다 — 본문 파싱이 실패했다');
  if (doc.format === 'pdf' && doc.meta.extractionTrack === 'C') p.flags.push('트랙 C — 스캔본으로 판정');
  if (doc.warnings.some((w) => w.code === 'GARBLED_TEXT') && stats.hangul > 0.3) {
    p.flags.push('한글이 정상으로 보이는데 GARBLED_TEXT — hangulSanity.ts 임계값이 과하다');
  }
}

/** 이 문서가 "실무에서 쓸 수 있게 나왔다" 고 볼 수 있는가. */
function isClean(p: Probe): boolean {
  return (
    !p.error &&
    !!p.doc &&
    !!p.stats &&
    p.stats.blocks > 0 &&
    p.stats.ctrl === 0 &&
    p.stats.fffd === 0 &&
    p.doc.confidence >= 0.5
  );
}

// ─────────────────────────────────────────────────────────────── 출력

function mark(p: Probe): string {
  if (p.error) return '[FAIL]';
  return isClean(p) ? '[ OK ]' : '[WARN]';
}

function size(n: number): string {
  return n < 1024 ? `${n}B` : `${(n / 1024).toFixed(0)}KB`;
}

function report(p: Probe, args: Args) {
  console.log(`\n${mark(p)} ${p.name}  (${size(p.bytes)}, ${p.ms}ms)`);

  if (p.error) {
    console.log(`       ${p.error.code}: ${p.error.message}`);
    if (p.error.detail) console.log(`       detail: ${p.error.detail.split('\n')[0]}`);
    return;
  }
  const { doc, stats } = p;
  if (!doc || !stats) return;

  const meta: string[] = [
    `파서 ${doc.meta.parserVersion}`,
    `블록 ${stats.blocks}`,
    `글자 ${stats.chars}`,
    `신뢰도 ${doc.confidence.toFixed(2)}`,
  ];
  if (doc.meta.pageCount !== undefined) meta.push(`${doc.meta.pageCount}쪽`);
  if (doc.meta.sectionCount !== undefined) meta.push(`구역 ${doc.meta.sectionCount}`);
  if (doc.meta.extractionTrack) meta.push(`트랙 ${doc.meta.extractionTrack}`);
  meta.push(`한글 ${(stats.hangul * 100).toFixed(0)}%`);
  console.log(`       ${meta.join(' · ')}`);
  console.log(`       유형 ${Object.entries(stats.byType).map(([k, v]) => `${k}:${v}`).join(' ')}`);

  for (const w of doc.warnings) {
    console.log(`       ! ${w.severity} ${w.code} — ${w.message}`);
    if (args.full && w.detail) console.log(`         ${w.detail}`);
  }
  for (const f of p.flags) console.log(`       > ${f}`);

  for (const b of doc.blocks.slice(0, args.preview)) {
    const t = b.text.length > 90 ? b.text.slice(0, 90) + '…' : b.text;
    console.log(`       | ${b.type}${b.level ? `(${b.level})` : ''}: ${t}`);
  }
}

/** 형식별 성공률. HWP 는 기획서 §7.8-8 의 80% 결정선이 걸려 있다. */
function summary(probes: Probe[]) {
  const ok = probes.filter(isClean).length;
  const warn = probes.filter((p) => !p.error && !isClean(p)).length;
  const fail = probes.filter((p) => p.error).length;

  console.log('\n' + '─'.repeat(72));
  console.log(`검수 ${probes.length}건 — 정상 ${ok} · 경고 ${warn} · 실패 ${fail}`);

  const groups = new Map<string, Probe[]>();
  for (const p of probes) {
    const key = p.format ?? 'unknown';
    const list = groups.get(key) ?? [];
    list.push(p);
    groups.set(key, list);
  }
  for (const [format, list] of [...groups].sort()) {
    const good = list.filter(isClean).length;
    const rate = (good / list.length) * 100;
    let line = `  ${format.padEnd(5)} ${String(good).padStart(2)}/${String(list.length).padEnd(2)} (${rate.toFixed(0)}%)`;
    if (format === 'hwp') {
      line += rate < 80 ? '  <- 80% 미만: v1 에서 .hwp 를 빼는 결정 대상 (§7.8-8)' : '  <- 80% 이상: v1 유지';
    }
    console.log(line);
  }

  const pdfs = probes.filter((p) => p.format === 'pdf' && p.doc);
  if (pdfs.length) {
    const tally = { A: 0, B: 0, C: 0 };
    for (const p of pdfs) tally[p.doc?.meta.extractionTrack ?? 'B'] += 1;
    console.log(`  PDF 트랙  A(구조트리) ${tally.A} · B(기하재조립) ${tally.B} · C(스캔) ${tally.C}`);
    if (tally.A / pdfs.length >= 0.5) {
      console.log('    트랙 A 적중률이 높다 — §6.5 기하 재조립 튜닝 부담이 그만큼 줄어든다');
    }
  }
}

// ─────────────────────────────────────────────────────────────── 진입점

async function main() {
  const args = parseArgs(process.argv.slice(2));
  // 기본 폴더는 없으면 만들어 둔다. "어디에 넣으라는 건지" 를 폴더로 답한다.
  if (args.targets.length === 1 && args.targets[0] === DEFAULT_DIR && !existsSync(DEFAULT_DIR)) {
    mkdirSync(DEFAULT_DIR, { recursive: true });
  }
  const files = args.targets.flatMap(collect);

  if (files.length === 0) {
    console.log(`검수할 문서가 없습니다. ${DEFAULT_DIR}/ 에 실제 문서를 넣고 다시 실행하세요.`);
    console.log(`(이 폴더는 .gitignore 에 있어 커밋되지 않습니다. 지원 확장자: ${[...EXTS].join(' ')})`);
    process.exit(0);
  }

  const probes: Probe[] = [];
  for (const f of files) {
    const p = await probe(f, args.password);
    probes.push(p);
    report(p, args);
  }
  summary(probes);

  if (args.jsonDir) {
    const dir = resolve(args.jsonDir);
    mkdirSync(dir, { recursive: true });
    let n = 0;
    for (const p of probes) {
      if (!p.doc) continue;
      // parsedAt 은 실행할 때마다 달라진다. 스냅샷 비교를 깨뜨리므로 뺀다.
      const { parsedAt: _drop, ...meta } = p.doc.meta;
      writeFileSync(join(dir, `${p.name}.json`), JSON.stringify({ ...p.doc, meta }, null, 2) + '\n', 'utf8');
      n++;
    }
    console.log(`\n스냅샷 ${n}개 저장: ${relative(process.cwd(), dir) || dir}`);
  }

  process.exit(probes.some((p) => p.error) ? 1 : 0);
}

void main();
