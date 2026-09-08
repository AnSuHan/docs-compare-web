import type { DocMeta, NormalizedDoc, ParseCtx, ParseWarning } from '../../types';
import type { Parser } from '../index';
import { AppError } from '../../errors';
import { LIMITS } from '../../limits';
import { buildDoc, finishBlocks, warn, type DraftBlock } from '../common';
import { dedupeItems, splitByRotation, toItem, type PdfItem, type RawTextItem } from './items';
import { groupLines, type PdfLine } from './lineGrouping';
import { detectColumns } from './columnDetect';
import { findRepeatedLines, stripRepeated, type PageGeometry } from './headerFooter';
import { mergeLines, type PdfBlockDraft } from './paragraphMerge';
import { joinAcrossPages } from './pageJoin';
import { analyzeHangul } from './hangulSanity';
import { classifyDensity } from './scanDetect';
import { buildMcidIndex, hasTextTags, walkStructTree, type MarkedItem, type StructNode } from './structTree';

/**
 * §6 — PDF 파이프라인.
 *
 * 트랙 A(구조 트리) → 트랙 B(기하 재조립) → 트랙 C(스캔본) 순으로 판정한다.
 * 페이지마다 cleanup() 을 불러 메모리를 붙들지 않는다(§6.9).
 */

interface PageResult {
  drafts: PdfBlockDraft[];
  lines: PdfLine[];
  geom: PageGeometry;
  chars: number;
  trackA: boolean;
  rotatedItems: number;
}

async function loadPdfjs() {
  const pdfjs = await import('pdfjs-dist');
  // §6.9 중첩 워커 문제: 우리는 이미 워커 안이다. 경로를 명시하지 않으면
  // 번들러 환경에서 조용히 깨진다.
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  }
  return pdfjs;
}

/** pdfjs PasswordResponses. 1 = 비밀번호가 필요하다, 2 = 준 비밀번호가 틀렸다. */
const NEED_PASSWORD = 1;

/** pdfjs 가 던진 것을 우리 에러로 바꾼다. 분류가 UI 동작을 가르므로 테스트에서 직접 부른다. */
export function toAppError(e: unknown, fileName: string): AppError {
  const name = (e as { name?: string })?.name ?? '';
  const msg = e instanceof Error ? e.message : String(e);
  if (name === 'PasswordException') {
    // 둘을 구분해야 UI 가 "입력해 주세요" 와 "틀렸습니다" 를 가려 말할 수 있다(T-040).
    const code = (e as { code?: number }).code === NEED_PASSWORD ? 'PDF_PASSWORD_REQUIRED' : 'PDF_PASSWORD_WRONG';
    return new AppError(code, fileName);
  }
  if (name === 'InvalidPDFException') return new AppError('CORRUPTED', msg);
  if (e instanceof AppError) return e;
  return new AppError('CORRUPTED', msg);
}

async function readPage(page: {
  getStructTree: () => Promise<StructNode | null>;
  getTextContent: (o?: { includeMarkedContent?: boolean }) => Promise<{ items: unknown[] }>;
  getViewport: (o: { scale: number }) => { width: number; height: number };
  cleanup: () => void;
}, pageIndex: number): Promise<PageResult> {
  const viewport = page.getViewport({ scale: 1 });
  const geom: PageGeometry = { yMin: 0, yMax: viewport.height };

  // 트랙 A 먼저. 성공하면 휴리스틱이 전혀 필요 없다.
  let tree: StructNode | null = null;
  try {
    tree = await page.getStructTree();
  } catch {
    tree = null;
  }

  const marked = await page.getTextContent({ includeMarkedContent: true });
  const markedItems = marked.items as MarkedItem[];

  if (tree && hasTextTags(tree)) {
    const drafts = walkStructTree(tree, buildMcidIndex(markedItems), pageIndex);
    const chars = drafts.reduce((s, d) => s + d.text.length, 0);
    if (chars > 0) {
      page.cleanup();
      return { drafts, lines: [], geom, chars, trackA: true, rotatedItems: 0 };
    }
  }

  // 트랙 B. marked content 항목을 빼고 실제 글리프만 남긴다.
  const raw = markedItems.filter((i): i is MarkedItem & RawTextItem =>
    typeof (i as RawTextItem).str === 'string' && Array.isArray((i as RawTextItem).transform),
  );
  const items: PdfItem[] = dedupeItems(raw.map(toItem));
  const { upright, rotated } = splitByRotation(items);

  const lines = groupLines(upright);
  const { columns, multiColumn } = detectColumns(lines, viewport.width);
  const ordered = columns.flat();

  // 회전 텍스트는 각도별로 따로 묶어 뒤에 붙인다. 버리면 표가 통째로 사라진다.
  let rotatedItemCount = 0;
  for (const [, group] of rotated) {
    rotatedItemCount += group.length;
    ordered.push(...groupLines(group.map((it) => ({ ...it, rotation: 0 }))));
  }

  page.cleanup();

  return {
    drafts: [],
    lines: ordered,
    geom,
    chars: ordered.reduce((s, l) => s + l.text.length, 0),
    trackA: false,
    rotatedItems: rotatedItemCount,
    ...(multiColumn ? { multiColumn: true } : {}),
  } as PageResult & { multiColumn?: boolean };
}

