import type { NormalizeOptions } from '@/core/types';

/**
 * F-08 — 비교 옵션.
 *
 * 토글을 바꿔도 **재파싱하지 않는다**(§4.3). rawText 를 들고 있으므로
 * renormalize + diff 만 다시 돈다. 대용량 PDF 에서 8초 vs 0.5초 차이다.
 */

const LABELS: Array<{ key: keyof NormalizeOptions; label: string; hint: string }> = [
  { key: 'ignoreWhitespace', label: '공백 무시', hint: '연속된 공백·탭을 한 칸으로 봅니다 (w)' },
  { key: 'normalizePunct', label: '구두점 통일', hint: '따옴표·하이픈·말줄임표의 모양 차이를 무시합니다' },
  { key: 'foldWidth', label: '전각→반각', hint: '전각 영숫자와 기호를 반각으로 맞춥니다' },
  { key: 'ignoreCase', label: '대소문자 무시', hint: '영문 대소문자 차이를 무시합니다' },
  { key: 'joinHyphen', label: '하이픈 줄바꿈 결합', hint: '줄 끝 하이픈으로 잘린 라틴 단어를 잇습니다 (PDF)' },
];

export function OptionToggles({
  options,
  onChange,
  disabled,
}: {
  options: NormalizeOptions;
  onChange: <K extends keyof NormalizeOptions>(k: K, v: NormalizeOptions[K]) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset className="flex flex-wrap items-center gap-x-4 gap-y-2" disabled={disabled}>
      <legend className="sr-only">비교 옵션</legend>
      {LABELS.map(({ key, label, hint }) => (
        <label key={key} title={hint} className="flex cursor-pointer items-center gap-1.5 text-sm">
          <input
            type="checkbox"
            checked={options[key]}
            onChange={(e) => onChange(key, e.target.checked)}
            className="size-4 accent-[var(--color-accent)]"
          />
          <span className={options[key] ? '' : 'text-[var(--color-ink-400)]'}>{label}</span>
        </label>
      ))}
    </fieldset>
  );
}
