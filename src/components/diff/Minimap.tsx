import type { DiffResult } from '@/core/types';

/**
 * F-10 — 미니맵.
 *
 * 300쪽짜리 계약서에서 "변경이 앞쪽에 몰렸는지 뒤쪽에 흩어졌는지"는 스크롤바로는
 * 절대 안 보인다. 문서 전체를 세로 한 줄로 압축해 변경 위치를 찍는다.
 *
 * 눌러서 그 변경으로 바로 간다.
 */
export function Minimap({
  diff,
  cursor,
  onPick,
}: {
  diff: DiffResult;
  cursor: number;
  onPick: (changeIndex: number) => void;
}) {
  const total = diff.rows.length;
  if (total === 0 || diff.changeIndices.length === 0) return null;

  return (
    <div
      className="relative w-3 shrink-0 overflow-hidden rounded border border-[var(--color-ink-200)] bg-[var(--color-ink-100)]"
      role="navigation"
      aria-label="변경 위치"
    >
      {diff.changeIndices.map((rowIndex, i) => {
        const row = diff.rows[rowIndex];
        if (!row) return null;

        const top = (rowIndex / total) * 100;
        const color =
          row.kind === 'insert'
            ? 'var(--color-add-strong)'
            : row.kind === 'delete'
              ? 'var(--color-del-strong)'
              : 'var(--color-accent)';

        return (
          <button
            key={rowIndex}
            type="button"
            onClick={() => onPick(i)}
            title={`${i + 1}번째 변경 (${label(row.kind)})`}
            aria-label={`${i + 1}번째 변경으로 이동`}
            // 클릭 표적이 1px 이면 못 누른다. 보이는 막대는 얇게, 누르는 영역은 넉넉히.
            className="absolute left-0 w-full"
            style={{ top: `calc(${top}% - 3px)`, height: 7 }}
          >
            <span
              aria-hidden
              className="block w-full"
              style={{
                background: color,
                height: 3,
                marginTop: 2,
                outline: i === cursor ? '1px solid var(--color-ink-900)' : 'none',
              }}
            />
          </button>
        );
      })}
    </div>
  );
}

function label(kind: DiffResult['rows'][number]['kind']): string {
  return kind === 'insert' ? '추가' : kind === 'delete' ? '삭제' : '수정';
}
