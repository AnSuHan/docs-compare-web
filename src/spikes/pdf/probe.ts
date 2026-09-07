import * as pdfjs from 'pdfjs-dist';
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

// T-030 의 절반: 워커 경로를 명시하지 않으면 번들러 환경에서 조용히 깨진다.
pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;

export interface PdfProbeResult {
  fileName: string;
  ok: boolean;
  reason?: string;
  pages?: number;
  /** 구조 트리(트랙 A)가 유효한 페이지 수. 이 비율이 곧 PDF 난이도다. */
  taggedPages?: number;
  taggedRatio?: number;
  chars?: number;
  charsPerPage?: number;
  /** 50자/페이지 미만이면 스캔본으로 본다. */
  likelyScanned?: boolean;
  rotatedItems?: number;
  ms?: number;
}

const SAMPLE_PAGES = 20;

/** U-02 측정기. 국내 PDF 가 얼마나 태그돼 있는지 숫자로 답한다. */
export async function probePdf(file: File): Promise<PdfProbeResult> {
  const t0 = performance.now();
  try {
    const data = new Uint8Array(await file.arrayBuffer());
    const doc = await pdfjs.getDocument({ data, isEvalSupported: false }).promise;

    const pages = doc.numPages;
    const n = Math.min(pages, SAMPLE_PAGES);
    let tagged = 0;
    let chars = 0;
    let rotated = 0;

    for (let i = 1; i <= n; i++) {
      const page = await doc.getPage(i);

      try {
        const tree = await page.getStructTree();
        if (tree && Array.isArray(tree.children) && tree.children.length > 0) tagged++;
      } catch { /* 구조 트리 없음 */ }

      const content = await page.getTextContent();
      for (const item of content.items) {
        if (!('str' in item)) continue;
        chars += item.str.length;
        const [a, b] = item.transform as number[];
        if (Math.abs(Math.atan2(b ?? 0, a ?? 1)) > 0.01) rotated++;
      }

      page.cleanup();
    }

    const charsPerPage = chars / Math.max(n, 1);
    return {
      fileName: file.name,
      ok: true,
      pages,
      taggedPages: tagged,
      taggedRatio: Number((tagged / Math.max(n, 1)).toFixed(2)),
      chars,
      charsPerPage: Math.round(charsPerPage),
      likelyScanned: charsPerPage < 50,
      rotatedItems: rotated,
      ms: Math.round(performance.now() - t0),
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { fileName: file.name, ok: false, reason: msg, ms: Math.round(performance.now() - t0) };
  }
}
