import type { InlineSpan } from '../types';
import { diffSequence, type SeqOp } from './sequence';
import { diceCoefficient } from './pairing';

/**
 * §5.4 3단계 — 한국어 대응 인라인 diff.
 *
 * 영어는 공백 분리가 자연스럽지만 한국어는 조사가 붙는다.
 * "계약서를"과 "계약서는"을 어절 단위로만 diff 하면 단어가 통째로 바뀐 것처럼
 * 보인다. 그래서 인접한 삭제·추가 어절 쌍의 유사도가 높으면 **문자 단위로
 * 한 번 더 쪼갠다**. 기획서가 "반드시 넣는다"고 못박은 2.5단계다.
 */

/** 문자 단위로 재분해할 최소 유사도 */
const RECURSE_SIM = 0.4;

/** 공백을 붙여서 어절로 자른다. 공백 자체도 토큰에 포함돼 복원이 정확하다. */
export function splitWords(s: string): string[] {
  return s.match(/\s+|[^\s]+/g) ?? [];
}

function splitChars(s: string): string[] {
  return [...s];
}

function toSpans(tokens: readonly string[], other: readonly string[], ops: SeqOp[]): InlineSpan[] {
  const out: InlineSpan[] = [];
  for (const op of ops) {
    if (op.kind === 'equal') out.push({ kind: 'equal', text: tokens[op.ai]! });
    else if (op.kind === 'delete') out.push({ kind: 'delete', text: tokens[op.ai]! });
    else out.push({ kind: 'insert', text: other[op.bi]! });
  }
  return out;
}

/** 같은 종류가 이어지면 하나로 합친다. 화면에서 스팬이 잘게 쪼개지지 않게. */
export function mergeAdjacent(spans: InlineSpan[]): InlineSpan[] {
  const out: InlineSpan[] = [];
  for (const s of spans) {
    if (!s.text) continue;
    const last = out[out.length - 1];
    if (last && last.kind === s.kind) last.text += s.text;
    else out.push({ ...s });
  }
  return out;
}

export function inlineDiff(left: string, right: string): InlineSpan[] {
  const lw = splitWords(left);
  const rw = splitWords(right);
  const ops = diffSequence(lw, rw);

  // 어절 diff 결과를 훑으며, 삭제 뒤에 바로 추가가 오는 자리를 찾는다.
  const spans: InlineSpan[] = [];
  for (let i = 0; i < ops.length; i++) {
    const cur = ops[i]!;
    const nxt = ops[i + 1];

    if (cur.kind === 'delete' && nxt?.kind === 'insert') {
      const a = lw[cur.ai]!;
      const b = rw[nxt.bi]!;
      if (diceCoefficient(a, b) >= RECURSE_SIM) {
        const ca = splitChars(a);
        const cb = splitChars(b);
        spans.push(...toSpans(ca, cb, diffSequence(ca, cb)));
        i++; // nxt 소비
        continue;
      }
    }

    if (cur.kind === 'equal') spans.push({ kind: 'equal', text: lw[cur.ai]! });
    else if (cur.kind === 'delete') spans.push({ kind: 'delete', text: lw[cur.ai]! });
    else spans.push({ kind: 'insert', text: rw[cur.bi]! });
  }

  return mergeAdjacent(spans);
}
