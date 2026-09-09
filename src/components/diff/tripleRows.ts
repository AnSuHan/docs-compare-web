import type { DiffRow, InlineSpan } from '@/core/types';

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
}

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

  return fromSpans(row.inline, id);
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
