import type { NormalizedDoc, ParseCtx, ParseWarning } from '../../types';
import type { Parser } from '../index';
import { AppError } from '../../errors';
import { buildDoc, finishBlocks, splitParagraphs, totalChars, warn, type DraftBlock } from '../common';
import { readFileHeader } from './fileHeader';
import { readRecords, TAG } from './record';
import { decodeParaText } from './paraText';
import { decodePrvText } from './prvText';

/**
 * §7.4 — HWP 5.0.
 *
 * CFB(OLE2) 컨테이너 → BodyText/SectionN 스트림 → (필요하면 raw deflate 해제)
 * → 레코드 → HWPTAG_PARA_TEXT 의 UTF-16LE 디코딩.
 *
 * 표·그림은 v1 에서 구조를 복원하지 않는다. 셀 텍스트는 어차피 PARA_TEXT 로
 * 함께 수집되므로 내용 누락은 없고, 대신 TABLE_FLATTENED 로 알린다(§7.6).
 */

type CfbContainer = { FullPaths: string[]; FileIndex: Array<{ content?: unknown }> };

async function readCfb(buf: ArrayBuffer): Promise<CfbContainer> {
  const CFB = await import('cfb');
  try {
    return CFB.read(new Uint8Array(buf), { type: 'array' }) as unknown as CfbContainer;
  } catch (e) {
    throw new AppError('CORRUPTED', e instanceof Error ? e.message : String(e));
  }
}

function toU8(content: unknown): Uint8Array | undefined {
  if (!content) return undefined;
  if (content instanceof Uint8Array) return content;
  if (Array.isArray(content)) return new Uint8Array(content);
  return undefined;
}

/** CFB 경로는 구현마다 앞 슬래시 유무가 갈린다. 이름 끝으로 찾는다. */
function findStream(cfb: CfbContainer, name: string): Uint8Array | undefined {
  const want = name.toLowerCase();
  for (let i = 0; i < cfb.FullPaths.length; i++) {
    const path = cfb.FullPaths[i]!.toLowerCase().replace(/\\/g, '/');
    if (path === want || path.endsWith('/' + want)) {
      const u8 = toU8(cfb.FileIndex[i]?.content);
      if (u8) return u8;
    }
  }
  return undefined;
}

function listSections(cfb: CfbContainer): Uint8Array[] {
  const out: Uint8Array[] = [];
  for (let i = 0; ; i++) {
    const s = findStream(cfb, `bodytext/section${i}`);
    if (!s) break;
    out.push(s);
  }
  return out;
}

async function inflate(raw: Uint8Array): Promise<Uint8Array> {
  const pako = (await import('pako')).default;
  try {
    return pako.inflateRaw(raw);
  } catch {
    // 압축 플래그가 잘못 켜져 있는 파일이 있다. 원본 그대로 시도해 본다.
    return raw;
  }
}

export const hwpParser: Parser = {
  async parse(buf: ArrayBuffer, fileName: string, ctx: ParseCtx): Promise<NormalizedDoc> {
    const cfb = await readCfb(buf);

    const fhStream = findStream(cfb, 'fileheader');
    if (!fhStream) {
      // CFB 시그니처는 .doc/.xls 와 같다(§8.4). 무엇인지 짚어서 알려준다.
      if (findStream(cfb, 'worddocument')) throw new AppError('LEGACY_DOC', fileName);
      throw new AppError('NOT_HWP', 'FileHeader 스트림 없음');
    }

    const header = readFileHeader(fhStream);
    if (header.passwordProtected) throw new AppError('ENCRYPTED', fileName);
    if (header.distributionDoc) throw new AppError('HWP_DISTRIBUTION_DOC', fileName);

    const sections = listSections(cfb);
    const warnings: ParseWarning[] = [];
    const drafts: DraftBlock[] = [];
    let offset = 0;
    let unknownCodes = 0;
    let sawTable = false;

    for (let s = 0; s < sections.length; s++) {
      if (await ctx.shouldAbort()) throw new AppError('ABORTED');

      const data = header.compressed ? await inflate(sections[s]!) : sections[s]!;
      let current: string[] = [];

      const flush = () => {
        const text = current.join('');
        current = [];
        if (!text.trim()) return;
        drafts.push({ type: 'paragraph', rawText: text, source: { section: s, charOffset: offset } });
        offset += text.length;
      };

      for (const rec of readRecords(data)) {
        if (rec.tagId === TAG.PARA_HEADER) {
          flush();
        } else if (rec.tagId === TAG.PARA_TEXT) {
          const r = decodeParaText(rec.payload);
          current.push(r.text);
          unknownCodes += r.unknown;
        } else if (rec.tagId === TAG.TABLE) {
          sawTable = true;
        }
      }
      flush();

      ctx.progress({
        phase: 'parsing',
        current: s + 1,
        total: sections.length,
        label: `${s + 1} / ${sections.length} 구역`,
      });
    }

    let blocks = finishBlocks(drafts, ctx.options);
    let confidence = 0.85;
    let parserVersion = 'hwp@1';

    // §7.4.7 — 본문이 비었거나 비정상적으로 짧으면 미리보기 텍스트로 폴백한다.
    if (blocks.length === 0 || totalChars(blocks) < 50) {
      const prv = findStream(cfb, 'prvtext');
      const preview = prv ? decodePrvText(prv) : '';
      if (preview.length >= 10) {
        warnings.push(
          warn('PARTIAL_PARSE', 'warn', '본문을 읽지 못해 미리보기 텍스트로 대체했습니다. 문서 앞부분만 담겨 있을 수 있습니다.'),
        );
        blocks = finishBlocks(splitParagraphs(preview), ctx.options);
        confidence = 0.4;
        parserVersion = 'hwp-prv@1';
      } else if (blocks.length === 0) {
        throw new AppError('CORRUPTED', '본문 텍스트를 한 글자도 추출하지 못했습니다');
      }
    }

    if (sawTable) {
      warnings.push(warn('TABLE_FLATTENED', 'info', '표는 셀 단위가 아니라 문단 단위로 비교합니다.'));
    }
    if (unknownCodes > 0) {
      // 미지 제어코드가 많으면 디코딩에 구멍이 있다는 뜻이다(§7.4.5).
      const ratio = unknownCodes / Math.max(totalChars(blocks), 1);
      if (ratio > 0.01) {
        confidence = Math.min(confidence, 0.6);
        warnings.push(
          warn('HWP_UNKNOWN_TAG', 'warn', '해석하지 못한 제어 문자가 있어 일부 내용이 정확하지 않을 수 있습니다.', `unknown=${unknownCodes}`),
        );
      }
    }
    warnings.push(
      warn('HWP_NO_PAGE_INFO', 'info', 'HWP 는 페이지 정보를 저장하지 않아 페이지 번호 대신 구역으로 위치를 표시합니다.'),
    );

    return buildDoc({
      format: 'hwp',
      fileName,
      fileSize: buf.byteLength,
      parserVersion,
      blocks,
      warnings,
      confidence,
      sectionCount: sections.length,
    });
  },
};
