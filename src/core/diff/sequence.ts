/**
 * 시퀀스 diff 의 공통 엔진. 블록 배열에도, 어절 배열에도, 문자 배열에도 쓴다.
 *
 * 기존 구현은 O(n*m) DP 였다. 블록 8,000개면 6,400만 칸(256MB)이라 실제
 * 문서에서 브라우저가 죽는다. 그래서 두 가지로 바꿨다.
 *   - Myers 그리디(O(ND)). 실무 문서는 차이 D 가 작아 훨씬 빠르고 가볍다.
 *   - D 가 커지면 앵커 분할(patience diff)로 문제를 잘게 나눈다.
 */

export type SeqOp =
  | { kind: 'equal'; ai: number; bi: number }
  | { kind: 'delete'; ai: number }
  | { kind: 'insert'; bi: number };

/** Myers 그리디의 편집 거리 상한. 넘으면 앵커 분할로 넘긴다. */
const MAX_D = 1500;
/** 이 크기를 넘으면 Myers 를 돌리기 전에 앵커로 먼저 자른다. */
const ANCHOR_THRESHOLD = 400;

export function diffSequence(a: readonly string[], b: readonly string[]): SeqOp[] {
  const out: SeqOp[] = [];
  run(a, b, 0, a.length, 0, b.length, out);
  return out;
}

function run(
  a: readonly string[],
  b: readonly string[],
  a0: number,
  a1: number,
  b0: number,
  b1: number,
  out: SeqOp[],
): void {
  // 공통 접두/접미를 깎는다. 실제 비교에서 이것만으로 대부분이 처리된다.
  while (a0 < a1 && b0 < b1 && a[a0] === b[b0]) {
    out.push({ kind: 'equal', ai: a0++, bi: b0++ });
  }
  const tail: SeqOp[] = [];
  while (a1 > a0 && b1 > b0 && a[a1 - 1] === b[b1 - 1]) {
    tail.push({ kind: 'equal', ai: --a1, bi: --b1 });
  }
  tail.reverse();

  if (a0 === a1) {
    for (let j = b0; j < b1; j++) out.push({ kind: 'insert', bi: j });
    out.push(...tail);
    return;
  }
  if (b0 === b1) {
    for (let i = a0; i < a1; i++) out.push({ kind: 'delete', ai: i });
    out.push(...tail);
    return;
  }

  const n = a1 - a0;
  const m = b1 - b0;

  if (n + m > ANCHOR_THRESHOLD) {
    const anchors = findAnchors(a, b, a0, a1, b0, b1);
    if (anchors.length > 0) {
      let ai = a0;
      let bi = b0;
      for (const anc of anchors) {
        run(a, b, ai, anc.ai, bi, anc.bi, out);
        out.push({ kind: 'equal', ai: anc.ai, bi: anc.bi });
        ai = anc.ai + 1;
        bi = anc.bi + 1;
      }
      run(a, b, ai, a1, bi, b1, out);
      out.push(...tail);
      return;
    }
  }

  if (!myers(a, b, a0, a1, b0, b1, out)) {
    // 차이가 너무 커서 포기. 통째로 지우고 넣는다 — 결과는 여전히 정확하고,
    // 다만 "이 구간이 통째로 바뀌었다"로 보일 뿐이다.
    for (let i = a0; i < a1; i++) out.push({ kind: 'delete', ai: i });
    for (let j = b0; j < b1; j++) out.push({ kind: 'insert', bi: j });
  }
  out.push(...tail);
}

/**
 * 앵커 = 양쪽에 정확히 한 번씩만 나오는 값(patience diff).
 * 그중 순서가 어긋나지 않는 최대 부분집합(LIS)만 고른다.
 */