export const pdfParser: Parser = {
  async parse(buf: ArrayBuffer, fileName: string, ctx: ParseCtx): Promise<NormalizedDoc> {
    const pdfjs = await loadPdfjs();

    let doc;
    try {
      doc = await pdfjs.getDocument({
        data: new Uint8Array(buf),
        isEvalSupported: false,
        // 폰트를 실제로 그리지 않으므로 표준 폰트 데이터는 필요 없다.
        disableFontFace: true,
        // 없으면 pdfjs 가 PasswordException 을 던진다. 위에서 코드로 갈라 UI 에 넘긴다.
        ...(ctx.password ? { password: ctx.password } : {}),
      }).promise;
    } catch (e) {
      throw toAppError(e, fileName);
    }

    // 상한을 넘으면 앞부분만 읽고, 아래에서 잘렸다고 알린다.
    const total = Math.min(doc.numPages, LIMITS.MAX_PDF_PAGES);

    const warnings: ParseWarning[] = [];
    const pageLines: PdfLine[][] = [];
    const geoms: PageGeometry[] = [];
    const trackAPages: PdfBlockDraft[][] = [];
    let chars = 0;
    let trackACount = 0;
    let multiColumnPages = 0;
    let rotatedItems = 0;

    for (let i = 1; i <= total; i++) {
      if (await ctx.shouldAbort()) throw new AppError('ABORTED');

      let page;
      try {
        page = await doc.getPage(i);
      } catch (e) {
        warnings.push(warn('PARTIAL_PARSE', 'warn', `${i} 쪽을 읽지 못해 건너뛰었습니다.`, String(e), i));
        continue;
      }

      const r = (await readPage(page as never, i - 1)) as PageResult & { multiColumn?: boolean };
      chars += r.chars;
      rotatedItems += r.rotatedItems;
      if (r.multiColumn) multiColumnPages++;

      if (r.trackA) {
        trackACount++;
        trackAPages.push(r.drafts);
        pageLines.push([]);
      } else {
        trackAPages.push([]);
        pageLines.push(r.lines);
      }
      geoms.push(r.geom);

      ctx.progress({ phase: 'parsing', current: i, total, label: `${i} / ${total} 페이지` });
    }

    if (doc.numPages > LIMITS.MAX_PDF_PAGES) {
      warnings.push(
        warn('PARTIAL_PARSE', 'warn', `${LIMITS.MAX_PDF_PAGES}쪽까지만 읽었습니다.`, `pages=${doc.numPages}`),
      );
    }

    // ── 트랙 C 판정 (§6.8)
    const scan = classifyDensity(chars, total);
    if (scan.verdict === 'scanned') {
      warnings.push(
        warn('SCANNED_PDF', 'error', `${fileName} 은 이미지로 스캔된 PDF 로 보입니다. 텍스트가 없어 비교할 수 없습니다.`,
          `chars/page=${scan.charsPerPage.toFixed(1)}`),
      );
      return buildDoc({
        format: 'pdf', fileName, fileSize: buf.byteLength, parserVersion: 'pdf@1',
        blocks: [], warnings, confidence: 0, pageCount: total, extractionTrack: 'C',
      });
    }
    if (scan.verdict === 'suspect') {
      warnings.push(
        warn('SCANNED_PDF', 'warn', '텍스트가 적어 일부 쪽이 스캔 이미지일 수 있습니다. 빠진 내용이 있는지 확인해 주세요.',
          `chars/page=${scan.charsPerPage.toFixed(1)}`),
      );
    }

    // ── 트랙 A 가 전 페이지에서 성공했으면 그대로 쓴다.
    const useTrackA = trackACount === total && total > 0;
    let pageDrafts: PdfBlockDraft[][];

    if (useTrackA) {
      pageDrafts = trackAPages;
    } else {
      if (trackACount > 0) {
        warnings.push(
          warn('STRUCT_TREE_MISSING', 'info', '일부 쪽에만 구조 정보가 있어 좌표로 문단을 복원했습니다.',
            `trackA=${trackACount}/${total}`),
        );
      }
      // 머리말/꼬리말 제거는 트랙 B 라인에만 적용된다.
      const repeated = findRepeatedLines(pageLines, geoms);
      const stripped = stripRepeated(pageLines, geoms, repeated);
      if (stripped.removed.length) {
        warnings.push(
          warn('HEADER_FOOTER_REMOVED', 'info', `머리말·꼬리말 ${stripped.removed.length}종을 비교에서 제외했습니다.`,
            stripped.removed.slice(0, 10).join(' / ')),
        );
      }
      pageDrafts = stripped.pages.map((lines, p) =>
        trackAPages[p]!.length ? trackAPages[p]! : mergeLines(lines, p),
      );
    }

    // ── 단계 6. 페이지 경계 병합
    const { blocks: joinedDrafts, joined } = joinAcrossPages(pageDrafts);
    if (joined > 0) {
      warnings.push(warn('PAGE_BREAK_MERGED', 'info', `쪽을 넘어 이어지는 문단 ${joined}건을 하나로 이었습니다.`));
    }

    const drafts: DraftBlock[] = [];
    let offset = 0;
    for (const d of joinedDrafts) {
      const draft: DraftBlock = {
        type: d.type,
        rawText: d.text,
        source: { page: d.page + 1, charOffset: offset },
      };
      if (d.level !== undefined) draft.level = d.level;
      drafts.push(draft);
      offset += d.text.length;
    }
    const blocks = finishBlocks(drafts, ctx.options);

    // ── 한글 mojibake 판정 (§6.6)
    const sanity = analyzeHangul(blocks.map((b) => b.text).join('\n'));
    if (sanity.garbled) {
      warnings.push(
        warn('GARBLED_TEXT', 'error', `${fileName} 은 글꼴 정보 문제로 텍스트를 정확히 읽을 수 없습니다.`, sanity.reason),
      );
      return buildDoc({
        format: 'pdf', fileName, fileSize: buf.byteLength, parserVersion: 'pdf@1',
        blocks, warnings, confidence: 0, pageCount: total,
        extractionTrack: useTrackA ? 'A' : 'B',
      });
    }

    if (multiColumnPages > 0) {
      warnings.push(
        warn('MULTI_COLUMN_GUESS', 'warn', `${multiColumnPages}쪽에서 다단 조판으로 보고 읽기 순서를 추정했습니다.`),
      );
    }
    if (rotatedItems > 0) {
      warnings.push(warn('ROTATED_TEXT', 'info', '눕힌 텍스트를 본문 뒤에 따로 붙였습니다.', `items=${rotatedItems}`));
    }
    if (joinedDrafts.some((d) => d.tableLike)) {
      warnings.push(warn('TABLE_FLATTENED', 'info', '괘선 없는 표로 보이는 부분이 있어 줄 단위로 비교합니다.'));
    }

    // §3.3 신뢰도
    const track: DocMeta['extractionTrack'] = useTrackA ? 'A' : 'B';
    const confidence = useTrackA ? 0.95 : multiColumnPages > 0 ? 0.6 : 0.8;

    return buildDoc({
      format: 'pdf',
      fileName,
      fileSize: buf.byteLength,
      parserVersion: 'pdf@1',
      blocks,
      warnings,
      confidence,
      pageCount: total,
      extractionTrack: track,
    });
  },
};
