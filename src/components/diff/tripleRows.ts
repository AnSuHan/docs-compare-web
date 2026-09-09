import type { DiffRow, InlineSpan } from '@/core/types';
import { contextHead, contextTail, graphemes } from '@/core/segment';

/**
 * 세 칸 보기 — 문단을 "조각" 열로 바꾼다.
 *
 * 가운데는 공통, 왼쪽은 이전에만 있는 것, 오른쪽은 이후에만 있는 것.
 * 가운데 열만 세로로 훑으면 두 문서가 합의한 본문이 그대로 읽혀야 한다.
 * **가운데를 나중에 직접 편집할 수 있게 만드는 것이 이 구조의 목적이다** —
 * 그래서 렌더링과 분리된 순수 함수로 두고, 조각마다 안정적인 id 를 준다.
 * 편집 상태(채택한 쪽, 손으로 고친 문장)는 그 id 에 매달면 된다.
 */

export interface CommonSegment {
  kind: 'common';
  id: string;
  /** 양쪽이 같은 부분. 나중에 편집 단위가 된다. */
  text: string;
}

export interface DivergentSegment {
  kind: 'divergent';
  id: string;
  /** 이전에만 있는 것. 없으면 빈 문자열(= 이후에서 추가됨). */
  left: string;
  /** 이후에만 있는 것. 없으면 빈 문자열(= 이전에서 삭제됨). */
  right: string;
  /**
   * 조각이 너무 짧을 때만 채우는 앞뒤 맥락.
   * "1" 하나만 떼어 놓으면 무엇이 바뀐 건지 알 수 없다. 다만 이건 diff 결과가
   * 아니라 읽기 보조라서, 화면에서 흐린 색으로 구분하고 화면낭독기에서는 숨긴다.
   */
  before?: string;
  after?: string;
}

/** 이보다 짧은 조각에만 맥락을 붙인다. */
const SHORT = 3;
/** 한쪽에 붙일 맥락의 최대 길이. 길면 가운데 열과 중복돼 오히려 시끄럽다. */
const CONTEXT = 12;

export type TripleSegment = CommonSegment | DivergentSegment;

/**
 * 한 행(문단)을 조각으로 나눈다.
 *
 * - equal   → 공통 한 조각
 * - insert  → 오른쪽만 있는 갈림 한 조각
 * - delete  → 왼쪽만 있는 갈림 한 조각
 * - modify  → 인라인 스팬을 훑어 공통 / 갈림이 번갈아 나오게 편다
 *
 * 인라인 diff 를 건너뛴 긴 문단(§ maxInlineLen)은 스팬이 없다. 그때는 문단
 * 통째를 갈림 한 조각으로 둔다 — 쪼개지 못할 뿐, 좌우 원문은 그대로 보인다.
 */
export function toTripleSegments(row: DiffRow, rowIndex: number): TripleSegment[] {
  const id = (n: number) => `${rowIndex}:${n}`;

  if (row.kind === 'equal') {
    const text = row.right?.text ?? row.left?.text ?? '';
    return text ? [{ kind: 'common', id: id(0), text }] : [];
  }

  if (row.kind === 'insert') {
    return [{ kind: 'divergent', id: id(0), left: '', right: row.right?.text ?? '' }];
  }

  if (row.kind === 'delete') {
    return [{ kind: 'divergent', id: id(0), left: row.left?.text ?? '', right: '' }];
  }

  if (!row.inline || row.inline.length === 0) {
    return [{ kind: 'divergent', id: id(0), left: row.left?.text ?? '', right: row.right?.text ?? '' }];
  }

  return withContext(fromSpans(row.inline, id));
}

/**
 * 짧은 갈림 조각에 앞뒤 공통 텍스트를 조금 붙인다.
 * 낱말 가운데서 자르지 않도록 경계는 Intl.Segmenter 가 잡는다 — 띄어쓰기가 없는
 * 중국어·일본어·태국어에서도 통째로 끌려오지 않는다.
 */
function withContext(segments: TripleSegment[]): TripleSegment[] {
  return segments.map((seg, i) => {
    if (seg.kind !== 'divergent') return seg;

    const longest = Math.max(graphemes(seg.left).length, graphemes(seg.right).length);
    if (longest >= SHORT) return seg;

    const prev = segments[i - 1];
    const next = segments[i + 1];
    const prevText = prev?.kind === 'common' ? prev.text : '';
    const nextText = next?.kind === 'common' ? next.text : '';

    // 잘려 나온 맥락이면 말줄임을 붙여, 문단이 거기서 시작·끝나는 게 아님을 알린다.
    const tail = contextTail(prevText, CONTEXT);
    const head = contextHead(nextText, CONTEXT);
    const before = tail && (tail === prevText ? tail : '…' + tail);
    const after = head && (head === nextText ? head : head + '…');
    if (!before && !after) return seg;

    return {
      ...seg,
      ...(before ? { before } : {}),
      ...(after ? { after } : {}),
    };
  });
}

/** 연속된 같은 성격의 스팬은 하나로 모은다. 한 글자마다 줄이 갈리면 읽을 수 없다. */
function fromSpans(spans: readonly InlineSpan[], id: (n: number) => string): TripleSegment[] {
  const out: TripleSegment[] = [];
  let common = '';
  let left = '';
  let right = '';

  const flushCommon = () => {
    if (!common) return;
    out.push({ kind: 'common', id: id(out.length), text: common });
    common = '';
  };
  const flushDivergent = () => {
    if (!left && !right) return;
    out.push({ kind: 'divergent', id: id(out.length), left, right });
    left = '';
    right = '';
  };

  for (const s of spans) {
    if (s.kind === 'equal') {
      flushDivergent();
      common += s.text;
    } else {
      flushCommon();
      if (s.kind === 'delete') left += s.text;
      else right += s.text;
    }
  }
  flushDivergent();
  flushCommon();

  return out;
}

/** 이 행이 가운데에 남길 본문. 나중에 "합의된 문서"를 뽑아 쓸 자리다. */
export function commonTextOf(segments: readonly TripleSegment[]): string {
  return segments
    .filter((s): s is CommonSegment => s.kind === 'common')
    .map((s) => s.text)
    .join('');
}
