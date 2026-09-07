import { useState } from 'react';
import type { HwpProbeResult } from './hwp/probe';
import type { PdfProbeResult } from './pdf/probe';
import type { KordocProbeResult } from './kordoc/probe';

// 형식별 파서는 필요할 때만 불러온다. 앱 전체의 코드 스플리팅 규칙과 같다.
const probeHwp = (f: File) => import('./hwp/probe').then((m) => m.probeHwp(f));
const probePdf = (f: File) => import('./pdf/probe').then((m) => m.probePdf(f));
const probeKordoc = () => import('./kordoc/probe').then((m) => m.probeKordoc());

type Row = HwpProbeResult | PdfProbeResult;

/**
 * M0 스파이크 하네스.
 * 파일을 여러 개 던지면 U-01 ~ U-03 의 답을 숫자로 뽑아준다.
 * 결과를 그대로 복사해 결정서(T-004 ~ T-006)에 붙이면 된다.
 */
export function SpikePanel() {
  const [rows, setRows] = useState<Row[]>([]);
  const [kordoc, setKordoc] = useState<KordocProbeResult | null>(null);
  const [running, setRunning] = useState(false);

  async function onFiles(list: FileList | null) {
    if (!list) return;
    setRunning(true);
    setRows([]);
    const out: Row[] = [];
    for (const f of Array.from(list)) {
      const ext = f.name.toLowerCase().split('.').pop();
      if (ext === 'hwp') out.push(await probeHwp(f));
      else if (ext === 'pdf') out.push(await probePdf(f));
      setRows([...out]);
    }
    setRunning(false);
  }

  const hwp = rows.filter((r): r is HwpProbeResult => 'paragraphs' in r || 'sections' in r || r.fileName.endsWith('.hwp'));
  const pdf = rows.filter((r): r is PdfProbeResult => 'pages' in r);

  const hwpRate = hwp.length ? (hwp.filter((r) => r.ok).length / hwp.length) : null;
  const taggedAvg = pdf.length
    ? pdf.reduce((s, r) => s + (r.taggedRatio ?? 0), 0) / pdf.length
    : null;

  return (
    <div className="mt-6 space-y-6 text-sm">
      <div>
        <h2 className="font-medium">T-004 · kordoc 브라우저 구동</h2>
        <button
          type="button"
          onClick={() => void probeKordoc().then(setKordoc)}
          className="mt-2 rounded border border-[var(--color-ink-200)] px-3 py-1.5"
        >
          확인
        </button>
        {kordoc && (
          <pre className="mt-2 overflow-auto rounded bg-[var(--color-ink-100)] p-3 text-xs">
            {JSON.stringify(kordoc, null, 2)}
          </pre>
        )}
      </div>

      <div>
        <h2 className="font-medium">T-005 · T-006 — PDF / HWP 표본 측정</h2>
        <p className="mt-1 text-[var(--color-ink-400)]">
          공문서 .pdf 와 .hwp 를 한꺼번에 고르세요. 각각 태그 비율과 추출 성공률을 계산합니다.
        </p>
        <input
          type="file"
          multiple
          accept=".pdf,.hwp"
          className="mt-2 block"
          onChange={(e) => void onFiles(e.target.files)}
        />

        {running && <p className="mt-2">측정 중…</p>}

        {hwpRate !== null && (
          <p className="mt-3">
            HWP 추출 성공률 <strong>{(hwpRate * 100).toFixed(0)}%</strong> ({hwp.length}건)
            {hwpRate < 0.8 && ' — 80% 미만이므로 v1에서 .hwp 제외를 검토하세요.'}
          </p>
        )}
        {taggedAvg !== null && (
          <p className="mt-1">
            PDF 구조 트리(트랙 A) 평균 적중률 <strong>{(taggedAvg * 100).toFixed(0)}%</strong> ({pdf.length}건)
          </p>
        )}

        {rows.length > 0 && (
          <pre className="mt-3 max-h-96 overflow-auto rounded bg-[var(--color-ink-100)] p-3 text-xs">
            {JSON.stringify(rows, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}
