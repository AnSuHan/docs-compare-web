import type { BlockType, NormalizedDoc, ParseCtx, ParseWarning } from '../types';
import type { Parser } from './index';
import { AppError } from '../errors';
import { LIMITS } from '../limits';
import { scanXml } from '../xml';
import { buildDoc, finishBlocks, flattenTableRows, warn, type DraftBlock } from './common';

/**
 * §8.3 — DOCX.
 *
 * 기획서는 mammoth 를 제안하지만 mammoth 는 DOM 을 요구한다. 파서는 워커에서
 * 도는데 워커에는 DOMParser 가 없다. 우리는 서식이 아니라 블록 경계와 텍스트만
 * 필요하므로(D-03: 서식만 바뀐 변경은 잡지 않는다) word/document.xml 을 직접
 * 훑는 편이 더 정확하고 가볍다.
 */

const HEADING_STYLE = /^(?:heading|제목|개요)\s*([1-9])$/i;

interface Para {
  type: BlockType;
  level?: number;
  parts: string[];
}

async function loadZip(buf: ArrayBuffer) {
  const { default: JSZip } = await import('jszip');
  let zip;
  try {
    zip = await JSZip.loadAsync(buf);
  } catch (e) {
    throw new AppError('CORRUPTED', e instanceof Error ? e.message : String(e));
  }
  const names = Object.keys(zip.files);
  if (names.length > LIMITS.MAX_ZIP_ENTRIES) {
    throw new AppError('CORRUPTED', `zip entries=${names.length}`);
  }
  return zip;
}

/** `Heading 2` / `제목 2` / outlineLvl 을 하나의 level 로 모은다. */
function headingLevel(styleVal: string | undefined, outlineLvl: string | undefined): number | undefined {
  if (styleVal) {
    const m = styleVal.match(HEADING_STYLE);
    if (m) return Number(m[1]);
    const compact = styleVal.match(/^Heading([1-9])$/i);
    if (compact) return Number(compact[1]);
  }
  if (outlineLvl !== undefined) {
    const n = Number(outlineLvl);
    if (Number.isFinite(n) && n >= 0 && n <= 8) return n + 1;
  }
  return undefined;
}

export function parseDocumentXml(xml: string): { drafts: DraftBlock[]; tableCount: number } {
  const drafts: DraftBlock[] = [];
  let offset = 0;
  let tableCount = 0;

  // 표 상태. 중첩 표는 바깥 표에 합쳐 넣는다(v1 은 평탄화가 목적이다).
  let tableDepth = 0;
  let rows: string[][] = [];
  let cells: string[] = [];
  let cellParts: string[] = [];

  let para: Para | null = null;
  let inText = false;
  let styleVal: string | undefined;
  let outlineLvl: string | undefined;
  let numbered = false;
  let numLevel: string | undefined;
  let inDeleted = 0; // <w:del> 안의 텍스트는 이미 지워진 내용이다

  const pushDraft = (type: BlockType, rawText: string, level?: number) => {
    if (!rawText.trim()) return;
    const d: DraftBlock = { type, rawText, source: { charOffset: offset } };
    if (level !== undefined) d.level = level;
    drafts.push(d);
    offset += rawText.length;
  };

  for (const ev of scanXml(xml)) {
    if (ev.kind === 'open') {
      switch (ev.name) {
        case 'tbl':
          tableDepth++;
          if (tableDepth === 1) {
            tableCount++;
            rows = [];
          }
          break;
        case 'tr':
          if (tableDepth === 1) cells = [];
          break;
        case 'tc':
          if (tableDepth === 1) cellParts = [];
          break;
        case 'p':
          para = { type: 'paragraph', parts: [] };
          styleVal = undefined;
          outlineLvl = undefined;
          numbered = false;
          numLevel = undefined;
          break;
        case 'pStyle':
          styleVal = ev.attrs['w:val'] ?? ev.attrs['val'];
          break;
        case 'outlineLvl':
          outlineLvl = ev.attrs['w:val'] ?? ev.attrs['val'];
          break;
        case 'numPr':
          numbered = true;
          break;
        case 'ilvl':
          numLevel = ev.attrs['w:val'] ?? ev.attrs['val'];
          break;
        case 'del':
          inDeleted++;
          break;
        case 't':
          inText = !ev.selfClosing;
          break;
        case 'tab':
          if (para && !inDeleted) para.parts.push('\t');
          break;
        case 'br':
        case 'cr':
          if (para && !inDeleted) para.parts.push('\n');
          break;
        default:
          break;
      }
      continue;
    }

    if (ev.kind === 'text') {
      if (inText && para && !inDeleted) para.parts.push(ev.text);
      continue;
    }

    // close
    switch (ev.name) {
      case 't':
        inText = false;
        break;
      case 'del':
        if (inDeleted > 0) inDeleted--;
        break;
      case 'p': {
        if (para) {
          const text = para.parts.join('');
          if (tableDepth > 0) {
            cellParts.push(text);
          } else {
            const level = headingLevel(styleVal, outlineLvl);
            if (level !== undefined) pushDraft('heading', text, level);
            else if (numbered) pushDraft('listItem', text, Number(numLevel ?? 0) || 0);
            else if (styleVal && /quote|인용/i.test(styleVal)) pushDraft('quote', text);
            else pushDraft('paragraph', text);
          }
        }
        para = null;
        break;
      }
      case 'tc':
        if (tableDepth === 1) cells.push(cellParts.join('\n'));
        break;
      case 'tr':
        if (tableDepth === 1 && cells.length) rows.push(cells);
        break;
      case 'tbl':
        tableDepth--;
        if (tableDepth === 0 && rows.length) pushDraft('table', flattenTableRows(rows));
        break;
      default:
        break;
    }
  }

  return { drafts, tableCount };
}

export const docxParser: Parser = {
  async parse(buf: ArrayBuffer, fileName: string, ctx: ParseCtx): Promise<NormalizedDoc> {
    ctx.progress({ phase: 'parsing', current: 0, total: 1 });

    const zip = await loadZip(buf);
    const entry = zip.file('word/document.xml');
    if (!entry) {
      throw new AppError('CORRUPTED', 'word/document.xml 없음 (docx 가 아닙니다)');
    }

    const xml = await entry.async('string');
    if (xml.length > LIMITS.MAX_UNZIPPED_BYTES) throw new AppError('OUT_OF_MEMORY', `xml=${xml.length}`);

    const { drafts, tableCount } = parseDocumentXml(xml);
    const blocks = finishBlocks(drafts, ctx.options);

    const warnings: ParseWarning[] = [];
    if (tableCount > 0) {
      warnings.push(
        warn('TABLE_FLATTENED', 'info', `표 ${tableCount}개를 셀 단위가 아니라 한 블록으로 비교합니다.`),
      );
    }
    if (blocks.length === 0) {
      warnings.push(warn('PARTIAL_PARSE', 'warn', '본문 텍스트를 찾지 못했습니다. 그림만 있는 문서일 수 있습니다.'));
    }

    ctx.progress({ phase: 'parsing', current: 1, total: 1 });

    return buildDoc({
      format: 'docx',
      fileName,
      fileSize: buf.byteLength,
      parserVersion: 'docx@1',
      blocks,
      warnings,
      confidence: 0.95,
    });
  },
};
