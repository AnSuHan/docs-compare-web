import type { Block, DiffOptions, DiffResult, DiffRow, DiffStats, NormalizedDoc } from '../types';
import { DIFF_LIMITS } from '../limits';

/**
 * M0 골격.
 * 블록 텍스트 배열에 대한 LCS 만 구현했다. (1단계)
 * 짝짓기(2단계)와 한국어 인라인 diff(3단계)는 M1 의 T-014 / T-015 에서 붙인다.
 * 지금 중요한 것은 "같은 문서를 넣으면 변경점이 0"이 성립하는 것뿐이다.
 */
export function diffDocs(a: NormalizedDoc, b: NormalizedDoc, options: DiffOptions): DiffResult {
  const started = performance.now();
  const A = a.blocks;
  const B = b.blocks;

  const ops = lcsOps(A.map((x) => x.text), B.map((x) => x.text));

  const rows: DiffRow[] = [];
  const stats: DiffStats = {
    insertBlocks: 0, deleteBlocks: 0, modifyBlocks: 0, equalBlocks: 0,
    insertChars: 0, deleteChars: 0,
  };

  let truncated = false;
  for (const op of ops) {
    if (performance.now() - started > options.timeoutMs) { truncated = true; break; }
    if (op.kind === 'equal') {
      rows.push({ kind: 'equal', left: A[op.ai]!, right: B[op.bi]! });
      stats.equalBlocks++;
    } else if (op.kind === 'delete') {
      const left: Block = A[op.ai]!;
      rows.push({ kind: 'delete', left });
      stats.deleteBlocks++;
      stats.deleteChars += left.text.length;
    } else {
      const right: Block = B[op.bi]!;
      rows.push({ kind: 'insert', right });
      stats.insertBlocks++;
      stats.insertChars += right.text.length;
    }
  }

  const changeIndices: number[] = [];
  rows.forEach((r, i) => { if (r.kind !== 'equal') changeIndices.push(i); });

  return { rows, stats, changeIndices, options, truncated: truncated || undefined };
}

type Op =
  | { kind: 'equal'; ai: number; bi: number }
  | { kind: 'delete'; ai: number }
  | { kind: 'insert'; bi: number };

/**
 * 표준 LCS DP. O(n*m) 이므로 대용량에서는 T-071 의 앵커 분할로 대체된다.
 * 여기서는 정확성 기준선 역할을 한다.
 */
export function lcsOps(a: readonly string[], b: readonly string[]): Op[] {
  const n = a.length;
  const m = b.length;

  if (n * m > DIFF_LIMITS.MAX_BLOCKS_FOR_MYERS * DIFF_LIMITS.MAX_BLOCKS_FOR_MYERS) {
    throw new Error('too large for LCS; use anchorSplit (T-071)');
  }

  // 공통 접두/접미를 먼저 깎아낸다. 대부분의 실제 비교에서 이게 대부분을 처리한다.
  let lo = 0;
  while (lo < n && lo < m && a[lo] === b[lo]) lo++;
  let hiA = n; let hiB = m;
  while (hiA > lo && hiB > lo && a[hiA - 1] === b[hiB - 1]) { hiA--; hiB--; }

  const ops: Op[] = [];
  for (let i = 0; i < lo; i++) ops.push({ kind: 'equal', ai: i, bi: i });

  const sa = a.slice(lo, hiA);
  const sb = b.slice(lo, hiB);
  const rows = sa.length;
  const cols = sb.length;

  const dp: Uint32Array = new Uint32Array((rows + 1) * (cols + 1));
  const at = (i: number, j: number) => i * (cols + 1) + j;

  for (let i = rows - 1; i >= 0; i--) {
    for (let j = cols - 1; j >= 0; j--) {
      dp[at(i, j)] = sa[i] === sb[j]
        ? dp[at(i + 1, j + 1)]! + 1
        : Math.max(dp[at(i + 1, j)]!, dp[at(i, j + 1)]!);
    }
  }

  let i = 0; let j = 0;
  while (i < rows && j < cols) {
    if (sa[i] === sb[j]) { ops.push({ kind: 'equal', ai: lo + i, bi: lo + j }); i++; j++; }
    else if (dp[at(i + 1, j)]! >= dp[at(i, j + 1)]!) { ops.push({ kind: 'delete', ai: lo + i }); i++; }
    else { ops.push({ kind: 'insert', bi: lo + j }); j++; }
  }
  while (i < rows) { ops.push({ kind: 'delete', ai: lo + i }); i++; }
  while (j < cols) { ops.push({ kind: 'insert', bi: lo + j }); j++; }

  for (let k = 0; k < n - hiA; k++) ops.push({ kind: 'equal', ai: hiA + k, bi: hiB + k });
  return ops;
}
