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
          <Cell text={seg.left} before={seg.before} after={seg.after} tone="del" label="이전에만 있음" />
          <Cell />
          <Cell text={seg.right} before={seg.before} after={seg.after} tone="add" label="이후에만 있음" />
        </>
      )}
    </div>
  );
}

function Cell({
  text,
  before,
  after,
  tone,
  label,
}: {
  text?: string;
  /** 조각이 너무 짧을 때 붙는 읽기 보조. diff 결과가 아니므로 흐리게, 낭독기에는 숨긴다. */
  before?: string;
  after?: string;
  tone?: 'del' | 'add';
  label?: string;
}) {
  const filled = !!text;
  const muted = 'text-[var(--color-ink-400)]';

  /*
    맥락을 붙인 짧은 조각은 흐린 글자들 사이에 한두 자만 놓인다. 옅은 배경으로는
    묻혀 버려서, 인라인 강조와 같은 진한 색을 쓴다. 문단을 통째로 옮긴 경우엔
    반대로 옅은 배경이어야 한다 — 화면 절반이 색으로 덮이면 읽을 수 없다.
  */
  const strong = !!(before || after);
  const tint =
    tone === 'del'
      ? strong
        ? 'bg-[var(--color-del-strong)] text-[var(--color-ink-900)]'
        : 'bg-[var(--color-del-bg)]'
      : tone === 'add'
        ? strong
          ? 'bg-[var(--color-add-strong)] text-[var(--color-ink-900)]'
          : 'bg-[var(--color-add-bg)]'
        : '';

  return (
    // dir=auto + isolate: 아랍어·히브리어 조각을 문맥에서 떼어 놓아도 순서가 뒤집히지 않는다.
    <span
      dir="auto"
      className={[
        'min-w-0 whitespace-pre-wrap break-words px-3 py-2 text-[15px] leading-relaxed [unicode-bidi:isolate]',
      ].join(' ')}
    >
      {/* 빈 칸은 비워 둔다. 자리는 격자가 지키므로 기호를 넣으면 화면만 시끄러워진다. */}
      {filled && before && <span aria-hidden className={muted}>{before}</span>}
      {filled && (
        <span aria-label={label} className={[tint, '[unicode-bidi:isolate]'].join(' ')}>
          {text}
        </span>
      )}
      {filled && after && <span aria-hidden className={muted}>{after}</span>}
    </span>
  );
}
