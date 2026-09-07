import { useCallback, useEffect, useMemo, useState } from 'react';
import { useApp } from '@/store';
import { FileSlot } from '@/components/upload/FileSlot';
import { DiffView } from '@/components/diff/DiffView';
import { SummaryBar } from '@/components/diff/SummaryBar';
import { OptionToggles } from '@/components/diff/OptionToggles';
import { WarningBanner } from '@/components/common/WarningBanner';
import { ShortcutsHelp, useShortcuts } from '@/components/common/Shortcuts';
import { ping } from '@/workers/client';
import { navigate } from './routes';

/** §9.6 — 좁은 화면에서는 Split 을 강제로 끈다. 양쪽 다 못 읽는다. */
function useWideScreen(): boolean {
  const [wide, setWide] = useState(() =>
    typeof window === 'undefined' ? true : window.matchMedia('(min-width: 768px)').matches,
  );

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)');
    const onChange = (e: MediaQueryListEvent) => setWide(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  return wide;
}

export default function App() {
  const {
    files, mode, docs, diff, progress, error, busy, normalizeOptions, view, cursor,
    setFile, swap, run, cancel, reset, setView, next, prev, setOption,
  } = useApp();

  const [worker, setWorker] = useState<string>('확인 중');
  const [helpOpen, setHelpOpen] = useState(false);
  const wide = useWideScreen();
  const effectiveView = wide ? view : 'unified';

  // T-003 의 완료 기준: UI 에서 워커를 호출해 응답을 받는다.
  useEffect(() => {
    ping().then((r) => setWorker(`워커 v${r.version}`)).catch(() => setWorker('워커 연결 실패'));
  }, []);

  const handlers = useMemo(
    () => ({
      next,
      prev,
      toggleView: () => setView(view === 'split' ? 'unified' : 'split'),
      toggleWhitespace: () => void setOption('ignoreWhitespace', !normalizeOptions.ignoreWhitespace),
      escape: () => {
        if (helpOpen) setHelpOpen(false);
        else if (busy) cancel();
      },
      help: () => setHelpOpen((v) => !v),
    }),
    [next, prev, setView, view, setOption, normalizeOptions.ignoreWhitespace, helpOpen, busy, cancel],
  );
  useShortcuts(handlers);

  const canRun = mode.kind === 'compare' && !busy;
  const names = useMemo(
    () => [files[0]?.name ?? '이전', files[1]?.name ?? '이후'] as [string, string],
    [files],
  );
  const onOption = useCallback(setOption, [setOption]);

  return (
    <div className="mx-auto max-w-5xl px-6 py-12">
      <header className="mb-10">
        <h1 className="text-2xl font-semibold tracking-tight">DocDiff</h1>
        <p className="mt-2 max-w-prose text-[var(--color-ink-600)]">
          문서 두 개를 놓으면 달라진 부분을 찾아 보여줍니다.
          파일은 이 브라우저 안에서만 처리되고 어디로도 전송되지 않습니다.
        </p>
      </header>

      <section className="grid gap-4 sm:grid-cols-2">
        <FileSlot label="이전" file={files[0]} onPick={(f) => setFile(0, f)} disabled={busy} />
        <FileSlot label="이후" file={files[1]} onPick={(f) => setFile(1, f)} disabled={busy} />
      </section>

      <div className="mt-4 min-h-6 text-sm text-[var(--color-ink-600)]">
        {mode.kind === 'viewer-split' && '형식이 서로 달라 비교할 수 없습니다. 같은 형식끼리 올려주세요.'}
        {mode.kind === 'compare' && mode.crossFormat && '확장자가 서로 달라 차이가 실제보다 크게 보일 수 있습니다.'}
        {mode.kind === 'viewer-single' && '비교하려면 파일이 하나 더 필요합니다.'}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={!canRun}
          onClick={() => void run()}
          className="rounded bg-[var(--color-accent)] px-4 py-2 text-white disabled:opacity-40"
        >
          비교하기
        </button>
        {busy && (
          <button type="button" onClick={cancel} className="rounded border border-[var(--color-ink-200)] px-4 py-2">
            중단
          </button>
        )}
        {(files[0] || files[1]) && !busy && (
          <button
            type="button"
            onClick={reset}
            className="text-sm text-[var(--color-ink-400)] underline underline-offset-4"
          >
            처음부터
          </button>
        )}
        <span className="ml-auto text-xs text-[var(--color-ink-400)]">{worker}</span>
      </div>

      {progress && (
        <p
          role="progressbar"
          aria-valuenow={progress.current}
          aria-valuemax={progress.total}
          className="mt-4 text-sm text-[var(--color-ink-600)]"
        >
          {progress.phase} {progress.current}/{progress.total} {progress.label ?? ''}
        </p>
      )}

      {error && (
        <p className="mt-4 rounded-lg border border-[var(--color-del-strong)] bg-[var(--color-del-bg)] p-3 text-sm">
          {error.message}
          {error.detail && <span className="block text-xs text-[var(--color-ink-600)]">{error.detail}</span>}
        </p>
      )}

      {diff && (
        <section className="mt-8 space-y-4">
          <SummaryBar
            diff={diff}
            names={names}
            view={effectiveView}
            onView={setView}
            cursor={cursor}
            onPrev={prev}
            onNext={next}
            onSwap={() => {
              swap();
              void run();
            }}
            canSplit={wide}
          />
          <WarningBanner docs={docs} />
          <OptionToggles options={normalizeOptions} onChange={onOption} disabled={busy} />
          <DiffView diff={diff} view={effectiveView} cursor={cursor} collapse />
        </section>
      )}

      <footer className="mt-16 flex flex-wrap items-center gap-4 border-t border-[var(--color-ink-200)] pt-6 text-sm">
        <button
          type="button"
          onClick={() => navigate('/docdiff/admin')}
          className="text-[var(--color-ink-400)] underline underline-offset-4"
        >
          관리 · 진단 화면
        </button>
        <button
          type="button"
          onClick={() => setHelpOpen(true)}
          className="text-[var(--color-ink-400)] underline underline-offset-4"
        >
          단축키 (?)
        </button>
        <span className="ml-auto text-xs text-[var(--color-ink-400)]">
          지원 형식: txt · md · docx · pdf · hwp · hwpx
        </span>
      </footer>

      <ShortcutsHelp open={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  );
}
