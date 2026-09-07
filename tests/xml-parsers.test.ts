import { describe, expect, it } from 'vitest';
import { decodeEntities, rootAttrs, scanXml } from '../src/core/xml';
import { parseDocumentXml } from '../src/core/parsers/docx';
import { parseSectionXml, readHeadingStyles } from '../src/core/parsers/hwpx';

describe('scanXml', () => {
  it('여는·닫는 태그와 텍스트를 문서 순서대로 준다', () => {
    const kinds = [...scanXml('<a><b>텍스트</b></a>')].map((e) => e.kind);
    expect(kinds).toEqual(['open', 'open', 'text', 'close', 'close']);
  });

  it('네임스페이스 접두사를 뗀 이름을 준다', () => {
    const [ev] = [...scanXml('<hp:t>가</hp:t>')];
    expect(ev).toMatchObject({ name: 't', qname: 'hp:t' });
  });

  it('속성을 읽는다', () => {
    const [ev] = [...scanXml('<hp:p paraPrIDRef="2" styleIDRef=\'7\'/>')];
    expect(ev).toMatchObject({ attrs: { paraPrIDRef: '2', styleIDRef: '7' }, selfClosing: true });
  });

  it('주석·CDATA·처리명령을 건너뛴다', () => {
    const text = [...scanXml('<?xml version="1.0"?><!-- 주석 --><a><![CDATA[<원문>]]></a>')]
      .filter((e) => e.kind === 'text')
      .map((e) => (e as { text: string }).text)
      .join('');
    expect(text).toBe('<원문>');
  });

  it('잘린 문서에서 멈추지 않는다', () => {
    expect(() => [...scanXml('<a><b>텍스트')]).not.toThrow();
  });

  it('엔티티를 푼다', () => {
    expect(decodeEntities('&lt;가&gt; &amp; &#54620;')).toBe('<가> & 한');
  });

  it('rootAttrs 로 secCnt 를 읽는다', () => {
    expect(rootAttrs('<?xml version="1.0"?><hh:head secCnt="3"></hh:head>')['secCnt']).toBe('3');
  });
});

describe('parseDocumentXml (DOCX)', () => {
  const doc = (body: string) =>
    `<w:document xmlns:w="x"><w:body>${body}</w:body></w:document>`;

  it('문단을 순서대로 읽는다', () => {
    const { drafts } = parseDocumentXml(doc('<w:p><w:r><w:t>첫째</w:t></w:r></w:p><w:p><w:r><w:t>둘째</w:t></w:r></w:p>'));
    expect(drafts.map((d) => d.rawText)).toEqual(['첫째', '둘째']);
  });

  it('한 문단 안의 여러 run 을 이어붙인다', () => {
    const { drafts } = parseDocumentXml(doc('<w:p><w:r><w:t>계약</w:t></w:r><w:r><w:t>서</w:t></w:r></w:p>'));
    expect(drafts[0]!.rawText).toBe('계약서');
  });

  it('Heading 스타일을 제목으로 승격한다', () => {
    const { drafts } = parseDocumentXml(
      doc('<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>제2장</w:t></w:r></w:p>'),
    );
    expect(drafts[0]).toMatchObject({ type: 'heading', level: 2 });
  });

  it('한글 스타일명("제목 1")도 알아본다', () => {
    const { drafts } = parseDocumentXml(
      doc('<w:p><w:pPr><w:pStyle w:val="제목 1"/></w:pPr><w:r><w:t>총칙</w:t></w:r></w:p>'),
    );
    expect(drafts[0]).toMatchObject({ type: 'heading', level: 1 });
  });

  it('번호 목록을 listItem 으로 만든다', () => {
    const { drafts } = parseDocumentXml(
      doc('<w:p><w:pPr><w:numPr><w:ilvl w:val="1"/></w:numPr></w:pPr><w:r><w:t>항목</w:t></w:r></w:p>'),
    );
    expect(drafts[0]).toMatchObject({ type: 'listItem', level: 1 });
  });

  it('탭과 줄바꿈을 보존한다', () => {
    const { drafts } = parseDocumentXml(doc('<w:p><w:r><w:t>가</w:t><w:tab/><w:t>나</w:t><w:br/><w:t>다</w:t></w:r></w:p>'));
    expect(drafts[0]!.rawText).toBe('가\t나\n다');
  });

  it('표를 한 블록으로 평탄화한다 — 셀은 " | ", 행은 개행', () => {
    const { drafts, tableCount } = parseDocumentXml(
      doc(
        '<w:tbl><w:tr>' +
          '<w:tc><w:p><w:r><w:t>항목</w:t></w:r></w:p></w:tc>' +
          '<w:tc><w:p><w:r><w:t>값</w:t></w:r></w:p></w:tc>' +
          '</w:tr><w:tr>' +
          '<w:tc><w:p><w:r><w:t>가</w:t></w:r></w:p></w:tc>' +
          '<w:tc><w:p><w:r><w:t>1</w:t></w:r></w:p></w:tc>' +
          '</w:tr></w:tbl>',
      ),
    );
    expect(tableCount).toBe(1);
    expect(drafts[0]).toMatchObject({ type: 'table', rawText: '항목 | 값\n가 | 1' });
  });

  it('삭제 추적(w:del) 안의 텍스트는 빼고 읽는다', () => {
    const { drafts } = parseDocumentXml(
      doc('<w:p><w:r><w:t>남는다</w:t></w:r><w:del><w:r><w:t>지워졌다</w:t></w:r></w:del></w:p>'),
    );
    expect(drafts[0]!.rawText).toBe('남는다');
  });
});

