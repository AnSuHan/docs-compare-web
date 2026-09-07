import { useEffect, useRef, useState } from 'react';

/**
 * §9.1 SC-04/05 — PDF 뷰어.
 *
 * 텍스트 추출이 막힌 문서(스캔본, 글꼴 정보가 깨진 문서)일수록 뷰어가 중요하다.
 * 그 경우 우리가 줄 수 있는 건 "원본을 그대로 보여주는 것"뿐이다.
 *
 * pdfjs 를 여기서 직접 부른다 — 캔버스는 워커에 없다.
 * 파일은 여전히 브라우저 밖으로 나가지 않는다(D-01).
 */

const MAX_RENDER_PAGES = 30;

export function PdfViewer({ file }: { file: File }) {
  const host = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<'loading' | 'ok' | 'error'>('loading');
  const [message, setMessage] = useState('');
  const [pages, setPages] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const canvases: HTMLCanvasElement[] = [];

    (async () => {
      try {
        const pdfjs = await import('pdfjs-dist');
        if (!pdfjs.GlobalWorkerOptions.workerSrc) {
          const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
          pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
        }

        const data = new Uint8Array(await file.arrayBuffer());
        const doc = await pdfjs.getDocument({ data, isEvalSupported: false }).promise;
        if (cancelled) return;

        setPages(doc.numPages);
        const container = host.current;
        if (!container) return;
        container.replaceChildren();

        const count = Math.min(doc.numPages, MAX_RENDER_PAGES);
        for (let i = 1; i <= count; i++) {
          if (cancelled) return;
          const page = await doc.getPage(i);

          // 컨테이너 폭에 맞춘다. 레티나에서 흐려지지 않도록 dpr 을 곱한다.
          const base = page.getViewport({ scale: 1 });
          const dpr = Math.min(window.devicePixelRatio || 1, 2);
          const scale = (container.clientWidth || 600) / base.width;
          const viewport = page.getViewport({ scale: scale * dpr });

          const canvas = document.createElement('canvas');
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          canvas.style.width = '100%';
          canvas.style.height = 'auto';
          canvas.className = 'mb-3 rounded border border-[var(--color-ink-200)] bg-white';
          canvas.setAttribute('aria-label', `${i} 쪽`);

          const ctx = canvas.getContext('2d');
          if (!ctx) throw new Error('캔버스를 만들 수 없습니다');

          container.appendChild(canvas);
          canvases.push(canvas);

          await page.render({ canvasContext: ctx, viewport }).promise;
          page.cleanup();
        }

        if (!cancelled) setStatus('ok');
      } catch (e) {
        if (cancelled) return;
        setStatus('error');
        setMessage(e instanceof Error ? e.message : String(e));
      }
    })();

    return () => {
      cancelled = true;
      for (const c of canvases) c.remove();
    };
  }, [file]);

  return (
    <div className="space-y-2">
      {status === 'loading' && <p className="text-sm text-[var(--color-ink-600)]">쪽을 그리는 중…</p>}
      {status === 'error' && (
        <p className="rounded border border-[var(--color-del-strong)] bg-[var(--color-del-bg)] p-3 text-sm">
          이 PDF 를 열지 못했습니다. {message}
        </p>
      )}
      {status === 'ok' && pages > MAX_RENDER_PAGES && (
        <p className="text-xs text-[var(--color-ink-400)]">
          {pages}쪽 중 앞 {MAX_RENDER_PAGES}쪽만 그렸습니다.
        </p>
      )}
      <div ref={host} />
    </div>
  );
}
