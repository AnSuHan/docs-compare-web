import type { Block, DiffOptions, DiffResult, DiffRow, DiffStats, NormalizedDoc } from '../types';
import { DIFF_LIMITS } from '../limits';
import { AppError } from '../errors';
import { diffSequence, type SeqOp } from './sequence';
import { pairBlocks } from './pairing';
import { inlineDiff } from './wordDiff';

export { diffSequence } from './sequence';
export { diceCoefficient, pairBlocks } from './pairing';
export { inlineDiff, splitWords, mergeAdjacent } from './wordDiff';

/**
 * §5 — 3단계 diff.
 *   1단계 블록 LCS          → equal / insert / delete
 *   2단계 인접 쌍 짝짓기     → modify 로 승격
 *   3단계 modify 의 어절 diff → inline 스팬
 */
export function diffDocs(a: NormalizedDoc, b: NormalizedDoc, options: DiffOptions): DiffResult {
  const started = now();
  const A = a.blocks;
  const B = b.blocks;

  if (A.length + B.length > DIFF_LIMITS.MAX_TOTAL_BLOCKS) {
    throw new AppError('OUT_OF_MEMORY', `blocks=${A.length + B.length}`);
  }

  const ops = diffSequence(
    A.map((x) => x.text),
    B.map((x) => x.text),
  );

  const rows: DiffRow[] = [];
  const stats: DiffStats = {
    insertBlocks: 0,
    deleteBlocks: 0,
    modifyBlocks: 0,
    equalBlocks: 0,
    insertChars: 0,
    deleteChars: 0,
  };
  let truncated = false;

  // 연속된 delete / insert 무리를 모아서 한 번에 처리한다.
  let i = 0;
  while (i < ops.length) {
    if (now() - started > options.timeoutMs) {
      truncated = true;
      break;
    }

    const op = ops[i]!;
    if (op.kind === 'equal') {
      rows.push({ kind: 'equal', left: A[op.ai]!, right: B[op.bi]! });
      stats.equalBlocks++;
      i++;
      continue;
    }

    const start = i;
    while (i < ops.length && ops[i]!.kind !== 'equal') i++;
    emitChangeRun(ops.slice(start, i), A, B, options, rows, stats);
  }

  const changeIndices: number[] = [];
  rows.forEach((r, idx) => {
    if (r.kind !== 'equal') changeIndices.push(idx);
  });

  const result: DiffResult = { rows, stats, changeIndices, options };
  if (truncated) result.truncated = true;
  return result;
}

/** delete 무리 + insert 무리를 짝지어 modify 로 승격한다(2·3단계). */
function emitChangeRun(
  run: SeqOp[],
  A: readonly Block[],
  B: readonly Block[],
  options: DiffOptions,
  rows: DiffRow[],
  stats: DiffStats,
): void {
  const dels = run.filter((o): o is Extract<SeqOp, { kind: 'delete' }> => o.kind === 'delete').map((o) => o.ai);
  const inss = run.filter((o): o is Extract<SeqOp, { kind: 'insert' }> => o.kind === 'insert').map((o) => o.bi);

  const pairs = pairBlocks(
    dels.map((ai) => A[ai]!.text),
    inss.map((bi) => B[bi]!.text),
  );

  const pairedLeft = new Map<number, { right: number; sim: number }>();
  const pairedRight = new Set<number>();
  for (const p of pairs) {
    pairedLeft.set(p.left, { right: p.right, sim: p.sim });
    pairedRight.add(p.right);
  }

  // 왼쪽 순서를 기준으로 내보낸다. 짝이 있으면 modify, 없으면 delete.
  let insCursor = 0;
  for (let li = 0; li < dels.length; li++) {
    const pair = pairedLeft.get(li);
    if (!pair) {
      const left = A[dels[li]!]!;
      rows.push({ kind: 'delete', left });
      stats.deleteBlocks++;
      stats.deleteChars += left.text.length;
      continue;
    }

    // 짝지어지지 않은 채 앞서 있는 insert 들을 먼저 흘려보낸다.
    while (insCursor < pair.right) {
      if (!pairedRight.has(insCursor)) {
        const right = B[inss[insCursor]!]!;
        rows.push({ kind: 'insert', right });
        stats.insertBlocks++;
        stats.insertChars += right.text.length;
      }
      insCursor++;
    }

    const left = A[dels[li]!]!;
    const right = B[inss[pair.right]!]!;
    const row: DiffRow = { kind: 'modify', left, right, similarity: round2(pair.sim) };

    // 너무 긴 블록은 인라인 diff 를 생략한다(§5.5).
    if (left.text.length <= options.maxInlineLen && right.text.length <= options.maxInlineLen) {
      row.inline = inlineDiff(left.text, right.text);
    }
    rows.push(row);

    stats.modifyBlocks++;
    // 바뀐 글자 수만 센다. 통째로 세면 수정이 전면 교체처럼 보인다.
    const changed = countInlineChars(row.inline, left.text, right.text);
    stats.deleteChars += changed.deleted;
    stats.insertChars += changed.inserted;
    insCursor = pair.right + 1;
  }

  while (insCursor < inss.length) {
    if (!pairedRight.has(insCursor)) {
      const right = B[inss[insCursor]!]!;
      rows.push({ kind: 'insert', right });
      stats.insertBlocks++;
      stats.insertChars += right.text.length;
    }
    insCursor++;
  }
}

function countInlineChars(
  inline: DiffRow['inline'],
  leftText: string,
  rightText: string,
): { deleted: number; inserted: number } {
  if (!inline) return { deleted: leftText.length, inserted: rightText.length };
  let deleted = 0;
  let inserted = 0;
  for (const s of inline) {
    if (s.kind === 'delete') deleted += s.text.length;
    else if (s.kind === 'insert') inserted += s.text.length;
  }
  return { deleted, inserted };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** 워커·Node 어디서든 도는 시계. performance 가 없으면 Date 로 떨어진다. */
function now(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}
