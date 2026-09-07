/** 접힌 동일 구간. 누르면 펼친다(F-09). */
export function CollapsedGap({ count, onExpand }: { count: number; onExpand: () => void }) {
  return (
    <button
      type="button"
      onClick={onExpand}
      className="flex w-full items-center gap-3 border-y border-dashed border-[var(--color-ink-200)] bg-[var(--color-ink-50)] px-3 py-1.5 text-left text-xs text-[var(--color-ink-400)] hover:bg-[var(--color-ink-100)]"
    >
      <span aria-hidden className="w-5 shrink-0 text-center">
        ⋯
      </span>
      <span>같은 문단 {count}개 — 펼치기</span>
    </button>
  );
}
