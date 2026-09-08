import type { DiffResult } from '@/core/types';
import type { ViewMode } from '@/store';

/**
 * §9.2 상단 바 — 무엇이 얼마나 바뀌었고, 지금 몇 번째를 보고 있는가.
 * F-04(변경 요약) + F-05(변경점 점프) + Split/Unified 전환.
 */
export function SummaryBar({
  diff,
  names,
  view,
  onView,
  cursor,
  onPrev,
  onNext,
  onSwap,
  canSplit,
}: {
  diff: DiffResult;
  names: [string, string];
  view: ViewMode;
  onView: (v: ViewMode) => void;
  cursor: number;
  onPrev: () => void;
  onNext: () => void;
  onSwap: () => void;
  canSplit: boolean;
}) {
  const { stats, changeIndices } = diff;
  const total = changeIndices.length;
  const position = cursor >= 0 ? cursor + 1 : 0;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
        <span className="truncate font-medium">{names[0]}</span>
        <button
          type="button"
          onClick={onSwap}
          title="좌우 바꾸기"
          className="rounded px-1 text-[var(--color-ink-400)] hover:bg-[var(--color-ink-100)]"
        >
          ⇄
        </button>
        <span className="truncate font-medium">{names[1]}</span>

        {canSplit && (
          <div className="ml-auto flex overflow-hidden rounded border border-[var(--color-ink-200)]">
            {(['split', 'unified'] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => onView(v)}
                aria-pressed={view === v}
                className={
                  'px-3 py-1 text-xs ' +
                  (view === v ? 'bg-[var(--color-ink-100)] font-medium' : 'text-[var(--color-ink-400)]')
                }
              >
                {v === 'split' ? '나란히' : '한 줄로'}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <span className="font-[var(--font-mono)]">
          <span className="text-[var(--color-add-text)]">+{stats.insertBlocks}</span>{' '}
          <span className="text-[var(--color-del-text)]">−{stats.deleteBlocks}</span>{' '}
          <span className="text-[var(--color-ink-600)]">~{stats.modifyBlocks}</span>
        </span>
        <span className="text-xs text-[var(--color-ink-400)]">
          동일 {stats.equalBlocks} · 글자 +{stats.insertChars} −{stats.deleteChars}
        </span>

        {total === 0 ? (
          <span className="ml-auto text-[var(--color-ink-600)]">두 문서가 같습니다.</span>
        ) : (
          <span className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={onPrev}
              disabled={cursor <= 0}
              title="이전 변경점 (p)"
              className="rounded border border-[var(--color-ink-200)] px-2 py-0.5 disabled:opacity-40"
            >
              ↑
            </button>
            <button
              type="button"
              onClick={onNext}
              disabled={cursor >= total - 1}
              title="다음 변경점 (n)"
              className="rounded border border-[var(--color-ink-200)] px-2 py-0.5 disabled:opacity-40"
            >
              ↓
            </button>
            <span className="font-[var(--font-mono)] text-xs text-[var(--color-ink-400)]">
              {position} / {total}
            </span>
          </span>
        )}
      </div>

      {diff.truncated && (
        <p className="text-xs text-[var(--color-del-text)]">
          시간이 초과돼 앞부분까지만 비교했습니다. 아래 결과는 일부입니다.
        </p>
      )}
    </div>
  );
}
