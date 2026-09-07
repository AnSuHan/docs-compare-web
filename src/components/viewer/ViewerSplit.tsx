import { Suspense, lazy } from 'react';
import { formatFromExt } from '@/core/detect';
import { TextViewer } from './TextViewer';

/**
 * §9.1 SC-04 / SC-05 — 뷰어.
 *
 * 형식이 서로 달라 비교할 수 없을 때(그룹 불일치), 그리고 파일이 하나뿐일 때
 * 여기로 온다. 비교는 못 해도 "내용은 볼 수 있다"가 되어야 한다.
 *
 * PDF 만 캔버스로 그린다. 텍스트 추출이 막힌 문서(스캔본·글꼴 깨짐)에서
 * 원본을 보여줄 방법이 그것뿐이기 때문이다.
 */
const PdfViewer = lazy(() => import('./PdfViewer').then((m) => ({ default: m.PdfViewer })));

function Pane({ file }: { file: File }) {
  const isPdf = formatFromExt(file.name) === 'pdf';

  return (
    <section className="min-w-0 rounded-lg border border-[var(--color-ink-200)] p-4">
      <h2 className="mb-3 truncate text-sm font-medium" title={file.name}>
        {file.name}
      </h2>
      <div className="max-h-[70vh] overflow-auto">
        {isPdf ? (
          <Suspense fallback={<p className="text-sm text-[var(--color-ink-600)]">뷰어 불러오는 중…</p>}>
            <PdfViewer file={file} />
          </Suspense>
        ) : (
          <TextViewer file={file} />
        )}
      </div>
    </section>
  );
}

export function ViewerSplit({ files, note }: { files: File[]; note?: string }) {
  const present = files.filter(Boolean);
  if (present.length === 0) return null;

  return (
    <div className="space-y-4">
      {note && (
        <p className="rounded-lg border border-[var(--color-ink-200)] bg-[var(--color-ink-100)] p-3 text-sm">{note}</p>
      )}
      <div className={present.length > 1 ? 'grid gap-4 md:grid-cols-2' : ''}>
        {present.map((f) => (
          <Pane key={f.name + f.size + f.lastModified} file={f} />
        ))}
      </div>
    </div>
  );
}
