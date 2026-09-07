import type { ParseWarning } from '@/core/types';

export function WarningBanner({ warnings }: { warnings: ParseWarning[] }) {
  const shown = warnings.filter((w) => w.severity !== 'info');
  if (shown.length === 0) return null;

  return (
    <ul className="space-y-1 rounded-lg border border-[var(--color-ink-200)] bg-[var(--color-ink-100)] p-3 text-sm">
      {shown.map((w, i) => (
        <li key={i} className="flex gap-2">
          <span aria-hidden className="shrink-0">{w.severity === 'error' ? '\u2715' : '\u26a0'}</span>
          <span>{w.message}</span>
        </li>
      ))}
    </ul>
  );
}
