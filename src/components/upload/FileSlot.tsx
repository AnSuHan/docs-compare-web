import { useRef, useState } from 'react';
import { SUPPORTED_EXTS, extOf } from '@/core/detect';

interface Props {
  label: string;
  file: File | null;
  onPick: (f: File | null) => void;
  disabled?: boolean;
}

const ACCEPT = SUPPORTED_EXTS.map((e) => '.' + e).join(',');

export function FileSlot({ label, file, onPick, disabled }: Props) {
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const take = (list: FileList | null) => {
    const f = list?.[0];
    if (f) onPick(f);
  };

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); if (!disabled) take(e.dataTransfer.files); }}
      className={[
        'flex min-h-44 flex-col justify-between rounded-lg border p-5 transition-colors',
        over ? 'border-[var(--color-accent)] bg-[var(--color-ink-100)]' : 'border-[var(--color-ink-200)] bg-transparent',
        disabled ? 'opacity-50' : '',
      ].join(' ')}
    >
      <div className="text-sm text-[var(--color-ink-400)]">{label}</div>

      {file ? (
        <div className="min-w-0">
          <div className="truncate text-[15px] font-medium">{file.name}</div>
          <div className="mt-1 text-sm text-[var(--color-ink-400)]">
            {extOf(file.name)} · {formatBytes(file.size)}
          </div>
        </div>
      ) : (
        <div className="text-[15px] text-[var(--color-ink-400)]">
          여기에 끌어다 놓거나 아래에서 고르세요
        </div>
      )}

      <div className="flex items-center gap-3">
        <input
          ref={input}
          type="file"
          accept={ACCEPT}
          className="sr-only"
          onChange={(e) => take(e.target.files)}
        />
        <button
          type="button"
          disabled={disabled}
          onClick={() => input.current?.click()}
          className="rounded border border-[var(--color-ink-200)] px-3 py-1.5 text-sm hover:bg-[var(--color-ink-100)]"
        >
          파일 고르기
        </button>
        {file && (
          <button
            type="button"
            onClick={() => onPick(null)}
            className="text-sm text-[var(--color-ink-400)] underline underline-offset-4"
          >
            비우기
          </button>
        )}
      </div>
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return n + 'B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(0) + 'KB';
  return (n / 1024 / 1024).toFixed(1) + 'MB';
}
