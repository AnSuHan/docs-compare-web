import { Suspense, lazy, useEffect, useState } from 'react';
import { useApp } from '@/store';
import { FileSlot } from '@/components/upload/FileSlot';
import { UnifiedView } from '@/components/diff/UnifiedView';
import { WarningBanner } from '@/components/common/WarningBanner';
import { ping } from '@/workers/client';

// 스파이크 도구는 pdfjs 를 끌어온다. 절대 초기 번들에 들어가면 안 된다.
const SpikePanel = lazy(() => import('@/spikes/SpikePanel').then((m) => ({ default: m.SpikePanel })));

export default function App() {
  const { files, mode, docs, diff, progress, error, busy, setFile, run, cancel, reset } = useApp();
  const [worker, setWorker] = useState<string>('확인 중');
  const [showSpikes, setShowSpikes] = useState(false);

  // T-003 의 완료 기준: UI 에서 워커를 호출해 응답을 받는다.
  useEffect(() => {
    ping().then((r) => setWorker(`워커 v${r.version}`)).catch(() => setWorker('워커 연결 실패'));
  }, []);

  const canRun = mode.kind === 'compare' && !busy;

  return (
    <div className="mx-auto max-w-4xl px-6 py-12">
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
        {mode.kind === 'viewer-split' && '형식이 서로 달라 비교할 수 없습니다. 뷰어로 나란히 볼 수 있습니다.'}
        {mode.kind === 'compare' && mode.crossFormat && '확장자가 서로 달라 차이가 실제보다 크게 보일 수 있습니다.'}
        {mode.kind === 'viewer-single' && '비교하려면 파일이 하나 더 필요합니다.'}
      </div>

      <div className="mt-4 flex items-center gap-3">
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
          <button type="button" onClick={reset} className="text-sm text-[var(--color-ink-400)] underline underline-offset-4">
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
        </p>
      )}

      {diff && (
        <section className="mt-8 space-y-4">
          <WarningBanner warnings={[...(docs[0]?.warnings ?? []), ...(docs[1]?.warnings ?? [])]} />
          <p className="text-sm">
            추가 {diff.stats.insertBlocks} · 삭제 {diff.stats.deleteBlocks} · 동일 {diff.stats.equalBlocks}
            {diff.rows.every((r) => r.kind === 'equal') && ' — 두 문서가 동일합니다.'}
          </p>
          <UnifiedView diff={diff} />
        </section>
      )}

      <footer className="mt-16 border-t border-[var(--color-ink-200)] pt-6">
        <button
          type="button"
          onClick={() => setShowSpikes((v) => !v)}
          className="text-sm text-[var(--color-ink-400)] underline underline-offset-4"
        >
          {showSpikes ? '스파이크 도구 접기' : '스파이크 도구 열기 (T-004 ~ T-006)'}
        </button>
        {showSpikes && (
          <Suspense fallback={<p className="mt-4 text-sm">도구 불러오는 중…</p>}>
            <SpikePanel />
          </Suspense>
        )}
      </footer>
    </div>
  );
}
