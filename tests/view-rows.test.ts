import { describe, expect, it } from 'vitest';
import { buildViewItems, findViewIndex, CONTEXT, MIN_COLLAPSE } from '../src/components/diff/rows';
import type { DiffResult, DiffRow } from '../src/core/types';

/** kind 문자열만으로 rows 를 만든다. 접기 계산은 내용과 무관하다. */
function rows(kinds: string): Pick<DiffResult, 'rows'> {
  const map: Record<string, DiffRow['kind']> = { '=': 'equal', '+': 'insert', '-': 'delete', '~': 'modify' };
  return { rows: [...kinds].map((c) => ({ kind: map[c]! })) };
}

const shape = (items: ReturnType<typeof buildViewItems>) =>
  items.map((i) => (i.kind === 'gap' ? `gap(${i.count})` : `r${i.index}`)).join(' ');

describe('buildViewItems', () => {
  it('접기를 끄면 모든 행이 그대로 나온다', () => {
    const items = buildViewItems(rows('=+=-='), { collapse: false });
    expect(items).toHaveLength(5);
    expect(items.every((i) => i.kind === 'row')).toBe(true);
  });

  it('짧은 동일 구간은 접지 않는다', () => {
    const items = buildViewItems(rows('+===+'));
    expect(items.every((i) => i.kind === 'row')).toBe(true);
  });

  it('긴 동일 구간은 앞뒤 맥락만 남기고 접는다', () => {
    // + 다음에 동일 20행, 그 다음 +
    const items = buildViewItems(rows('+' + '='.repeat(20) + '+'));
    const gaps = items.filter((i) => i.kind === 'gap');

    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({ count: 20 - CONTEXT * 2 });
    // 변경행 2개 + 앞뒤 맥락 3+3 + 접힘 1
    expect(items).toHaveLength(2 + CONTEXT * 2 + 1);
  });

  it('문서 맨 앞뒤의 동일 구간은 맥락을 한쪽만 남긴다', () => {
    const items = buildViewItems(rows('='.repeat(20) + '+'));
    const gap = items.find((i) => i.kind === 'gap');
    // 앞쪽은 맥락이 필요 없다 → 20 - 0(head) - 3(tail)
    expect(gap).toMatchObject({ count: 20 - CONTEXT });
  });

  it('전부 동일한 문서도 접는다', () => {
    const items = buildViewItems(rows('='.repeat(30)));
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'gap', count: 30 });
  });

  it('펼친 구간은 다시 모두 보여준다', () => {
    const kinds = '+' + '='.repeat(20) + '+';
    const collapsed = buildViewItems(rows(kinds));
    const gap = collapsed.find((i) => i.kind === 'gap')!;

    const expanded = buildViewItems(rows(kinds), { collapse: true, expanded: new Set([gap.runStart]) });
    expect(expanded.every((i) => i.kind === 'row')).toBe(true);
    expect(expanded).toHaveLength(22);
  });

  it('접기 경계가 MIN_COLLAPSE 를 따른다', () => {
    // 숨겨지는 행이 MIN_COLLAPSE 미만이면 접지 않는다
    const justUnder = CONTEXT * 2 + MIN_COLLAPSE - 1;
    expect(buildViewItems(rows('+' + '='.repeat(justUnder) + '+')).some((i) => i.kind === 'gap')).toBe(false);

    const justOver = CONTEXT * 2 + MIN_COLLAPSE;
    expect(buildViewItems(rows('+' + '='.repeat(justOver) + '+')).some((i) => i.kind === 'gap')).toBe(true);
  });

  it('행 순서가 원본 순서를 유지한다', () => {
    const items = buildViewItems(rows('+==-'), { collapse: false });
    expect(shape(items)).toBe('r0 r1 r2 r3');
  });
});

describe('findViewIndex', () => {
  const kinds = '+' + '='.repeat(20) + '+';
  const items = buildViewItems(rows(kinds));

  it('변경 행의 화면 위치를 찾는다', () => {
    expect(findViewIndex(items, 0)).toBe(0);
    expect(findViewIndex(items, 21)).toBe(items.length - 1);
  });

  it('접힌 행을 찾으면 그 접기 자리를 준다', () => {
    const gapIndex = items.findIndex((i) => i.kind === 'gap');
    const gap = items[gapIndex]!;
    if (gap.kind !== 'gap') throw new Error('gap 이어야 한다');
    expect(findViewIndex(items, gap.from)).toBe(gapIndex);
    expect(findViewIndex(items, gap.to)).toBe(gapIndex);
  });

  it('없는 행이면 -1', () => {
    expect(findViewIndex(items, 999)).toBe(-1);
  });
});
