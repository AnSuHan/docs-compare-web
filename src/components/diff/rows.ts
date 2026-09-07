import type { DiffResult } from '@/core/types';

/**
 * F-09 동일 구간 접기.
 *
 * 계약서 두 벌을 비교하면 대부분이 '동일'이다. 그걸 전부 그리면 사용자가
 * 스크롤만 하다 끝난다. 변경 주변 몇 줄만 남기고 접는다.
 *
 * 가상 스크롤이 이 배열을 그대로 아이템으로 쓰므로, 접기 계산은 렌더 전에
 * 한 번만 하고 순수 함수로 둔다(테스트 가능).
 */

export interface RowItem {
  kind: 'row';
  /** diff.rows 인덱스 */
  index: number;
}

export interface GapItem {
  kind: 'gap';
  /** 접힌 첫 행 (포함) */
  from: number;
  /** 접힌 마지막 행 (포함) */
  to: number;
  count: number;
  /** 이 접기가 속한 동일 구간의 시작 인덱스. 펼치기의 열쇠다. */
  runStart: number;
}

export type ViewItem = RowItem | GapItem;

/** 변경 앞뒤로 남겨 두는 동일 행 수. 맥락이 없으면 무엇이 바뀐 건지 못 읽는다. */
export const CONTEXT = 3;
/** 이보다 짧은 동일 구간은 접어도 이득이 없다. */
export const MIN_COLLAPSE = 6;

export function buildViewItems(
  diff: Pick<DiffResult, 'rows'>,
  opts: { collapse: boolean; expanded?: ReadonlySet<number> } = { collapse: true },
): ViewItem[] {
  const rows = diff.rows;
  const expanded = opts.expanded ?? new Set<number>();

  if (!opts.collapse) return rows.map((_, index) => ({ kind: 'row', index }));

  const out: ViewItem[] = [];
  let i = 0;

  while (i < rows.length) {
    if (rows[i]!.kind !== 'equal') {
      out.push({ kind: 'row', index: i });
      i++;
      continue;
    }

    // 동일 구간의 끝을 찾는다.
    let end = i;
    while (end < rows.length && rows[end]!.kind === 'equal') end++;
    const runLength = end - i;

    // 문서 처음/끝의 동일 구간은 맥락을 한쪽만 남긴다.
    const head = i === 0 ? 0 : CONTEXT;
    const tail = end === rows.length ? 0 : CONTEXT;
    const hidden = runLength - head - tail;

    if (hidden < MIN_COLLAPSE || expanded.has(i)) {
      for (let k = i; k < end; k++) out.push({ kind: 'row', index: k });
    } else {
      for (let k = i; k < i + head; k++) out.push({ kind: 'row', index: k });
      out.push({ kind: 'gap', from: i + head, to: end - tail - 1, count: hidden, runStart: i });
      for (let k = end - tail; k < end; k++) out.push({ kind: 'row', index: k });
    }
    i = end;
  }

  return out;
}

/** diff.rows 인덱스 → 화면 아이템 인덱스. 변경점 점프에 쓴다. */
export function findViewIndex(items: readonly ViewItem[], rowIndex: number): number {
  for (let i = 0; i < items.length; i++) {
    const it = items[i]!;
    if (it.kind === 'row' && it.index === rowIndex) return i;
    if (it.kind === 'gap' && rowIndex >= it.from && rowIndex <= it.to) return i;
  }
  return -1;
}
