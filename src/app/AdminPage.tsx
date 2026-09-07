import { Suspense, lazy, useEffect, useState } from 'react';
import { PARSER_INFO, loadParser, type ParserInfo } from '@/core/parsers';
import { DEFAULT_NORMALIZE } from '@/core/normalize';
import { formatFromExt } from '@/core/detect';
import { AppError } from '@/core/errors';
import { parseFile, ping } from '@/workers/client';
import { navigate } from './routes';
import type { Format, NormalizedDoc } from '@/core/types';

const SpikePanel = lazy(() => import('@/spikes/SpikePanel').then((m) => ({ default: m.SpikePanel })));

/**
 * 관리 화면 — "무엇이 실제로 붙어 있고, 지금 이 브라우저에서 도는가".
 *
 * 배포 뒤 화면이 백지가 되거나 특정 형식만 안 될 때, 로그 없이도 여기서
 * 원인을 좁힐 수 있어야 한다. 그래서 세 가지를 보여준다.
 *   1. 파서 상태와 한계 (문서)
 *   2. 실제로 불러와지는가 (동적 import 를 눌러서 확인)
 *   3. 실제 파일로 돌려본 결과 (블록 수·신뢰도·경고·소요 시간)
 */

type Check = { ok: boolean; note: string };

function useRuntimeChecks() {
  const [checks, setChecks] = useState<Record<string, Check>>({});

  useEffect(() => {
    const set = (k: string, v: Check) => setChecks((c) => ({ ...c, [k]: v }));

    const decoder = (label: string) => {
      try {
        new TextDecoder(label);
        return { ok: true, note: '사용 가능' };
      } catch {
        return { ok: false, note: '이 브라우저에서 지원하지 않습니다' };
      }
    };
    set('TextDecoder euc-kr (CP949 텍스트)', decoder('euc-kr'));
    set('TextDecoder utf-16le (HWP 본문)', decoder('utf-16le'));
    set('WebAssembly', { ok: typeof WebAssembly !== 'undefined', note: typeof WebAssembly !== 'undefined' ? '사용 가능' : '없음' });
    set('Web Worker', { ok: typeof Worker !== 'undefined', note: typeof Worker !== 'undefined' ? '사용 가능' : '없음' });
    set('structuredClone', {
      ok: typeof structuredClone === 'function',
      note: typeof structuredClone === 'function' ? '사용 가능' : '없음',
    });

    ping()
      .then((r) => set('문서 워커 응답', { ok: true, note: `v${r.version}` }))
      .catch((e) => set('문서 워커 응답', { ok: false, note: e instanceof Error ? e.message : String(e) }));
  }, []);

  return checks;
}

interface LoadState {
  status: 'idle' | 'loading' | 'ok' | 'fail';
  ms?: number;
  error?: string;
}

