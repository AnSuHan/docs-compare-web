import { useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { DiffResult, DiffRow } from '@/core/types';

const GUTTER: Record<DiffRow['kind'], string> = {
  equal: ' ',
  insert: '+',
  delete: '\u2212',
  modify: '~',
};

/**
 * M0 최소 렌더러. 가상 스크롤만 확인한다.
 * Split 뷰(T-022)와 인라인 스팬(T-015)은 M1~M2 에서 붙는다.
 */
export function UnifiedView({ diff }: { diff: DiffResult }) {
  const parent = useRef<HTMLDivElement>(null);

  const rows = useVirtualizer({
    count: diff.rows.length,
    getScrollElement: () => parent.current,
    estimateSize: () => 40,
    overscan: 12,
  });

  return (
    <div ref={parent} className="h-[60vh] overflow-auto rounded-lg border border-[var(--color-ink-200)]">
      <div style={{ height: rows.getTotalSize(), position: 'relative' }}>
        {rows.getVirtualItems().map((v) => {
          const row = diff.rows[v.index]!;
          const block = row.right ?? row.left;
          return (
            <div
              key={v.key}
              ref={rows.measureElement}
              data-index={v.index}
              style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${v.start}px)` }}
              className={rowClass(row.kind)}
              aria-label={ariaFor(row.kind)}
            >
              <span className="w-6 shrink-0 select-none text-center font-[var(--font-mono)] text-[var(--color-ink-400)]">
                {GUTTER[row.kind]}
              </span>
              <span className="whitespace-pre-wrap break-words">{block?.text}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function rowClass(kind: DiffRow['kind']): string {
  const base = 'flex gap-2 px-3 py-2 text-[15px] leading-relaxed';
  if (kind === 'insert') return base + ' bg-[var(--color-add-bg)]';
  if (kind === 'delete') return base + ' bg-[var(--color-del-bg)]';
  if (kind === 'modify') return base + ' bg-[var(--color-ink-100)]';
  return base;
}

function ariaFor(kind: DiffRow['kind']): string {
  return kind === 'insert' ? '추가된 문단' : kind === 'delete' ? '삭제된 문단' : kind === 'modify' ? '수정된 문단' : '';
}
