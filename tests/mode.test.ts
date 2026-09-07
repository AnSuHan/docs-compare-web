import { describe, expect, it } from 'vitest';
import { decideMode } from '../src/core/mode';

const f = (name: string) => ({ name, size: 100 });

describe('decideMode (D-02)', () => {
  it('파일이 없으면 empty', () => {
    expect(decideMode([]).kind).toBe('empty');
  });

  it('하나면 단일 뷰어', () => {
    expect(decideMode([f('a.pdf')]).kind).toBe('viewer-single');
  });

  it('같은 확장자면 비교', () => {
    const m = decideMode([f('a.docx'), f('b.docx')]);
    expect(m.kind).toBe('compare');
    if (m.kind === 'compare') expect(m.crossFormat).toBe(false);
  });

  it('txt 와 md 는 같은 그룹이라 비교하되 crossFormat 표시', () => {
    const m = decideMode([f('a.txt'), f('b.md')]);
    expect(m.kind).toBe('compare');
    if (m.kind === 'compare') expect(m.crossFormat).toBe(true);
  });

  it('hwp 와 hwpx 는 비교 허용', () => {
    const m = decideMode([f('a.hwp'), f('b.hwpx')]);
    expect(m.kind).toBe('compare');
  });

  it('그룹이 다르면 뷰어 분할', () => {
    expect(decideMode([f('a.pdf'), f('b.docx')]).kind).toBe('viewer-split');
  });

  it('대소문자는 무시한다', () => {
    expect(decideMode([f('A.PDF'), f('b.pdf')]).kind).toBe('compare');
  });

  it('세 개 이상은 거부', () => {
    expect(() => decideMode([f('a.txt'), f('b.txt'), f('c.txt')])).toThrow();
  });
});
