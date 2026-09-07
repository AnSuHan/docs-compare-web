import type { BlockType, NormalizedDoc, ParseCtx, ParseWarning } from '../types';
import type { Parser } from './index';
import { AppError } from '../errors';
import { LIMITS } from '../limits';
import { rootAttrs, scanXml } from '../xml';
import { buildDoc, finishBlocks, flattenTableRows, warn, type DraftBlock } from './common';

/**
 * §7.3 — HWPX (OWPML, KS X 6101).
 *
 * ZIP 안의 Contents/sectionN.xml 이 본문이다. 구역 수는 Contents/header.xml 의
 * secCnt 속성에 적혀 있다.
 *
 * DOMParser 대신 core/xml.ts 의 스캐너를 쓴다 — 워커에는 DOM 이 없다.
 * 스캐너가 문서 순서대로 이벤트를 주므로, 기획서가 경고한 "표 안팎 순서가
 * 뒤섞이는 문제"(getElementsByTagName 사용 시)가 애초에 생기지 않는다.
 */

const HEADING_STYLE = /(개요|제목)\s*([1-9])/;

interface ParaState {
  parts: string[];
  styleIdRef?: string;
  paraPrIdRef?: string;
}

async function loadZip(buf: ArrayBuffer) {
  const { default: JSZip } = await import('jszip');
  try {
    const zip = await JSZip.loadAsync(buf);
    if (Object.keys(zip.files).length > LIMITS.MAX_ZIP_ENTRIES) {
      throw new AppError('CORRUPTED', 'zip entries 초과');
    }
    return zip;
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError('CORRUPTED', e instanceof Error ? e.message : String(e));
  }
}

/**
 * header.xml 에서 "스타일 id → 개요 수준" 표를 만든다.
 * 스타일명이 '개요 1' / '제목 1' 이면 그 숫자를 heading level 로 쓴다.
 * (기획서: 스타일 파싱이 부담이면 전부 paragraph 로 둬도 diff 품질에는 거의
 *  영향이 없다 — 그래서 실패해도 조용히 비운다.)
 */
export function readHeadingStyles(headerXml: string): Map<string, number> {
  const out = new Map<string, number>();
  let inStyleList = false;
  for (const ev of scanXml(headerXml)) {
    if (ev.kind === 'open' && ev.name === 'styles') inStyleList = true;
    if (ev.kind === 'close' && ev.name === 'styles') inStyleList = false;
    if (!inStyleList || ev.kind !== 'open' || ev.name !== 'style') continue;

    const id = ev.attrs['id'];
    const name = ev.attrs['name'] ?? ev.attrs['engName'] ?? '';
    if (!id) continue;
    const m = name.match(HEADING_STYLE) ?? name.match(/^Outline\s*([1-9])$/i) ?? name.match(/^Heading\s*([1-9])$/i);
    if (m) out.set(id, Number(m[m.length - 1]));
  }
  return out;
}

