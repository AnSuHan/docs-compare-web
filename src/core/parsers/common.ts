import type {
  Block,
  BlockSource,
  BlockType,
  DocMeta,
  Format,
  NormalizedDoc,
  NormalizeOptions,
  ParseWarning,
  StyleHint,
  WarningCode,
} from '../types';
import { makeBlockId } from '../hash';
import { normalizeText } from '../normalize';

/**
 * 파서가 만드는 중간 형태. `text` 와 `id` 는 여기서 정하지 않는다 —
 * 정규화 옵션에 따라 달라지고, 빈 블록이 걸러진 뒤의 최종 순번으로 id 를 매겨야
 * §3.2 의 "순번을 섞어 충돌을 피한다"가 성립하기 때문이다.
 */
export interface DraftBlock {
  type: BlockType;
  level?: number;
  rawText: string;
  style?: StyleHint;
  source: BlockSource;
}

export function warn(
  code: WarningCode,
  severity: ParseWarning['severity'],
  message: string,
  detail?: string,
  page?: number,
): ParseWarning {
  const w: ParseWarning = { code, severity, message };
  if (detail !== undefined) w.detail = detail;
  if (page !== undefined) w.page = page;
  return w;
}

/** 초안을 최종 Block 으로 확정한다. 정규화 결과가 빈 블록은 버린다. */
export function finishBlocks(drafts: DraftBlock[], options: NormalizeOptions): Block[] {
  const out: Block[] = [];
  for (const d of drafts) {
    const text = normalizeText(d.rawText, options);
    if (!text) continue;
    const block: Block = {
      id: makeBlockId(text, out.length),
      type: d.type,
      text,
      rawText: d.rawText,
      source: d.source,
    };
    if (d.level !== undefined) block.level = d.level;
    if (d.style !== undefined) block.style = d.style;
    out.push(block);
  }
  return out;
}

export function buildDoc(args: {
  format: Format;
  fileName: string;
  fileSize: number;
  parserVersion: string;
  blocks: Block[];
  warnings: ParseWarning[];
  confidence: number;
  pageCount?: number;
  sectionCount?: number;
  extractionTrack?: DocMeta['extractionTrack'];
}): NormalizedDoc {
  const meta: DocMeta = {
    fileName: args.fileName,
    fileSize: args.fileSize,
    parsedAt: Date.now(),
    parserVersion: args.parserVersion,
  };
  if (args.pageCount !== undefined) meta.pageCount = args.pageCount;
  if (args.sectionCount !== undefined) meta.sectionCount = args.sectionCount;
  if (args.extractionTrack !== undefined) meta.extractionTrack = args.extractionTrack;

  return {
    format: args.format,
    meta,
    blocks: args.blocks,
    warnings: args.warnings,
    confidence: args.confidence,
  };
}

/**
 * 빈 줄로 문단을 끊는다. 단일 개행은 문단 안의 줄바꿈으로 보존한다(§8.1).
 * charOffset 은 원문 기준 누적 위치다.
 */
export function splitParagraphs(text: string, source: Omit<BlockSource, 'charOffset'> = {}): DraftBlock[] {
  const out: DraftBlock[] = [];
  const re = /\n[ \t]*\n/g;
  let start = 0;
  let m: RegExpExecArray | null;

  const push = (chunk: string, offset: number) => {
    if (chunk.trim()) out.push({ type: 'paragraph', rawText: chunk, source: { ...source, charOffset: offset } });
  };

  while ((m = re.exec(text)) !== null) {
    push(text.slice(start, m.index), start);
    start = m.index + m[0].length;
  }
  push(text.slice(start), start);
  return out;
}

/** 표를 한 블록으로 평탄화할 때 쓰는 규칙(§7.6): 셀은 ` | `, 행은 `\n`. */
export function flattenTableRows(rows: string[][]): string {
  return rows.map((cells) => cells.map((c) => c.trim()).join(' | ')).join('\n');
}

export function totalChars(blocks: Block[]): number {
  let n = 0;
  for (const b of blocks) n += b.text.length;
  return n;
}
