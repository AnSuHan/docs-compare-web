import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';

/**
 * README 스크린샷에 쓰는 표본 계약서 두 벌.
 *
 * 저장소에 .docx 를 넣지 않는다 — 무엇이 들어 있는지 여기서 코드로 읽힌다.
 * 네 가지가 한 화면에 다 보이도록 골랐다.
 *   1. 완전히 같은 문단        → 세 칸 보기에서 가운데에만
 *   2. 숫자만 다른 문단        → 공통은 가운데, 숫자만 좌우로
 *   3. 한쪽에만 있는 문단      → 왼쪽 또는 오른쪽 한 칸
 *   4. 표 안의 금액 변경       → 표는 한 블록으로 평탄화된다
 */
export const SAMPLE_DIR = fileURLToPath(new URL('./.samples', import.meta.url));

export const SAMPLES = { before: '계약서_v1_이전.docx', after: '계약서_v2_이후.docx' } as const;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const para = (t: string, style?: string) =>
  `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}` +
  `<w:r><w:t xml:space="preserve">${esc(t)}</w:t></w:r></w:p>`;

const table = (rows: string[][]) =>
  `<w:tbl>${rows
    .map(
      (cells) =>
        `<w:tr>${cells
          .map((c) => `<w:tc><w:tcPr><w:tcW w:w="2400" w:type="dxa"/></w:tcPr>${para(c)}</w:tc>`)
          .join('')}</w:tr>`,
    )
    .join('')}</w:tbl>`;

async function docx(blocks: string[]): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`,
  );
  zip.file(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
  );
  zip.file(
    'word/_rels/document.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
  );
  zip.file(
    'word/styles.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style></w:styles>`,
  );
  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${blocks.join(
      '',
    )}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:body></w:document>`,
  );
  return zip.generateAsync({ type: 'uint8array' });
}

const BEFORE = [
  para('문서 검토 용역 계약서', 'Heading1'),
  para('제1조(목적) 이 계약은 갑과 을 사이의 문서 검토 용역에 관한 사항을 정함을 목적으로 한다.'),
  para('제2조(계약기간) 계약 기간은 2026년 1월 1일부터 1년으로 한다.'),
  para('제3조(대금) 갑은 을에게 매월 금 300만원을 지급한다.'),
  para('제4조(비밀유지) 을은 업무상 알게 된 갑의 정보를 제3자에게 누설하지 아니한다.'),
  para('제5조(해지) 일방이 이 계약을 위반한 경우 상대방은 즉시 계약을 해지할 수 있다.'),
  para('제6조(준거법) 이 계약의 해석은 대한민국 법령에 따른다.'),
  table([
    ['구분', '금액'],
    ['착수금', '1,000,000원'],
    ['잔금', '2,000,000원'],
  ]),
  para('붙임 1. 과업지시서 1부.'),
];

const AFTER = [
  para('문서 검토 용역 계약서', 'Heading1'),
  para('제1조(목적) 이 계약은 갑과 을 사이의 문서 검토 용역에 관한 사항을 정함을 목적으로 한다.'),
  para('제2조(계약기간) 계약 기간은 2026년 1월 1일부터 2년으로 한다.'),
  para('제3조(대금) 갑은 을에게 매월 금 350만원을 지급한다.'),
  para('제4조(비밀유지) 을은 업무상 알게 된 갑의 정보를 제3자에게 누설하지 아니한다.'),
  para('제5조(지식재산권) 용역 결과물에 대한 지식재산권은 갑에게 귀속한다.'),
  para('제6조(준거법) 이 계약의 해석은 대한민국 법령에 따른다.'),
  table([
    ['구분', '금액'],
    ['착수금', '1,500,000원'],
    ['잔금', '2,000,000원'],
  ]),
  para('붙임 1. 과업지시서 1부.'),
];

export async function writeSamples(): Promise<void> {
  mkdirSync(SAMPLE_DIR, { recursive: true });
  writeFileSync(join(SAMPLE_DIR, SAMPLES.before), await docx(BEFORE));
  writeFileSync(join(SAMPLE_DIR, SAMPLES.after), await docx(AFTER));
}
