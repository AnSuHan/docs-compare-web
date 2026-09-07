/**
 * §5.3 2단계 — 블록 짝짓기.
 *
 * 1단계 LCS 는 "이 문단이 지워지고 저 문단이 추가됐다"까지만 안다.
 * 실제로는 한 문단이 조금 고쳐진 경우가 대부분이므로, 인접한 delete 무리와
 * insert 무리를 유사도로 이어 modify 로 승격한다.
 */

const SIM_THRESHOLD = 0.5;
/** 위치 편차가 이보다 크면 후보로 보지 않는다. O(n²) 폭발을 막는다. */
const WINDOW = 3;

export interface Pairing {
  left: number;
  right: number;
  sim: number;
}

/** 바이그램 기반 Dice 계수. 한국어에서도 잘 동작한다. */
export function diceCoefficient(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;

  const bigrams = (s: string) => {
    const m = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) {
      const g = s.slice(i, i + 2);
      m.set(g, (m.get(g) ?? 0) + 1);
    }
    return m;
  };

  const A = bigrams(a);
  const B = bigrams(b);
  let inter = 0;
  for (const [g, n] of A) inter += Math.min(n, B.get(g) ?? 0);

  return (2 * inter) / (a.length - 1 + b.length - 1);
}

/** 그리디 매칭. dels[i] 에 가장 잘 맞는 ins[j] 를 창 안에서 고른다. */
export function pairBlocks(dels: readonly string[], ins: readonly string[]): Pairing[] {
  const pairs: Pairing[] = [];
  const usedIns = new Set<number>();

  for (let i = 0; i < dels.length; i++) {
    let best = -1;
    let bestSim = SIM_THRESHOLD;

    const from = Math.max(0, i - WINDOW);
    const to = Math.min(ins.length, i + WINDOW + 1);
    for (let j = from; j < to; j++) {
      if (usedIns.has(j)) continue;
      const sim = diceCoefficient(dels[i]!, ins[j]!);
      if (sim > bestSim) {
        bestSim = sim;
        best = j;
      }
    }

    if (best >= 0) {
      pairs.push({ left: i, right: best, sim: bestSim });
      usedIns.add(best);
    }
  }
  return pairs;
}
