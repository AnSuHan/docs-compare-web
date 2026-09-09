import { describe, expect, it } from 'vitest';
import { commonTextOf, toTripleSegments } from '../src/components/diff/tripleRows';
import type { Block, DiffRow, InlineSpan } from '../src/core/types';

/**
 * 세 칸 보기의 조각 나누기.
 *
 * 가운데 열만 세로로 훑었을 때 두 문서가 합의한 본문이 그대로 읽혀야 한다 —
 * 나중에 그 자리를 직접 편집하게 되므로, 여기가 틀리면 편집 대상이 틀린다.
 */

const block = (text: string): Block => ({
  id: text,
  type: 'paragraph',
  text,
  rawText: text,
  source: { charOffset: 0 },
});

const span = (kind: InlineSpan['kind'], text: string): InlineSpan => ({ kind, text });

describe('toTripleSegments', () => {
  it('같은 문단은 가운데 한 조각이 된다', () => {
    const row: DiffRow = { kind: 'equal', left: block('제1조(목적)'), right: block('제1조(목적)') };

    expect(toTripleSegments(row, 0)).toEqual([{ kind: 'common', id: '0:0', text: '제1조(목적)' }]);
  });

  it('이전에만 있는 문단은 왼쪽만 채운다', () => {
    const row: DiffRow = { kind: 'delete', left: block('부칙 조항') };

    expect(toTripleSegments(row, 3)).toEqual([{ kind: 'divergent', id: '3:0', left: '부칙 조항', right: '' }]);
  });

  it('이후에만 있는 문단은 오른쪽만 채운다', () => {
    const row: DiffRow = { kind: 'insert', right: block('새 조항') };

    expect(toTripleSegments(row, 4)).toEqual([{ kind: 'divergent', id: '4:0', left: '', right: '새 조항' }]);
  });

  it('수정된 문단은 공통 / 갈림이 번갈아 나오게 편다', () => {
    const row: DiffRow = {
      kind: 'modify',
      left: block('이 규정은 계약서를 비교한다.'),
      right: block('이 규정은 계약서는 비교한다.'),
      inline: [
        span('equal', '이 규정은 계약서'),
        span('delete', '를'),
        span('insert', '는'),
        span('equal', ' 비교한다.'),
      ],
    };

    expect(toTripleSegments(row, 1)).toEqual([
      { kind: 'common', id: '1:0', text: '이 규정은 계약서' },
      { kind: 'divergent', id: '1:1', left: '를', right: '는' },
      { kind: 'common', id: '1:2', text: ' 비교한다.' },
    ]);
  });

  it('연속된 같은 성격의 스팬은 한 조각으로 모은다', () => {
    const row: DiffRow = {
      kind: 'modify',
      left: block('가나'),
      right: block('다라'),
      inline: [span('delete', '가'), span('delete', '나'), span('insert', '다'), span('insert', '라')],
    };

    // 한 글자마다 줄이 갈리면 읽을 수 없다.
    expect(toTripleSegments(row, 0)).toEqual([{ kind: 'divergent', id: '0:0', left: '가나', right: '다라' }]);
  });

  it('인라인 diff 를 건너뛴 긴 문단은 통째로 갈림 한 조각이 된다', () => {
    const row: DiffRow = { kind: 'modify', left: block('긴 문단 이전'), right: block('긴 문단 이후') };

    expect(toTripleSegments(row, 7)).toEqual([
      { kind: 'divergent', id: '7:0', left: '긴 문단 이전', right: '긴 문단 이후' },
    ]);
  });

  it('가운데만 이어 붙이면 두 문서가 합의한 본문이 된다', () => {
    const row: DiffRow = {
      kind: 'modify',
      left: block('계약 기간은 1년으로 한다.'),
      right: block('계약 기간은 2년으로 한다.'),
      inline: [
        span('equal', '계약 기간은 '),
        span('delete', '1'),
        span('insert', '2'),
        span('equal', '년으로 한다.'),
      ],
    };

    expect(commonTextOf(toTripleSegments(row, 0))).toBe('계약 기간은 년으로 한다.');
  });

  it('빈 문단은 조각을 만들지 않는다', () => {
    expect(toTripleSegments({ kind: 'equal', left: block(''), right: block('') }, 0)).toEqual([]);
  });
});
