import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brokenDocxDoc, docxDoc, hwpxDoc, longPdfDoc, pdfDoc, txtDoc } from '../helpers/makeDocs';
import { makeEncryptedPdf } from '../helpers/encryptedPdf';

/**
 * E2E 가 올릴 문서를 만들어 둔다 (T-073).
 * globalSetup 에서 한 번 돌고, 각 시나리오는 여기 이름만 가져다 쓴다.
 */
export const FIXTURE_DIR = fileURLToPath(new URL('./.fixtures', import.meta.url));

export const F = {
  txtBefore: 'before.txt',
  txtAfter: 'after.txt',
  docxBefore: 'before.docx',
  docxAfter: 'after.docx',
  docxBroken: 'broken.docx',
  pdfBefore: 'before.pdf',
  pdfAfter: 'after.pdf',
  pdfSmall: 'small.pdf',
  hwpx: 'sample.hwpx',
  pdfLocked: 'locked.pdf',
  pdfLockedCopy: 'locked-copy.pdf',
} as const;

/** 시나리오 7 이 입력할 비밀번호. */
export const LOCKED_PASSWORD = 'yeolryeora';

export function fixture(name: string): string {
  return join(FIXTURE_DIR, name);
}

/** 진행률이 눈에 보이고 취소를 누를 시간이 남을 만큼. */
const LONG_PDF_PAGES = 400;

export async function buildFixtures(): Promise<void> {
  mkdirSync(FIXTURE_DIR, { recursive: true });

  const put = (name: string, bytes: Uint8Array) => writeFileSync(fixture(name), bytes);

  // 1) TXT — 한 문단만 다르다.
  put(F.txtBefore, txtDoc('제1조(목적)\n이 규정은 계약서를 비교한다.\n\n제2조(적용범위)\n모든 문서에 적용한다.\n'));
  put(F.txtAfter, txtDoc('제1조(목적)\n이 규정은 계약서는 비교한다.\n\n제2조(적용범위)\n모든 문서에 적용한다.\n'));

  // 2) DOCX — 차이가 공백뿐이다. "공백 무시" 토글의 효과가 그대로 드러난다.
  put(F.docxBefore, await docxDoc(['계약 기간은 1년으로 한다.', '갱신은 자동으로 이루어진다.']));
  put(F.docxAfter, await docxDoc(['계약 기간은  1년으로   한다.', '갱신은 자동으로 이루어진다.']));
  put(F.docxBroken, await brokenDocxDoc());

  // 3) PDF — 진행률·취소를 보려면 오래 걸려야 한다.
  put(F.pdfBefore, longPdfDoc(LONG_PDF_PAGES, 'before'));
  put(F.pdfAfter, longPdfDoc(LONG_PDF_PAGES, 'after'));
  put(F.pdfSmall, pdfDoc([['Sample notice document.', 'Article 1. It has two lines.']]));

  // 4) 암호 PDF 두 벌(같은 바이트, 다른 이름). 열리면 "두 문서가 같습니다" 가 나와야 한다.
  //    쪽당 200자를 넘겨야 스캔본 의심(§6.8)에 걸리지 않는다.
  const locked = makeEncryptedPdf(
    LOCKED_PASSWORD,
    Array.from({ length: 8 }, (_, i) => `Article ${i + 1}. This locked document has enough text to read.`),
  );
  put(F.pdfLocked, locked);
  put(F.pdfLockedCopy, locked);

  // 5) HWPX — 단일 뷰어용.
  put(F.hwpx, await hwpxDoc(['한글 표본 문서', '둘째 문단이다.']));
}
