import { useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { DiffResult } from '@/core/types';
import type { ViewMode } from '@/store';
import { DiffRowView, locationOf } from './DiffRowView';
import { CollapsedGap } from './CollapsedGap';
import { buildViewItems, findViewIndex } from './rows';

/**
 * §9.5 — 비교 결과 렌더러.
 *
 * Split 뷰를 두 개의 스크롤러로 만들면 동기 스크롤 로직이 필요해지고, 그건
 * 거의 항상 미묘하게 어긋난다. **하나의 스크롤 컨테이너 안에 2열 그리드**로
 * 그리면 그 문제가 통째로 사라진다 — 기획서가 못박은 방식이다.
 *
 * 그래서 Unified 와 Split 이 같은 가상 스크롤러를 공유한다.
 */
export function DiffView({
  diff,
  view,
  cursor,
  collapse,
}: {
  diff: DiffResult;
  view: ViewMode;
  cursor: number;
  collapse: boolean;
}) {
  const parent = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(() => new Set());

  // diff 가 바뀌면 접기 상태를 초기화한다. 옛 인덱스는 의미가 없다.
  useEffect(() => {
    setExpanded(new Set());
  }, [diff]);

  const items = useMemo(() => buildViewItems(diff, { collapse, expanded }), [diff, collapse, expanded]);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parent.current,
    estimateSize: () => 44,
    overscan: 12,
  });

  // 변경점 점프. cursor 는 changeIndices 안의 위치다.
  useEffect(() => {
    if (cursor < 0) return;
    const rowIndex = diff.changeIndices[cursor];
    if (rowIndex === undefined) return;
    const viewIndex = findViewIndex(items, rowIndex);
    if (viewIndex >= 0) virtualizer.scrollToIndex(viewIndex, { align: 'center' });
  }, [cursor, diff, items, virtualizer]);

  const currentRow = cursor >= 0 ? diff.changeIndices[cursor] : undefined;

  return (
    <div
      ref={parent}
      className="h-[65vh] overflow-auto rounded-lg border border-[var(--color-ink-200)]"
      tabIndex={0}
    >
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualizer.getVirtualItems().map((v) => {
          const item = items[v.index]!;
          return (
            <div
              key={v.key}
              ref={virtualizer.measureElement}
              data-index={v.index}
              style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${v.start}px)` }}
            >
              {item.kind === 'gap' ? (
                <CollapsedGap count={item.count} onExpand={() => setExpanded((s) => new Set(s).add(item.runStart))} />
              ) : view === 'split' ? (
                <SplitRow diff={diff} index={item.index} focused={item.index === currentRow} />
              ) : (
                <UnifiedRow diff={diff} index={item.index} focused={item.index === currentRow} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function focusRing(focused: boolean): string {
  return focused ? 'ring-2 ring-inset ring-[var(--color-accent)]' : '';
}

function UnifiedRow({ diff, index, focused }: { diff: DiffResult; index: number; focused: boolean }) {
  const row = diff.rows[index]!;
  const loc = locationOf(row);
  return (
    <div className={['flex', focusRing(focused)].join(' ')}>
      <span className="w-12 shrink-0 select-none border-r border-[var(--color-ink-200)] px-2 py-2 text-right font-[var(--font-mono)] text-xs text-[var(--color-ink-400)]">
        {loc}
      </span>
      <div className="min-w-0 flex-1">
        <DiffRowView row={row} side="both" />
      </div>
    </div>
  );
}

function SplitRow({ diff, index, focused }: { diff: DiffResult; index: number; focused: boolean }) {
  const row = diff.rows[index]!;
  return (
    <div className={['grid grid-cols-2 divide-x divide-[var(--color-ink-200)]', focusRing(focused)].join(' ')}>
      <div className="min-w-0">
        <DiffRowView row={row} side="left" />
      </div>
      <div className="min-w-0">
        <DiffRowView row={row} side="right" />
      </div>
    </div>
  );
}