export function AdminPage() {
  const checks = useRuntimeChecks();
  const [loads, setLoads] = useState<Record<string, LoadState>>({});
  const [kordoc, setKordoc] = useState<unknown>(null);
  const [showSpikes, setShowSpikes] = useState(false);
  const [probe, setProbe] = useState<{ file: string; ms: number; doc?: NormalizedDoc; error?: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function tryLoad(info: ParserInfo) {
    setLoads((s) => ({ ...s, [info.format]: { status: 'loading' } }));
    const t0 = performance.now();
    try {
      await loadParser(info.format);
      setLoads((s) => ({ ...s, [info.format]: { status: 'ok', ms: Math.round(performance.now() - t0) } }));
    } catch (e) {
      setLoads((s) => ({
        ...s,
        [info.format]: { status: 'fail', error: e instanceof Error ? e.message : String(e) },
      }));
    }
  }

  async function loadAll() {
    for (const info of PARSER_INFO) await tryLoad(info);
  }

  async function runProbe(file: File) {
    setBusy(true);
    setProbe(null);
    const t0 = performance.now();
    try {
      const format = formatFromExt(file.name);
      const doc = await parseFile(
        file,
        DEFAULT_NORMALIZE[groupOf(format)],
        () => {},
        () => false,
      );
      setProbe({ file: file.name, ms: Math.round(performance.now() - t0), doc });
    } catch (e) {
      setProbe({
        file: file.name,
        ms: Math.round(performance.now() - t0),
        error: e instanceof AppError ? `${e.code}: ${e.message}${e.detail ? ` (${e.detail})` : ''}` : String(e),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-12">
      <header className="mb-10">
        <button
          type="button"
          onClick={() => navigate('/docdiff/')}
          className="text-sm text-[var(--color-ink-400)] underline underline-offset-4"
        >
          ← 비교 화면으로
        </button>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight">관리 · 진단</h1>
        <p className="mt-2 max-w-prose text-[var(--color-ink-600)]">
          지금 이 브라우저에서 무엇이 실제로 동작하는지 확인합니다. 파일은 여기서도 서버로 전송되지 않습니다.
        </p>
      </header>

      {/* 1. 파서 */}
      <section className="mb-12">
        <div className="mb-3 flex items-baseline gap-3">
          <h2 className="text-lg font-medium">파서</h2>
          <button
            type="button"
            onClick={() => void loadAll()}
            className="rounded border border-[var(--color-ink-200)] px-3 py-1 text-sm hover:bg-[var(--color-ink-100)]"
          >
            전부 불러보기
          </button>
        </div>

        <ul className="space-y-3">
          {PARSER_INFO.map((info) => {
            const load = loads[info.format];
            return (
              <li key={info.format} className="rounded-lg border border-[var(--color-ink-200)] p-4">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="font-medium">{info.label}</span>
                  <span className="font-[var(--font-mono)] text-xs text-[var(--color-ink-400)]">{info.version}</span>
                  <span
                    className={
                      'rounded-full px-2 py-0.5 text-xs ' +
                      (info.status === 'real'
                        ? 'bg-[var(--color-add-bg)] text-[var(--color-ink-900)]'
                        : 'bg-[var(--color-del-bg)] text-[var(--color-ink-900)]')
                    }
                  >
                    {info.status === 'real' ? '실제 구현' : '스텁'}
                  </span>
                  <span className="ml-auto text-xs">
                    {!load && (
                      <button
                        type="button"
                        onClick={() => void tryLoad(info)}
                        className="underline underline-offset-4 text-[var(--color-ink-400)]"
                      >
                        불러보기
                      </button>
                    )}
                    {load?.status === 'loading' && '불러오는 중…'}
                    {load?.status === 'ok' && <span className="text-[var(--color-ink-600)]">불러옴 · {load.ms}ms</span>}
                    {load?.status === 'fail' && <span className="text-[var(--color-del-strong)]">실패: {load.error}</span>}
                  </span>
                </div>

                <p className="mt-2 text-sm text-[var(--color-ink-600)]">{info.how}</p>

                {info.needs.length > 0 && (
                  <p className="mt-1 text-xs text-[var(--color-ink-400)]">필요: {info.needs.join(', ')}</p>
                )}
                {info.limits.length > 0 && (
                  <ul className="mt-2 space-y-0.5 text-xs text-[var(--color-ink-400)]">
                    {info.limits.map((l) => (
                      <li key={l}>· {l}</li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      {/* 2. 런타임 */}
      <section className="mb-12">
        <h2 className="mb-3 text-lg font-medium">런타임</h2>
        <ul className="divide-y divide-[var(--color-ink-200)] rounded-lg border border-[var(--color-ink-200)]">
          {Object.entries(checks).map(([name, c]) => (
            <li key={name} className="flex items-center gap-3 px-4 py-2.5 text-sm">
              <span aria-hidden className={c.ok ? 'text-[var(--color-add-strong)]' : 'text-[var(--color-del-strong)]'}>
                {c.ok ? '✓' : '✕'}
              </span>
              <span>{name}</span>
              <span className="ml-auto text-xs text-[var(--color-ink-400)]">{c.note}</span>
            </li>
          ))}
          {Object.keys(checks).length === 0 && <li className="px-4 py-2.5 text-sm">확인 중…</li>}
        </ul>
      </section>

      {/* 3. 선택 의존성 */}
      <section className="mb-12">
        <h2 className="mb-3 text-lg font-medium">선택 의존성</h2>
        <p className="mb-2 text-sm text-[var(--color-ink-600)]">
          kordoc 은 U-01 스파이크 대상입니다. 설치돼 있고 브라우저에서 import 되면 HWP 계열을 위임할 수 있습니다.
        </p>
        <button
          type="button"
          onClick={() => void import('@/spikes/kordoc/probe').then((m) => m.probeKordoc().then(setKordoc))}
          className="rounded border border-[var(--color-ink-200)] px-3 py-1.5 text-sm hover:bg-[var(--color-ink-100)]"
        >
          kordoc 설치 여부 확인
        </button>
        {kordoc != null && (
          <pre className="mt-3 overflow-auto rounded bg-[var(--color-ink-100)] p-3 text-xs">
            {JSON.stringify(kordoc, null, 2)}
          </pre>
        )}
      </section>

      {/* 4. 파일로 확인 */}
      <section className="mb-12">
        <h2 className="mb-3 text-lg font-medium">파일로 확인</h2>
        <p className="mb-2 text-sm text-[var(--color-ink-600)]">
          파일 하나를 넣으면 어떤 파서가 붙었고, 몇 블록이 나왔고, 신뢰도와 경고가 무엇인지 그대로 보여줍니다.
        </p>
        <input
          type="file"
          className="block text-sm"
          disabled={busy}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void runProbe(f);
          }}
        />
        {busy && <p className="mt-2 text-sm">읽는 중…</p>}

        {probe && (
          <div className="mt-3 rounded-lg border border-[var(--color-ink-200)] p-4 text-sm">
            <div className="font-medium">{probe.file}</div>
            {probe.error ? (
              <p className="mt-2 text-[var(--color-del-strong)]">{probe.error}</p>
            ) : (
              probe.doc && <ParseSummary doc={probe.doc} ms={probe.ms} />
            )}
          </div>
        )}
      </section>

      {/* 5. 스파이크 */}
      <section>
        <button
          type="button"
          onClick={() => setShowSpikes((v) => !v)}
          className="text-sm text-[var(--color-ink-400)] underline underline-offset-4"
        >
          {showSpikes ? '스파이크 도구 접기' : '스파이크 도구 열기 (T-004 ~ T-006 측정)'}
        </button>
        {showSpikes && (
          <Suspense fallback={<p className="mt-4 text-sm">도구 불러오는 중…</p>}>
            <SpikePanel />
          </Suspense>
        )}
      </section>
    </div>
  );
}

function ParseSummary({ doc, ms }: { doc: NormalizedDoc; ms: number }) {
  const rows: Array<[string, string]> = [
    ['형식', doc.format],
    ['파서', doc.meta.parserVersion],
    ['블록', String(doc.blocks.length)],
    ['글자', String(doc.blocks.reduce((s, b) => s + b.text.length, 0))],
    ['신뢰도', doc.confidence.toFixed(2) + (doc.confidence === 0 ? ' (비교 차단)' : doc.confidence < 0.7 ? ' (낮음)' : '')],
    ['소요', `${ms}ms`],
  ];
  if (doc.meta.pageCount !== undefined) rows.push(['쪽', String(doc.meta.pageCount)]);
  if (doc.meta.sectionCount !== undefined) rows.push(['구역', String(doc.meta.sectionCount)]);
  if (doc.meta.extractionTrack) rows.push(['추출 트랙', doc.meta.extractionTrack]);

  return (
    <>
      <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-3">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-2 border-b border-[var(--color-ink-200)] py-1">
            <dt className="text-[var(--color-ink-400)]">{k}</dt>
            <dd className="font-[var(--font-mono)]">{v}</dd>
          </div>
        ))}
      </dl>

      {doc.warnings.length > 0 && (
        <ul className="mt-3 space-y-1 text-xs">
          {doc.warnings.map((w, i) => (
            <li key={i}>
              <span className="font-[var(--font-mono)] text-[var(--color-ink-400)]">[{w.code}]</span> {w.message}
              {w.detail && <span className="text-[var(--color-ink-400)]"> — {w.detail}</span>}
            </li>
          ))}
        </ul>
      )}

      {doc.blocks.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs text-[var(--color-ink-400)]">앞 10블록 미리보기</summary>
          <ol className="mt-2 space-y-1 text-xs">
            {doc.blocks.slice(0, 10).map((b) => (
              <li key={b.id} className="truncate">
                <span className="font-[var(--font-mono)] text-[var(--color-ink-400)]">{b.type}</span> {b.text}
              </li>
            ))}
          </ol>
        </details>
      )}
    </>
  );
}

/** 형식별 기본 정규화 옵션을 고른다. */
function groupOf(format: Format | null): keyof typeof DEFAULT_NORMALIZE {
  if (format === 'pdf') return 'pdf';
  if (format === 'docx') return 'docx';
  if (format === 'hwp' || format === 'hwpx') return 'hwp';
  return 'text';
}
