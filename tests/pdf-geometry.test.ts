import { describe, expect, it } from 'vitest';
import { dedupeItems, splitByRotation, toItem, type PdfItem } from '../src/core/parsers/pdf/items';
import { groupLines, type PdfLine } from '../src/core/parsers/pdf/lineGrouping';
import { detectColumns } from '../src/core/parsers/pdf/columnDetect';
import { findRepeatedLines, repeatKey, stripRepeated } from '../src/core/parsers/pdf/headerFooter';
import { mergeLines } from '../src/core/parsers/pdf/paragraphMerge';
import { joinAcrossPages } from '../src/core/parsers/pdf/pageJoin';
import { classifyDensity } from '../src/core/parsers/pdf/scanDetect';
import { buildMcidIndex, hasTextTags, walkStructTree } from '../src/core/parsers/pdf/structTree';

function item(str: string, x: number, y: number, width = str.length * 10, height = 10): PdfItem {
  return { str, x, y, width, height, fontName: 'F1', rotation: 0 };
}

function line(text: string, y: number, x0 = 0, x1 = 400, height = 10, fontName = 'F1'): PdfLine {
  return { text, x0, x1, y, height, fontName, itemCount: 1, wideGaps: 0 };
}

describe('toItem', () => {
  it('transform 에서 좌표와 회전각을 뽑는다', () => {
    const it0 = toItem({ str: '가', transform: [12, 0, 0, 12, 100, 700], width: 12, height: 12 });
    expect(it0).toMatchObject({ x: 100, y: 700, rotation: 0 });

    // 90도로 눕힌 텍스트
    const it90 = toItem({ str: '나', transform: [0, 12, -12, 0, 50, 300], width: 12, height: 12 });
    expect(it90.rotation).toBe(90);
  });
});

describe('dedupeItems', () => {
  it('1pt 이내 같은 글자를 하나로 합친다 — 볼드 흉내 이중 인쇄', () => {
    const items = [item('계약', 100, 700), item('계약', 100.5, 700.3), item('서', 120, 700)];
    expect(dedupeItems(items).map((i) => i.str)).toEqual(['계약', '서']);
  });

  it('멀리 떨어진 같은 글자는 남긴다', () => {
    const items = [item('가', 100, 700), item('가', 300, 700)];
    expect(dedupeItems(items)).toHaveLength(2);
  });
});

describe('splitByRotation', () => {
  it('눕힌 텍스트를 버리지 않고 각도별로 갈라 둔다', () => {
    const items = [item('본문', 0, 700), { ...item('세로표', 0, 500), rotation: 90 }];
    const { upright, rotated } = splitByRotation(items);
    expect(upright).toHaveLength(1);
    expect(rotated.get(90)).toHaveLength(1);
  });
});

describe('groupLines', () => {
  it('같은 y 의 아이템을 한 줄로 묶는다', () => {
    const lines = groupLines([item('제1조', 100, 700), item('(목적)', 160, 700.2)]);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.text).toBe('제1조 (목적)');
  });

  it('좌표 이동으로 표현된 공백을 되살린다', () => {
    // '가' 는 폭 10, 끝은 x=110. 다음 글자가 x=140 이면 3칸 벌어진 것이다.
    const lines = groupLines([item('가', 100, 700, 10), item('나', 140, 700, 10)]);
    expect(lines[0]!.text).toBe('가 나');
  });

  it('붙어 있는 글자 사이에는 공백을 넣지 않는다', () => {
    const lines = groupLines([item('계약', 100, 700, 20), item('서', 120, 700, 10)]);
    expect(lines[0]!.text).toBe('계약서');
  });

  it('y 가 다르면 다른 줄이고, 위에서 아래 순서로 나온다', () => {
    const lines = groupLines([item('아래', 100, 600), item('위', 100, 700)]);
    expect(lines.map((l) => l.text)).toEqual(['위', '아래']);
  });
});

