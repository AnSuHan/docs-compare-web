import { useEffect, useRef, useState } from 'react';
import type { PasswordAsk } from '@/store';

/**
 * T-040 — 암호가 걸린 PDF 의 비밀번호를 받는다.
 *
 * 비밀번호는 파일과 똑같이 취급한다. 이 브라우저 밖으로 나가지 않고,
 * 저장하지도 않는다(D-01). 그 사실을 모달에 그대로 적는다 —
 * 이 화면에서 비밀번호를 치는 사람이 가장 먼저 궁금해할 것이 그것이다.
 */
export function PasswordPrompt({
  ask,
  onSubmit,
  onCancel,
}: {
  ask: PasswordAsk | null;
  onSubmit: (password: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState('');
  const input = useRef<HTMLInputElement>(null);

  // 파일이 바뀌면(또는 다시 열리면) 앞서 친 값을 들고 있지 않는다.
  useEffect(() => {
    if (ask) {
      setValue('');
      input.current?.focus();
    }
  }, [ask?.key, ask?.wrong]);

  if (!ask) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="PDF 비밀번호"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6"
      onClick={onCancel}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onCancel();
      }}
    >
      <form
        className="w-full max-w-sm rounded-lg border border-[var(--color-ink-200)] bg-[var(--color-ink-50)] p-5"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          if (value) onSubmit(value);
        }}
      >
        <h2 className="text-base font-medium">비밀번호가 필요합니다</h2>
        <p className="mt-2 truncate text-sm text-[var(--color-ink-600)]" title={ask.fileName}>
          {ask.fileName}
        </p>

        <label htmlFor="pdf-password" className="mt-4 block text-sm">
          문서 비밀번호
        </label>
        <input
          id="pdf-password"
          ref={input}
          type="password"
          autoFocus
          autoComplete="off"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          aria-invalid={ask.wrong}
          aria-describedby="pdf-password-note"
          className="mt-1 w-full rounded border border-[var(--color-ink-200)] bg-[var(--color-ink-50)] px-3 py-1.5 text-sm"
        />

        {ask.wrong && (
          <p role="alert" className="mt-2 text-sm text-[var(--color-del-text)]">
            비밀번호가 맞지 않습니다. 다시 입력해 주세요.
          </p>
        )}

        <p id="pdf-password-note" className="mt-3 text-xs text-[var(--color-ink-600)]">
          비밀번호는 이 브라우저 안에서만 쓰입니다. 서버로 전송되지 않고, 저장되지도 않습니다.
        </p>

        <div className="mt-4 flex gap-2">
          <button
            type="submit"
            disabled={!value}
            className="flex-1 rounded bg-[var(--color-accent)] px-3 py-1.5 text-sm text-white disabled:opacity-40"
          >
            열기
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="rounded border border-[var(--color-ink-200)] px-3 py-1.5 text-sm hover:bg-[var(--color-ink-100)]"
          >
            취소
          </button>
        </div>
      </form>
    </div>
  );
}
