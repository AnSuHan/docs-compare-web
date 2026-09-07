import { describe, expect, it } from 'vitest';
import { parseMarkdownBlocks, stripInline } from '../src/core/parsers/markdown';

describe('stripInline', () => {
  it('링크는 표시 텍스트만 남긴다', () => {
    expect(stripInline('자세한 내용은 [계약서](https://x/y) 를 보세요')).toBe('자세한 내용은 계약서 를 보세요');
  });

  it('강조·코드 표시를 벗긴다', () => {
    expect(stripInline('**굵게** 와 *기울임* 과 `코드`')).toBe('굵게 와 기울임 과 코드');
  });
});

describe('parseMarkdownBlocks', () => {
  it('제목을 level 과 함께 잡는다', () => {
    const [h1, h3] = parseMarkdownBlocks('# 제목\n\n### 소제목');
    expect(h1).toMatchObject({ type: 'heading', level: 1, rawText: '제목' });
    expect(h3).toMatchObject({ type: 'heading', level: 3, rawText: '소제목' });
  });

  it('빈 줄로 문단을 끊고 단일 개행은 문단 안에 남긴다', () => {
    const blocks = parseMarkdownBlocks('첫 문단 첫 줄\n첫 문단 둘째 줄\n\n둘째 문단');
    expect(blocks).toHaveLength(2);
    expect(blocks[0]!.rawText).toBe('첫 문단 첫 줄\n첫 문단 둘째 줄');
  });

  it('목록은 항목마다 블록 하나다', () => {
    const blocks = parseMarkdownBlocks('- 하나\n- 둘\n- 셋');
    expect(blocks).toHaveLength(3);
    expect(blocks.every((b) => b.type === 'listItem')).toBe(true);
    expect(blocks[1]!.rawText).toBe('둘');
  });

  it('중첩 목록의 깊이를 level 로 남긴다', () => {
    const blocks = parseMarkdownBlocks('- 상위\n  - 하위');
    expect(blocks[0]!.level).toBe(0);
    expect(blocks[1]!.level).toBe(1);
  });

  it('코드 펜스 안은 문법을 해석하지 않는다', () => {
    const blocks = parseMarkdownBlocks('```\n# 제목이 아니다\n- 목록도 아니다\n```');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.type).toBe('code');
    expect(blocks[0]!.rawText).toContain('# 제목이 아니다');
  });

  it('인용을 잡는다', () => {
    const [q] = parseMarkdownBlocks('> 인용문입니다');
    expect(q).toMatchObject({ type: 'quote', rawText: '인용문입니다' });
  });

  it('표는 셀을 " | " 로 이어 한 블록으로 만든다', () => {
    const [t] = parseMarkdownBlocks('| 항목 | 값 |\n|---|---|\n| 가 | 1 |');
    expect(t!.type).toBe('table');
    expect(t!.rawText).toBe('항목 | 값\n가 | 1');
  });

  it('setext 제목을 승격한다', () => {
    const [h] = parseMarkdownBlocks('제목입니다\n=====');
    expect(h).toMatchObject({ type: 'heading', level: 1 });
  });

  it('수평선은 블록을 만들지 않는다', () => {
    expect(parseMarkdownBlocks('---')).toHaveLength(0);
  });
});
