import { useEffect } from 'react';

/**
 * §2.3 — 단축키.
 *
 * 입력 칸에 글자를 치는 중에는 동작하면 안 된다. 그래서 target 을 먼저 본다.
 */
export interface ShortcutHandlers {
  next(): void;
  prev(): void;
  toggleView(): void;
  toggleWhitespace(): void;
  escape(): void;
  help(): void;
}

const KEYS: Array<{ keys: string[]; action: keyof ShortcutHandlers }> = [
  { keys: ['n', 'j'], action: 'next' },
  { keys: ['p', 'k'], action: 'prev' },
  { keys: ['s'], action: 'toggleView' },
  { keys: ['w'], action: 'toggleWhitespace' },
  { keys: ['Escape'], action: 'escape' },
  { keys: ['?'], action: 'help' },
];

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

export function useShortcuts(handlers: ShortcutHandlers, enabled = true): void {
  useEffect(() => {
    if (!enabled) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (isTyping(e.target)) return;

      const hit = KEYS.find((k) => k.keys.includes(e.key));
      if (!hit) return;
      e.preventDefault();
      handlers[hit.action]();
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handlers, enabled]);
}

const HELP: Array<[string, string]> = [
  ['n / j', '다음 변경점'],
  ['p / k', '이전 변경점'],
  ['s', '나란히 ↔ 한 줄로'],
  ['w', '공백 무시 토글'],
  ['Esc', '처리 취소 / 닫기'],
  ['?', '이 도움말'],
];

export function ShortcutsHelp({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="단축키"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-lg border border-[var(--color-ink-200)] bg-[var(--color-ink-50)] p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-medium">단축키</h2>
        <dl className="mt-3 space-y-1.5 text-sm">
          {HELP.map(([key, what]) => (
            <div key={key} className="flex justify-between gap-4">
              <dt className="font-[var(--font-mono)] text-[var(--color-ink-600)]">{key}</dt>
              <dd className="text-[var(--color-ink-400)]">{what}</dd>
            </div>
          ))}
        </dl>
        <button
          type="button"
          onClick={onClose}
          className="mt-4 w-full rounded border border-[var(--color-ink-200)] px-3 py-1.5 text-sm hover:bg-[var(--color-ink-100)]"
        >
          닫기
        </button>
      </div>
    </div>
  );
}
