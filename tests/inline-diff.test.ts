import { describe, expect, it } from 'vitest';
import { diceCoefficient, pairBlocks } from '../src/core/diff/pairing';
import { inlineDiff, mergeAdjacent, splitWords } from '../src/core/diff/wordDiff';
import { diffDocs } from '../src/core/diff';
import { DEFAULT_NORMALIZE } from '../src/core/normalize';
import { makeBlockId } from '../src/core/hash';
import type { InlineSpan, NormalizedDoc } from '../src/core/types';

const OPTS = { normalize: DEFAULT_NORMALIZE.text, maxInlineLen: 5000, timeoutMs: 10_000 };

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

/** 스팬을 좌/우 원문으로 되돌린다. 이게 맞아야 화면 표시가 거짓말을 안 한다. */
function rebuild(spans: InlineSpan[]): { left: string; right: string } {
  let left = '';
  let right = '';
  for (const s of spans) {
    if (s.kind !== 'insert') left += s.text;
    if (s.kind !== 'delete') right += s.text;
  }
  return { left, right };
}

describe('diceCoefficient', () => {
  it('같으면 1 이다', () => {
    expect(diceCoefficient('계약서', '계약서')).toBe(1);
  });

  it('조사만 다른 어절은 높게 나온다', () => {
    expect(diceCoefficient('계약서를', '계약서는')).toBeGreaterThan(0.4);
  });

  it('완전히 다르면 0 에 가깝다', () => {
    expect(diceCoefficient('계약서', '영수증')).toBeLessThan(0.2);
  });
});

describe('pairBlocks', () => {
  it('비슷한 문단끼리 짝지어 modify 후보로 만든다', () => {
    const pairs = pairBlocks(['제1조 목적은 이러하다', '전혀 다른 문단'], ['제1조 목적은 저러하다']);
    expect(pairs).toHaveLength(1);
    expect(pairs[0]).toMatchObject({ left: 0, right: 0 });
  });

  it('닮지 않으면 짝짓지 않는다', () => {
    expect(pairBlocks(['가나다라마'], ['하파타카차'])).toHaveLength(0);
  });

  it('한 insert 를 두 delete 에 중복으로 쓰지 않는다', () => {
    const pairs = pairBlocks(['제1조 목적', '제1조 목적'], ['제1조 목표']);
    expect(pairs).toHaveLength(1);
  });
});

describe('splitWords', () => {
  it('공백을 토큰으로 남겨 원문을 정확히 복원한다', () => {
    const s = '계약서를  검토한다';
    expect(splitWords(s).join('')).toBe(s);
  });
});

describe('mergeAdjacent', () => {
  it('같은 종류가 이어지면 합친다', () => {
    const merged = mergeAdjacent([
      { kind: 'equal', text: '계' },
      { kind: 'equal', text: '약' },
      { kind: 'insert', text: '서' },
    ]);
    expect(merged).toEqual([
      { kind: 'equal', text: '계약' },
      { kind: 'insert', text: '서' },
    ]);
  });
});

describe('inlineDiff — §5.4 한국어 2.5단계', () => {
  it('조사만 바뀌면 조사 글자만 짚어준다', () => {
    const spans = inlineDiff('계약서를 검토한다', '계약서는 검토한다');

    // 어절 단위로만 봤다면 '계약서를' 전체가 삭제로 나온다. 그러면 안 된다.
    const deleted = spans.filter((s) => s.kind === 'delete').map((s) => s.text).join('');
    const inserted = spans.filter((s) => s.kind === 'insert').map((s) => s.text).join('');
    expect(deleted).toBe('를');
    expect(inserted).toBe('는');
  });

  it('전혀 다른 어절은 통째로 바뀐 것으로 둔다', () => {
    const spans = inlineDiff('계약서 검토', '영수증 검토');
    const deleted = spans.filter((s) => s.kind === 'delete').map((s) => s.text).join('');
    expect(deleted).toBe('계약서');
  });

  it('스팬을 되돌리면 양쪽 원문이 정확히 복원된다', () => {
    const cases: Array<[string, string]> = [
      ['계약서를 검토한다', '계약서는 검토했다'],
      ['갑은 을에게 대금을 지급한다', '갑은 병에게 대금을 지급한다'],
      ['', '새로 생긴 문장'],
      ['사라진 문장', ''],
      ['같은 문장', '같은 문장'],
      ['The quick brown fox', 'The quick red fox'],
    ];
    for (const [a, b] of cases) {
      const r = rebuild(inlineDiff(a, b));
      expect(r.left).toBe(a);
      expect(r.right).toBe(b);
    }
  });

  it('같은 문장이면 equal 스팬 하나뿐이다', () => {
    const spans = inlineDiff('바뀌지 않았다', '바뀌지 않았다');
    expect(spans).toHaveLength(1);
    expect(spans[0]!.kind).toBe('equal');
  });
});

describe('diffDocs — 2·3단계 통합', () => {
  it('한 어절만 고친 문단은 modify 로 나오고 인라인이 붙는다', () => {
    const r = diffDocs(doc(['제1조 계약서를 검토한다']), doc(['제1조 계약서는 검토한다']), OPTS);

    expect(r.stats.modifyBlocks).toBe(1);
    expect(r.stats.deleteBlocks).toBe(0);
    expect(r.stats.insertBlocks).toBe(0);

    const row = r.rows[0]!;
    expect(row.kind).toBe('modify');
    expect(row.inline).toBeTruthy();
    expect(row.similarity).toBeGreaterThan(0.5);
    // 바뀐 글자 수만 센다 — 문단 전체를 세면 수정이 전면 교체처럼 보인다
    expect(r.stats.deleteChars).toBeLessThan(3);
  });

  it('전혀 다른 문단은 delete + insert 로 남는다', () => {
    const r = diffDocs(doc(['가나다라마바사']), doc(['하파타카차자아']), OPTS);
    expect(r.stats.modifyBlocks).toBe(0);
    expect(r.stats.deleteBlocks).toBe(1);
    expect(r.stats.insertBlocks).toBe(1);
  });

  it('아주 긴 블록은 인라인 diff 를 생략한다', () => {
    const long = '가'.repeat(30);
    const r = diffDocs(doc([long + '나']), doc([long + '다']), { ...OPTS, maxInlineLen: 10 });
    expect(r.rows[0]!.kind).toBe('modify');
    expect(r.rows[0]!.inline).toBeUndefined();
  });

  it('수정과 추가가 섞여도 순서가 유지된다', () => {
    const r = diffDocs(
      doc(['첫 문단은 그대로', '둘째 문단을 고친다']),
      doc(['첫 문단은 그대로', '둘째 문단을 고쳤다', '셋째 문단이 새로 생겼다']),
      OPTS,
    );
    expect(r.rows.map((x) => x.kind)).toEqual(['equal', 'modify', 'insert']);
  });
});
