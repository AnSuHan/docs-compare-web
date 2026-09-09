import { useMemo } from 'react';
import type { DiffRow } from '@/core/types';
import { locationOf } from './DiffRowView';
import { toTripleSegments, type TripleSegment } from './tripleRows';

/**
 * 세 칸 보기의 한 행.
 *
 * 가운데는 두 문서가 같은 부분, 왼쪽은 이전에만 있는 것, 오른쪽은 이후에만 있는 것.
 * 문단 하나가 "공통 → 갈림 → 공통" 처럼 여러 줄로 펼쳐질 수 있고, 가운데 열만
 * 세로로 훑으면 합의된 본문이 그대로 읽힌다.
 *
 * 나중에 가운데를 직접 편집하게 되면 여기 common 칸이 그 입력 자리가 된다.
 * 조각을 만드는 계산은 tripleRows.ts 에 순수 함수로 있다.
 */

/** 위치(쪽·구역) + 세 칸. 헤더와 본문이 같은 격자를 쓴다. */
const GRID = 'grid grid-cols-[3rem_1fr_1fr_1fr]';

export function TripleHeader({ names }: { names: [string, string] }) {
  const cell = 'truncate px-3 py-1.5 text-xs font-medium text-[var(--color-ink-600)]';
  return (
    <div
      className={[
        GRID,
        'sticky top-0 z-10 border-b border-[var(--color-ink-200)] bg-[var(--color-ink-100)]',
      ].join(' ')}
    >
      <span aria-hidden />
      <span className={cell} title={names[0]}>
        {names[0]} 에만
      </span>
      <span className={cell}>공통</span>
      <span className={cell} title={names[1]}>
        {names[1]} 에만
      </span>
    </div>
  );
}

export function TripleRow({ row, index, focused }: { row: DiffRow; index: number; focused: boolean }) {
  const segments = useMemo(() => toTripleSegments(row, index), [row, index]);
  const loc = locationOf(row);

  if (segments.length === 0) return null;

  return (
    <div className={focused ? 'ring-2 ring-inset ring-[var(--color-accent)]' : ''}>
      {segments.map((seg, i) => (
        <SegmentLine key={seg.id} seg={seg} loc={i === 0 ? loc : ''} />
      ))}
    </div>
  );
}

function SegmentLine({ seg, loc }: { seg: TripleSegment; loc: string }) {
  return (
    <div className={[GRID, 'divide-x divide-[var(--color-ink-200)]'].join(' ')}>
      <span className="select-none px-2 py-2 text-right font-[var(--font-mono)] text-xs text-[var(--color-ink-400)]">
        {loc}
      </span>

      {seg.kind === 'common' ? (
        <>
          <Cell />
          <Cell text={seg.text} label="공통" />
          <Cell />
        </>
      ) : (
        <>
          <Cell text={seg.left} tone="del" label="이전에만 있음" />
          <Cell />
          <Cell text={seg.right} tone="add" label="이후에만 있음" />
        </>
      )}
    </div>
  );
}

function Cell({ text, tone, label }: { text?: string; tone?: 'del' | 'add'; label?: string }) {
  const filled = !!text;
  const bg = !filled ? '' : tone === 'del' ? 'bg-[var(--color-del-bg)]' : tone === 'add' ? 'bg-[var(--color-add-bg)]' : '';

  return (
    <span
      className={['min-w-0 whitespace-pre-wrap break-words px-3 py-2 text-[15px] leading-relaxed', bg].join(' ')}
      aria-label={filled ? label : undefined}
    >
      {filled ? (
        text
      ) : (
        // 빈 칸도 자리를 지켜야 세 열이 어긋나지 않는다. 무엇도 없다는 뜻은 기호로 남긴다.
        <span aria-hidden className="text-[var(--color-ink-400)]">
          ·
        </span>
      )}
    </span>
  );
}