describe('parseSectionXml (HWPX)', () => {
  const sec = (body: string) => `<hs:sec xmlns:hs="s" xmlns:hp="p">${body}</hs:sec>`;

  it('문단을 순서대로 읽고 구역 번호를 남긴다', () => {
    const { drafts } = parseSectionXml(
      sec('<hp:p><hp:run><hp:t>첫 문단</hp:t></hp:run></hp:p>'),
      2,
      new Map(),
      0,
    );
    expect(drafts[0]).toMatchObject({ rawText: '첫 문단', source: { section: 2 } });
  });

  it('hp:tab 을 탭으로 보존한다 — 공백으로 뭉개면 표 정렬이 사라진다', () => {
    const { drafts } = parseSectionXml(
      sec('<hp:p><hp:run><hp:t>가</hp:t><hp:tab/><hp:t>나</hp:t></hp:run></hp:p>'),
      0,
      new Map(),
      0,
    );
    expect(drafts[0]!.rawText).toBe('가\t나');
  });

  it('표는 셀을 이어 한 블록으로 만든다', () => {
    const { drafts, tableCount } = parseSectionXml(
      sec(
        '<hp:p><hp:run><hp:tbl><hp:tr>' +
          '<hp:tc><hp:subList><hp:p><hp:run><hp:t>가</hp:t></hp:run></hp:p></hp:subList></hp:tc>' +
          '<hp:tc><hp:subList><hp:p><hp:run><hp:t>나</hp:t></hp:run></hp:p></hp:subList></hp:tc>' +
          '</hp:tr></hp:tbl></hp:run></hp:p>',
      ),
      0,
      new Map(),
      0,
    );
    expect(tableCount).toBe(1);
    expect(drafts[0]).toMatchObject({ type: 'table', rawText: '가 | 나' });
  });

  it('스타일 표가 있으면 개요를 제목으로 승격한다', () => {
    const styles = readHeadingStyles(
      '<hh:head><hh:styles><hh:style id="3" name="개요 2"/><hh:style id="0" name="바탕글"/></hh:styles></hh:head>',
    );
    expect(styles.get('3')).toBe(2);

    const { drafts } = parseSectionXml(
      sec('<hp:p styleIDRef="3"><hp:run><hp:t>제2절</hp:t></hp:run></hp:p>'),
      0,
      styles,
      0,
    );
    expect(drafts[0]).toMatchObject({ type: 'heading', level: 2 });
  });

  it('빈 문단은 버린다', () => {
    const { drafts } = parseSectionXml(sec('<hp:p><hp:run><hp:t></hp:t></hp:run></hp:p>'), 0, new Map(), 0);
    expect(drafts).toHaveLength(0);
  });
});