function findAnchors(
  a: readonly string[],
  b: readonly string[],
  a0: number,
  a1: number,
  b0: number,
  b1: number,
): Array<{ ai: number; bi: number }> {
  const countA = new Map<string, number>();
  const posA = new Map<string, number>();
  for (let i = a0; i < a1; i++) {
    const v = a[i]!;
    countA.set(v, (countA.get(v) ?? 0) + 1);
    posA.set(v, i);
  }
  const countB = new Map<string, number>();
  const posB = new Map<string, number>();
  for (let j = b0; j < b1; j++) {
    const v = b[j]!;
    countB.set(v, (countB.get(v) ?? 0) + 1);
    posB.set(v, j);
  }

  const pairs: Array<{ ai: number; bi: number }> = [];
  for (const [v, c] of countA) {
    if (c !== 1 || countB.get(v) !== 1) continue;
    pairs.push({ ai: posA.get(v)!, bi: posB.get(v)! });
  }
  if (pairs.length === 0) return [];

  pairs.sort((x, y) => x.ai - y.ai);
  return longestIncreasing(pairs);
}

/** bi 기준 최장 증가 부분수열. O(n log n) */
function longestIncreasing(pairs: Array<{ ai: number; bi: number }>): Array<{ ai: number; bi: number }> {
  const tails: number[] = [];
  const tailIdx: number[] = [];
  const prev = new Array<number>(pairs.length).fill(-1);

  for (let i = 0; i < pairs.length; i++) {
    const v = pairs[i]!.bi;
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (tails[mid]! < v) lo = mid + 1;
      else hi = mid;
    }
    tails[lo] = v;
    tailIdx[lo] = i;
    prev[i] = lo > 0 ? tailIdx[lo - 1]! : -1;
  }

  const out: Array<{ ai: number; bi: number }> = [];
  let k = tailIdx.length ? tailIdx[tailIdx.length - 1]! : -1;
  while (k >= 0) {
    out.push(pairs[k]!);
    k = prev[k]!;
  }
  return out.reverse();
}

/**
 * Myers 그리디 + 경로 추적. 성공하면 true.
 * V 스냅샷을 D 단계마다 저장하므로 메모리는 O(D²) — MAX_D 로 막는다.
 */
function myers(
  a: readonly string[],
  b: readonly string[],
  a0: number,
  a1: number,
  b0: number,
  b1: number,
  out: SeqOp[],
): boolean {
  const n = a1 - a0;
  const m = b1 - b0;
  const max = Math.min(n + m, MAX_D);
  const size = 2 * max + 1;
  const offset = max;

  const v = new Int32Array(size);
  const trace: Int32Array[] = [];

  for (let d = 0; d <= max; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      const idx = k + offset;
      if (idx < 0 || idx >= size) continue;

      let x: number;
      if (k === -d || (k !== d && v[idx - 1]! < v[idx + 1]!)) x = v[idx + 1]!;
      else x = v[idx - 1]! + 1;

      let y = x - k;
      while (x < n && y < m && a[a0 + x] === b[b0 + y]) {
        x++;
        y++;
      }
      v[idx] = x;

      if (x >= n && y >= m) {
        backtrack(trace, d, offset, size, a0, b0, n, m, out);
        return true;
      }
    }
  }
  return false;
}

function backtrack(
  trace: Int32Array[],
  d: number,
  offset: number,
  size: number,
  a0: number,
  b0: number,
  n: number,
  m: number,
  out: SeqOp[],
): void {
  const ops: SeqOp[] = [];
  let x = n;
  let y = m;

  for (let step = d; step > 0; step--) {
    const v = trace[step]!;
    const k = x - y;
    const idx = k + offset;

    const down = k === -step || (k !== step && idx - 1 >= 0 && idx + 1 < size && v[idx - 1]! < v[idx + 1]!);
    const prevK = down ? k + 1 : k - 1;
    const prevX = v[prevK + offset]!;
    const prevY = prevX - prevK;

    while (x > prevX && y > prevY) {
      x--;
      y--;
      ops.push({ kind: 'equal', ai: a0 + x, bi: b0 + y });
    }
    if (down) {
      y--;
      ops.push({ kind: 'insert', bi: b0 + y });
    } else {
      x--;
      ops.push({ kind: 'delete', ai: a0 + x });
    }
  }
  while (x > 0 && y > 0) {
    x--;
    y--;
    ops.push({ kind: 'equal', ai: a0 + x, bi: b0 + y });
  }

  ops.reverse();
  out.push(...ops);
}
