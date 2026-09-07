import type { Format, NormalizedDoc, ParseCtx } from '../types';
import type { Parser } from './index';
import { makeBlockId } from '../hash';
import { normalizeText } from '../normalize';

/**
 * M0 스텁 파서.
 * 파이프라인(워커 왕복 -> 파싱 -> 정규화 -> diff -> 렌더)이 끝까지 관통하는지
 * 확인하기 위한 최소 구현이다. 바이트를 UTF-8 로 읽어 빈 줄 기준으로 끊는다.
 * M1 에서 text.ts 로, 이후 각 형식 파서로 교체된다.
 */
export function makeStub(format: Format): Parser {
  return {
    async parse(buf, fileName, ctx: ParseCtx): Promise<NormalizedDoc> {
      ctx.progress({ phase: 'parsing', current: 0, total: 1 });

      const text = new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(buf));
      const chunks = text.split(/\n\s*\n/);

      let offset = 0;
      const blocks = chunks
        .map((raw) => {
          const normalized = normalizeText(raw, ctx.options);
          const block = {
            id: makeBlockId(normalized, offset),
            type: 'paragraph' as const,
            text: normalized,
            rawText: raw,
            source: { charOffset: offset },
          };
          offset += raw.length;
          return block;
        })
        .filter((b) => b.text.length > 0);

      ctx.progress({ phase: 'parsing', current: 1, total: 1 });

      return {
        format,
        meta: {
          fileName,
          fileSize: buf.byteLength,
          parsedAt: Date.now(),
          parserVersion: `stub@0`,
        },
        blocks,
        warnings: [
          {
            code: 'PARTIAL_PARSE',
            severity: 'info',
            message: 'M0 스텁 파서로 읽었습니다. 형식별 파서는 아직 붙지 않았습니다.',
            detail: `format=${format}`,
          },
        ],
        confidence: 0.1,
      };
    },
  };
}
