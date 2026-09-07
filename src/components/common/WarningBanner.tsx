import { useState } from 'react';
import type { NormalizedDoc, ParseWarning } from '@/core/types';

/**
 * F-06 — 경고 배너.
 *
 * §3.3 UI 규칙:
 *   confidence < 0.7  → 노란 경고
 *   confidence == 0   → 비교 차단 (이건 상위에서 에러로 막는다)
 *   두 문서의 신뢰도가 다르면 **낮은 쪽**을 표시한다.
 *
 * info 등급 경고는 접어 둔다. "표를 평탄화했습니다" 같은 안내가 매번 위에
 * 붙어 있으면 정작 중요한 경고를 안 읽게 된다.
 */
export function WarningBanner({ docs }: { docs: Array<NormalizedDoc | null> }) {
  const [showAll, setShowAll] = useState(false);

  const present = docs.filter((d): d is NormalizedDoc => d !== null);
  if (present.length === 0) return null;

  const warnings: Array<ParseWarning & { fileName: string }> = present.flatMap((d) =>
    d.warnings.map((w) => ({ ...w, fileName: d.meta.fileName })),
  );

  const loud = warnings.filter((w) => w.severity !== 'info');
  const quiet = warnings.filter((w) => w.severity === 'info');
  const lowest = present.reduce((min, d) => Math.min(min, d.confidence), 1);
  const lowConfidence = lowest < 0.7;

  if (loud.length === 0 && quiet.length === 0 && !lowConfidence) return null;

  return (
    <div className="space-y-2">
      {lowConfidence && (
        <p
          role="status"
          className="rounded-lg border border-[#f4e6c6] bg-[#fbf6ea] p-3 text-sm text-[#7a6320] dark:border-[#5a4a1e] dark:bg-[#2a2410] dark:text-[#e6d9a8]"
        >
          이 비교의 신뢰도가 낮습니다 ({lowest.toFixed(2)}). 원문과 대조해 확인해 주세요.
        </p>
      )}

      {loud.length > 0 && (
        <ul className="space-y-1 rounded-lg border border-[var(--color-ink-200)] bg-[var(--color-ink-100)] p-3 text-sm">
          {loud.map((w, i) => (
            <li key={i} className="flex gap-2">
              <span aria-hidden className="shrink-0">
                {w.severity === 'error' ? '✕' : '⚠'}
              </span>
              <span>
                {w.message}
                {w.detail && <span className="text-[var(--color-ink-400)]"> — {w.detail}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}

      {quiet.length > 0 && (
        <div className="text-xs">
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="text-[var(--color-ink-400)] underline underline-offset-4"
          >
            {showAll ? '처리 내역 접기' : `처리 내역 ${quiet.length}건 보기`}
          </button>
          {showAll && (
            <ul className="mt-2 space-y-1 text-[var(--color-ink-400)]">
              {quiet.map((w, i) => (
                <li key={i}>
                  · [{w.fileName}] {w.message}
                  {w.detail && ` — ${w.detail}`}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