describe('detectColumns', () => {
  it('2단 조판을 좌→우 순서로 가른다', () => {
    const left = Array.from({ length: 6 }, (_, i) => line(`왼쪽${i}`, 700 - i * 12, 50, 240));
    const right = Array.from({ length: 6 }, (_, i) => line(`오른쪽${i}`, 700 - i * 12, 320, 520));
    const r = detectColumns([...left, ...right], 570);

    expect(r.multiColumn).toBe(true);
    expect(r.columns).toHaveLength(2);
    expect(r.columns[0]![0]!.text).toBe('왼쪽0');
    expect(r.columns[1]![0]!.text).toBe('오른쪽0');
  });

  it('한 단 문서는 가르지 않는다', () => {
    const lines = Array.from({ length: 10 }, (_, i) => line(`본문 ${i}`, 700 - i * 12, 50, 520));
    expect(detectColumns(lines, 570).multiColumn).toBe(false);
  });

  it('띠를 가로지르는 줄이 많으면 표로 보고 가르지 않는다', () => {
    const lines = [
      ...Array.from({ length: 6 }, (_, i) => line(`왼${i}`, 700 - i * 12, 50, 240)),
      ...Array.from({ length: 6 }, (_, i) => line(`오${i}`, 700 - i * 12, 320, 520)),
      ...Array.from({ length: 5 }, (_, i) => line(`가로지름${i}`, 600 - i * 12, 50, 520)),
    ];
    expect(detectColumns(lines, 570).multiColumn).toBe(false);
  });
});

describe('머리말/꼬리말', () => {
  it('쪽번호의 숫자를 마스킹해 같은 키로 본다', () => {
    expect(repeatKey('- 12 -')).toBe('- # -');
    expect(repeatKey('- 3 -')).toBe('- # -');
  });

  it('60% 이상 페이지에서 반복되는 상·하단 줄을 찾아 지운다', () => {
    const geoms = Array.from({ length: 4 }, () => ({ yMin: 0, yMax: 800 }));
    const pages = Array.from({ length: 4 }, (_, p) => [
      line('주식회사 예시 · 대외비', 780), // 머리말
      line(`본문 ${p}`, 400),
      line(`- ${p + 1} -`, 20), // 꼬리말
    ]);

    const repeated = findRepeatedLines(pages, geoms);
    expect(repeated.has('주식회사 예시 · 대외비')).toBe(true);
    expect(repeated.has('- # -')).toBe(true);

    const { pages: stripped, removed } = stripRepeated(pages, geoms, repeated);
    expect(stripped[0]!.map((l) => l.text)).toEqual(['본문 0']);
    expect(removed.length).toBeGreaterThan(0);
  });

  it('본문 한가운데 있는 같은 문구는 지우지 않는다', () => {
    const geoms = Array.from({ length: 4 }, () => ({ yMin: 0, yMax: 800 }));
    const pages = Array.from({ length: 4 }, () => [line('반복되는 본문', 400)]);
    expect(findRepeatedLines(pages, geoms).size).toBe(0);
  });

  it('페이지가 3장 미만이면 판정하지 않는다', () => {
    const geoms = [{ yMin: 0, yMax: 800 }, { yMin: 0, yMax: 800 }];
    const pages = [[line('머리말', 780)], [line('머리말', 780)]];
    expect(findRepeatedLines(pages, geoms).size).toBe(0);
  });
});

describe('mergeLines', () => {
  it('문장이 안 끝났고 우측 끝까지 갔으면 잇는다', () => {
    const blocks = mergeLines([line('이 계약은 갑과 을 사이의', 700, 50, 500), line('권리와 의무를 정한다.', 688, 50, 400)], 0);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.text).toBe('이 계약은 갑과 을 사이의 권리와 의무를 정한다.');
  });

  it('앞 줄이 종결어미로 끝나면 끊는다 — 한국어는 마침표를 안 찍는다', () => {
    const blocks = mergeLines([line('제1조의 내용은 다음과 같다', 700, 50, 500), line('제2조 목적', 688, 50, 500)], 0);
    expect(blocks).toHaveLength(2);
  });

  it('다음 줄이 글머리표로 시작하면 잇지 않는다', () => {
    const blocks = mergeLines([line('다음 각 호와 같이 정하며', 700, 50, 500), line('1. 첫째 항목', 688, 50, 500)], 0);
    expect(blocks).toHaveLength(2);
  });

  it('앞 줄이 우측 경계에 못 미치면 강제 줄바꿈으로 보고 끊는다', () => {
    const blocks = mergeLines([line('짧게 끝난 줄', 700, 50, 200), line('다음 줄입니다', 688, 50, 500)], 0);
    expect(blocks).toHaveLength(2);
  });

  it('짧고 큰 글씨는 제목으로 승격한다', () => {
    const blocks = mergeLines(
      [
        line('계약서', 700, 50, 120, 20),
        line('이 계약은 갑과 을 사이의 권리와 의무를 정한다', 660, 50, 500, 10),
      ],
      0,
    );
    expect(blocks[0]).toMatchObject({ type: 'heading', text: '계약서' });
  });
});

