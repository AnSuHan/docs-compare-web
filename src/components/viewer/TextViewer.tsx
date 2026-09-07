import { useEffect, useState } from 'react';
import type { Block, NormalizedDoc } from '@/core/types';
import { DEFAULT_NORMALIZE } from '@/core/normalize';
import { groupOf } from '@/core/detect';
import { AppError } from '@/core/errors';
import { parseFile } from '@/workers/client';

/**
 * §9.1 SC-04/05 — 텍스트 계열 뷰어.
 *
 * 비교는 못 해도 내용은 볼 수 있어야 한다. 이미 있는 파서를 그대로 써서
 * 블록을 뽑고 문서 구조(제목·목록·표)를 살려 보여준다.
 */
export function TextViewer({ file }: { file: File }) {
  const [doc, setDoc] = useState<NormalizedDoc | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setDoc(null);
    setError(null);

    const options = (() => {
      try {
        return DEFAULT_NORMALIZE[groupOf(file.name)];
      } catch {
        return DEFAULT_NORMALIZE.text;
      }
    })();

    parseFile(file, options, () => {}, () => cancelled)
      .then((d) => {
        if (!cancelled) setDoc(d);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof AppError ? e.message : String(e));
      });

    return () => {
      cancelled = true;
    };
  }, [file]);

  if (error) {
    return (
      <p className="rounded border border-[var(--color-del-strong)] bg-[var(--color-del-bg)] p-3 text-sm">{error}</p>
    );
  }
  if (!doc) return <p className="text-sm text-[var(--color-ink-600)]">읽는 중…</p>;
  if (doc.blocks.length === 0) {
    return <p className="text-sm text-[var(--color-ink-600)]">내용이 없습니다.</p>;
  }

  return (
    <div className="space-y-3">
      {doc.blocks.map((b) => (
        <BlockView key={b.id} block={b} />
      ))}
    </div>
  );
}

function BlockView({ block }: { block: Block }) {
  const text = block.rawText || block.text;

  switch (block.type) {
    case 'heading': {
      const size = block.level === 1 ? 'text-xl' : block.level === 2 ? 'text-lg' : 'text-base';
      return <p className={`${size} font-semibold tracking-tight`}>{text}</p>;
    }
    case 'listItem':
      return (
        <p className="flex gap-2" style={{ paddingLeft: (block.level ?? 0) * 16 }}>
          <span aria-hidden className="text-[var(--color-ink-400)]">
            ·
          </span>
          <span className="whitespace-pre-wrap break-words">{text}</span>
        </p>
      );
    case 'quote':
      return (
        <p className="border-l-2 border-[var(--color-ink-200)] pl-3 text-[var(--color-ink-600)] whitespace-pre-wrap">
          {text}
        </p>
      );
    case 'code':
      return (
        <pre className="overflow-auto rounded bg-[var(--color-ink-100)] p-3 text-xs font-[var(--font-mono)]">
          {text}
        </pre>
      );
    case 'table':
      // v1 은 표를 평탄화한다(§7.6). 셀 구분( | )과 행 구분(개행)을 살려 보여준다.
      return (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <tbody>
              {text.split('\n').map((row, r) => (
                <tr key={r}>
                  {row.split(' | ').map((cell, c) => (
                    <td key={c} className="border border-[var(--color-ink-200)] px-2 py-1 align-top">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    default:
      return <p className="whitespace-pre-wrap break-words leading-relaxed">{text}</p>;
  }
}
