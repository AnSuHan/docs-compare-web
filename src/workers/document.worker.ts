import * as Comlink from 'comlink';
import type { WorkerApi, ParseRequest } from './protocol';
import type { DiffOptions, DiffResult, NormalizedDoc, NormalizeOptions, Progress } from '@/core/types';
import { resolveFormat } from '@/core/detect';
import { loadParser } from '@/core/parsers';
import { normalizeText } from '@/core/normalize';
import { makeBlockId } from '@/core/hash';
import { diffDocs } from '@/core/diff';
import { AppError } from '@/core/errors';
import { LIMITS } from '@/core/limits';

const WORKER_VERSION = '0.1.0';

const api: WorkerApi = {
  async ping() {
    return { ok: true, version: WORKER_VERSION };
  },

  async parse(req: ParseRequest, onProgress: (p: Progress) => void, shouldAbort: () => boolean) {
    const { buffer, fileName, options } = req;

    if (buffer.byteLength === 0) throw new AppError('EMPTY_FILE', fileName);
    if (buffer.byteLength > LIMITS.MAX_FILE_BYTES) throw new AppError('FILE_TOO_LARGE', fileName);

    onProgress({ phase: 'reading', current: 0, total: 1 });
    const { format, mismatch } = resolveFormat(fileName, new Uint8Array(buffer));

    const parser = await loadParser(format);
    const doc = await parser.parse(buffer, fileName, {
      progress: onProgress,
      shouldAbort,
      options,
    });

    if (mismatch) {
      doc.warnings.push({
        code: 'PARTIAL_PARSE',
        severity: 'warn',
        message: '확장자와 실제 파일 형식이 다릅니다. 실제 형식으로 읽었습니다.',
        detail: `declared=${fileName}, actual=${format}`,
      });
    }
    return doc;
  },

  async renormalize(doc: NormalizedDoc, options: NormalizeOptions) {
    // 파싱은 다시 하지 않는다. rawText 를 들고 있으므로 정규화만 다시 돌린다.
    // id 는 §3.2 대로 "정규화된 텍스트 + 최종 순번" 으로 다시 매긴다 —
    // 빈 블록이 걸러진 뒤의 순번이어야 파싱 때와 같은 규칙이 된다.
    const blocks: NormalizedDoc['blocks'] = [];
    for (const b of doc.blocks) {
      const text = normalizeText(b.rawText, options);
      if (!text) continue;
      blocks.push({ ...b, text, id: makeBlockId(text, blocks.length) });
    }
    return { ...doc, blocks };
  },

  async diff(a: NormalizedDoc, b: NormalizedDoc, options: DiffOptions): Promise<DiffResult> {
    if (a.confidence === 0 || b.confidence === 0) {
      const bad = a.confidence === 0 ? a : b;
      throw new AppError('GARBLED_TEXT', bad.meta.fileName);
    }
    return diffDocs(a, b, options);
  },
};

Comlink.expose(api);