describe('joinAcrossPages', () => {
  it('쪽을 넘어 이어지는 문단을 하나로 잇는다 — 가장 흔하고 치명적인 함정', () => {
    const { blocks, joined } = joinAcrossPages([
      [{ type: 'paragraph', text: '이 계약은 갑과 을 사이의', y: 0, page: 0, tableLike: false }],
      [{ type: 'paragraph', text: '권리와 의무를 정한다.', y: 0, page: 1, tableLike: false }],
    ]);
    expect(joined).toBe(1);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.text).toBe('이 계약은 갑과 을 사이의 권리와 의무를 정한다.');
  });

  it('앞 쪽이 문장으로 끝났으면 잇지 않는다', () => {
    const { blocks, joined } = joinAcrossPages([
      [{ type: 'paragraph', text: '앞 쪽은 여기서 끝난다.', y: 0, page: 0, tableLike: false }],
      [{ type: 'paragraph', text: '새 문단이 시작된다.', y: 0, page: 1, tableLike: false }],
    ]);
    expect(joined).toBe(0);
    expect(blocks).toHaveLength(2);
  });

  it('제목은 잇지 않는다', () => {
    const { joined } = joinAcrossPages([
      [{ type: 'paragraph', text: '이어질 것 같은 문장', y: 0, page: 0, tableLike: false }],
      [{ type: 'heading', text: '제2장', y: 0, page: 1, tableLike: false }],
    ]);
    expect(joined).toBe(0);
  });
});

describe('classifyDensity', () => {
  it('페이지당 50자 미만이면 스캔본으로 확정한다', () => {
    expect(classifyDensity(100, 10).verdict).toBe('scanned');
  });

  it('50~200자는 부분 스캔 의심이다', () => {
    expect(classifyDensity(1000, 10).verdict).toBe('suspect');
  });

  it('충분한 텍스트가 있으면 정상이다', () => {
    expect(classifyDensity(20000, 10).verdict).toBe('text');
  });

  it('이미지가 페이지를 덮고 있으면 판정을 한 단계 올린다', () => {
    expect(classifyDensity(1000, 10, 9).verdict).toBe('scanned');
  });
});

describe('구조 트리 (트랙 A)', () => {
  const tree = {
    role: 'Document',
    children: [
      { role: 'H1', children: [{ type: 'content' as const, id: 'p0_mc0' }] },
      { role: 'P', children: [{ type: 'content' as const, id: 'p0_mc1' }] },
    ],
  };

  const items = [
    { type: 'beginMarkedContentProps', id: 'p0_mc0' },
    { str: '계약서' },
    { type: 'endMarkedContent' },
    { type: 'beginMarkedContentProps', id: 'p0_mc1' },
    { str: '제1조 ' },
    { str: '(목적)' },
    { type: 'endMarkedContent' },
  ];

  it('mcid 로 텍스트를 모은다', () => {
    const idx = buildMcidIndex(items);
    expect(idx.get('p0_mc0')).toBe('계약서');
    expect(idx.get('p0_mc1')).toBe('제1조 (목적)');
  });

  it('텍스트 태그가 있으면 트랙 A 를 쓴다', () => {
    expect(hasTextTags(tree)).toBe(true);
    expect(hasTextTags({ role: 'Document', children: [] })).toBe(false);
  });

  it('태그를 블록으로 옮기고 제목 level 을 보존한다', () => {
    const blocks = walkStructTree(tree, buildMcidIndex(items), 0);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({ type: 'heading', level: 1, text: '계약서' });
    expect(blocks[1]).toMatchObject({ type: 'paragraph', text: '제1조 (목적)' });
  });
});
