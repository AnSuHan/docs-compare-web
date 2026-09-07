import { describe, expect, it } from 'vitest';
import { diffDocs } from '../src/core/diff';
import { DEFAULT_NORMALIZE } from '../src/core/normalize';
import { makeBlockId } from '../src/core/hash';
import type { NormalizedDoc } from '../src/core/types';

function doc(lines: string[]): NormalizedDoc {
  return {
    format: 'txt',
    meta: { fileName: 't.txt', fileSize: 0, parsedAt: 0, parserVersion: 'test@0' },
    blocks: lines.map((t, i) => ({
      id: makeBlockId(t, i),
      type: 'paragraph' as const,
      text: t,
      rawText: t,
      source: { charOffset: i },
    })),
    warnings: [],
    confidence: 1,
  };
}

const OPTS = { normalize: DEFAULT_NORMALIZE.text, maxInlineLen: 5000, timeoutMs: 10_000 };

describe('diffDocs', () => {
  // 이 서비스에서 가장 중요한 단 하나의 테스트
  it('같은 문서를 비교하면 변경점이 0이다', () => {
    const d = doc(['제1조', '제2조', '제3조']);
    const r = diffDocs(d, d, OPTS);
    expect(r.stats.insertBlocks).toBe(0);
    expect(r.stats.deleteBlocks).toBe(0);
    expect(r.stats.modifyBlocks).toBe(0);
    expect(r.changeIndices).toHaveLength(0);
  });

  it('반복되는 동일 문단이 있어도 변경점이 0이다', () => {
    const d = doc(['같은 줄', '같은 줄', '같은 줄']);
    expect(diffDocs(d, d, OPTS).changeIndices).toHaveLength(0);
  });

  it('한 줄 추가를 잡아낸다', () => {
    const r = diffDocs(doc(['가', '다']), doc(['가', '나', '다']), OPTS);
    expect(r.stats.insertBlocks).toBe(1);
    expect(r.stats.deleteBlocks).toBe(0);
  });

  it('한 줄 삭제를 잡아낸다', () => {
    const r = diffDocs(doc(['가', '나', '다']), doc(['가', '다']), OPTS);
    expect(r.stats.deleteBlocks).toBe(1);
  });

  it('빈 문서끼리도 죽지 않는다', () => {
    expect(diffDocs(doc([]), doc([]), OPTS).rows).toHaveLength(0);
  });
});