export function parseSectionXml(
  xml: string,
  section: number,
  headingStyles: Map<string, number>,
  startOffset: number,
): { drafts: DraftBlock[]; tableCount: number; nextOffset: number } {
  const drafts: DraftBlock[] = [];
  let offset = startOffset;
  let tableCount = 0;

  let tableDepth = 0;
  let rows: string[][] = [];
  let cells: string[] = [];
  let cellParts: string[] = [];

  let para: ParaState | null = null;
  let inT = false;

  const push = (type: BlockType, rawText: string, level?: number) => {
    if (!rawText.trim()) return;
    const d: DraftBlock = { type, rawText, source: { section, charOffset: offset } };
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
        case 'p': {
          const p: ParaState = { parts: [] };
          const style = ev.attrs['styleIDRef'];
          const paraPr = ev.attrs['paraPrIDRef'];
          if (style !== undefined) p.styleIdRef = style;
          if (paraPr !== undefined) p.paraPrIdRef = paraPr;
          para = p;
          break;
        }
        case 't':
          inT = !ev.selfClosing;
          break;
        case 'tab':
          // hp:tab 은 탭으로 보존한다. 공백으로 뭉개면 표 정렬 정보가 사라진다.
          if (para) para.parts.push('\t');
          break;
        case 'lineBreak':
          if (para) para.parts.push('\n');
          break;
        case 'ctrl':
          if (para && ev.attrs['id'] === 'tab') para.parts.push('\t');
          break;
        default:
          break;
      }
      continue;
    }

    if (ev.kind === 'text') {
      if (inT && para) para.parts.push(ev.text);
      continue;
    }

    switch (ev.name) {
      case 't':
        inT = false;
        break;
      case 'p': {
        if (para) {
          const text = para.parts.join('');
          if (tableDepth > 0) {
            cellParts.push(text);
          } else {
            const level =
              (para.styleIdRef !== undefined ? headingStyles.get(para.styleIdRef) : undefined) ??
              (para.paraPrIdRef !== undefined ? headingStyles.get(para.paraPrIdRef) : undefined);
            push(level !== undefined ? 'heading' : 'paragraph', text, level);
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
        if (tableDepth === 0 && rows.length) push('table', flattenTableRows(rows));
        break;
      default:
        break;
    }
  }

  return { drafts, tableCount, nextOffset: offset };
}

export const hwpxParser: Parser = {
  async parse(buf: ArrayBuffer, fileName: string, ctx: ParseCtx): Promise<NormalizedDoc> {
    const zip = await loadZip(buf);

    const headerXml = await zip.file('Contents/header.xml')?.async('string');
    const headingStyles = headerXml ? readHeadingStyles(headerXml) : new Map<string, number>();
    const declared = headerXml ? Number(rootAttrs(headerXml)['secCnt'] ?? '') : NaN;

    // secCnt 를 못 믿는 파일이 있어서, 실제 존재하는 sectionN.xml 도 함께 센다.
    const present = Object.keys(zip.files)
      .map((n) => n.match(/^Contents\/section(\d+)\.xml$/i))
      .filter((m): m is RegExpMatchArray => m !== null)
      .map((m) => Number(m[1]));
    const secCnt = Math.max(Number.isFinite(declared) && declared > 0 ? declared : 0, present.length, 1);

    const warnings: ParseWarning[] = [];
    const drafts: DraftBlock[] = [];
    let offset = 0;
    let tableCount = 0;

    for (let s = 0; s < secCnt; s++) {
      if (await ctx.shouldAbort()) throw new AppError('ABORTED');

      const path = `Contents/section${s}.xml`;
      const xml = await zip.file(path)?.async('string');
      if (!xml) {
        warnings.push(warn('HWPX_SECTION_MISSING', 'warn', `구역 ${s} 을 찾지 못해 건너뛰었습니다.`, path));
        continue;
      }

      const r = parseSectionXml(xml, s, headingStyles, offset);
      drafts.push(...r.drafts);
      tableCount += r.tableCount;
      offset = r.nextOffset;

      ctx.progress({ phase: 'parsing', current: s + 1, total: secCnt, label: `${s + 1} / ${secCnt} 구역` });
    }

    const blocks = finishBlocks(drafts, ctx.options);

    if (tableCount > 0) {
      warnings.push(warn('TABLE_FLATTENED', 'info', `표 ${tableCount}개를 한 블록으로 평탄화했습니다.`));
    }
    warnings.push(
      warn('HWP_NO_PAGE_INFO', 'info', 'HWPX 는 페이지 정보를 저장하지 않아 페이지 번호 대신 구역으로 위치를 표시합니다.'),
    );
    if (blocks.length === 0) {
      throw new AppError('CORRUPTED', '본문 텍스트를 찾지 못했습니다');
    }

    return buildDoc({
      format: 'hwpx',
      fileName,
      fileSize: buf.byteLength,
      parserVersion: 'hwpx@1',
      blocks,
      warnings,
      confidence: 0.95,
      sectionCount: secCnt,
    });
  },
};
