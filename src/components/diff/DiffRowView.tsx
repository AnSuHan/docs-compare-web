import type { DiffRow } from '@/core/types';
import { InlineSpans } from './InlineSpans';

/**
 * §9.3 — 한 행의 표시 규칙.
 *
 * 거터의 기호(+ − ~)는 항상 보인다. 색만으로 구분하면 색각 이상 사용자가
 * 아무것도 읽지 못한다.
 */

const GUTTER: Record<DiffRow['kind'], string> = {
  equal: ' ',
  insert: '+',
  delete: '−',
  modify: '~',
};

const ARIA: Record<DiffRow['kind'], string> = {
  equal: '',
  insert: '추가된 문단',
  delete: '삭제된 문단',
  modify: '수정된 문단',
};

export function rowBackground(kind: DiffRow['kind'], side: 'left' | 'right' | 'both'): string {
  if (kind === 'insert') return side === 'left' ? '' : 'bg-[var(--color-add-bg)]';
  if (kind === 'delete') return side === 'right' ? '' : 'bg-[var(--color-del-bg)]';
  if (kind === 'modify') return 'bg-[var(--color-ink-100)]';
  return '';
}

/** 위치 표시. PDF 는 쪽, HWP 계열은 구역(페이지 정보가 없다 §7.5). */
export function locationOf(row: DiffRow): string {
  const b = row.right ?? row.left;
  if (!b) return '';
  if (b.source.page !== undefined) return `p.${b.source.page}`;
  if (b.source.section !== undefined) return `§${b.source.section + 1}`;
  return '';
}

export function DiffRowView({ row, side }: { row: DiffRow; side: 'left' | 'right' | 'both' }) {
  const block = side === 'left' ? row.left : side === 'right' ? row.right : (row.right ?? row.left);

  // Split 뷰에서 한쪽에만 있는 행은 빈 칸으로 자리를 지킨다.
  if (!block && side !== 'both') {
    return <div className="px-3 py-2" aria-hidden />;
  }

  const showInline = row.kind === 'modify' && row.inline;

  return (
    <div
      className={['flex gap-2 px-3 py-2 text-[15px] leading-relaxed', rowBackground(row.kind, side)].join(' ')}
      aria-label={ARIA[row.kind] || undefined}
    >
      <span className="w-5 shrink-0 select-none text-center font-[var(--font-mono)] text-[var(--color-ink-400)]">
        {GUTTER[row.kind]}
      </span>
      <span className="min-w-0 whitespace-pre-wrap break-words">
        {showInline ? <InlineSpans spans={row.inline!} side={side} /> : block?.text}
      </span>
    </div>
  );
}
