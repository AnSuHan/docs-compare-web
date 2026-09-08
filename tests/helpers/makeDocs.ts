import JSZip from 'jszip';

/**
 * 테스트용 문서를 만든다.
 *
 * 바이너리 픽스처를 저장소에 넣지 않는다 — 무엇이 들어 있는지 코드로 읽히고,
 * 시나리오마다 필요한 만큼(400쪽 PDF 같은 것)을 그때 만들 수 있다.
 * 실문서 검수는 이것과 다른 이야기다. 그건 `npm run inspect` 로 한다.
 */

const enc = new TextEncoder();

export function txtDoc(text: string): Uint8Array {
  return enc.encode(text);
}

export async function docxDoc(paragraphs: string[]): Promise<Uint8Array> {
  const body = paragraphs
    .map((t) => `<w:p><w:r><w:t xml:space="preserve">${escapeXml(t)}</w:t></w:r></w:p>`)
    .join('');

  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
  );
  zip.file(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
  );
  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`,
  );
  return zip.generateAsync({ type: 'uint8array' });
}

export async function hwpxDoc(paragraphs: string[]): Promise<Uint8Array> {
  const body = paragraphs.map((t) => `<hp:p><hp:run><hp:t>${escapeXml(t)}</hp:t></hp:run></hp:p>`).join('');

  const zip = new JSZip();
  zip.file('mimetype', 'application/hwp+zip');
  zip.file(
    'META-INF/container.xml',
    `<?xml version="1.0" encoding="UTF-8"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="Contents/content.hpf"/></rootfiles></container>`,
  );
  zip.file(
    'Contents/header.xml',
    `<?xml version="1.0" encoding="UTF-8"?><hh:head xmlns:hh="http://www.hancom.co.kr/hwpml/2011/head" secCnt="1"></hh:head>`,
  );
  zip.file(
    'Contents/section0.xml',
    `<?xml version="1.0" encoding="UTF-8"?><hs:sec xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph">${body}</hs:sec>`,
  );
  return zip.generateAsync({ type: 'uint8array' });
}

/** ZIP 이긴 한데 word/document.xml 이 없다. 손상 파일 시나리오용. */
export async function brokenDocxDoc(): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file('docProps/app.xml', '<Properties/>');
  return zip.generateAsync({ type: 'uint8array' });
}

/**
 * 쪽마다 줄 목록을 받아 PDF 를 만든다.
 * 글꼴 하나(Helvetica)만 쓰고 스트림을 압축하지 않는다 — 읽히는 것이 목적이다.
 */
export function pdfDoc(pages: string[][]): Uint8Array {
  const objs: string[] = [];
  /** 개체를 넣고 그 번호를 돌려준다. PDF 개체 번호는 1부터다. */
  const add = (body: string): number => objs.push(body);

  const CATALOG = add(''); // 1 — 뒤에서 채운다
  const PAGES = add('');   // 2
  const FONT = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'); // 3

  const kids: number[] = [];
  for (const lines of pages) {
    let y = 740;
    const stream = lines.map((t) => `BT /F1 11 Tf 72 ${(y -= 18)} Td (${escapePdf(t)}) Tj ET`).join('\n');
    const content = add(`<< /Length ${byteLen(stream)} >>\nstream\n${stream}\nendstream`);
    kids.push(
      add(
        `<< /Type /Page /Parent ${PAGES} 0 R /MediaBox [0 0 612 792] ` +
          `/Resources << /Font << /F1 ${FONT} 0 R >> >> /Contents ${content} 0 R >>`,
      ),
    );
  }

  objs[CATALOG - 1] = `<< /Type /Catalog /Pages ${PAGES} 0 R >>`;
  objs[PAGES - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((body, i) => {
    offsets[i] = byteLen(pdf);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xrefAt = byteLen(pdf);
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root ${CATALOG} 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;

  return latin1(pdf);
}

/** 같은 문단이 여러 쪽 이어지는 문서. 파싱이 길어져야 진행률·취소를 볼 수 있다. */
export function longPdfDoc(pageCount: number, tag: string): Uint8Array {
  const pages = Array.from({ length: pageCount }, (_, p) =>
    Array.from({ length: 30 }, (_, i) => `${tag} page ${p + 1} line ${i + 1} of the sample notice document.`),
  );
  return pdfDoc(pages);
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** PDF 리터럴 문자열에서 괄호와 역슬래시는 이스케이프해야 한다. */
function escapePdf(s: string): string {
  return s.replace(/([\\()])/g, '\\$1');
}

function byteLen(s: string): number {
  return s.length; // latin1 로만 쓴다. 한 글자 = 한 바이트.
}

function latin1(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}
