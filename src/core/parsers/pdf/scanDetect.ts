import { PDF } from './constants';

/**
 * §6.8 — 스캔 PDF 판정.
 *
 * 스캔본은 텍스트 레이어가 없거나 극히 얇다. 밀도(문자 수 / 페이지)로 가른다.
 * 트랙 C 로 확정되면 비교를 차단하고 뷰어로만 안내한다.
 */
export type ScanVerdict = 'text' | 'suspect' | 'scanned';

export interface ScanAnalysis {
  verdict: ScanVerdict;
  charsPerPage: number;
  /** 이미지가 페이지를 거의 덮고 있는 페이지 수. 판정을 강화한다. */
  imageHeavyPages: number;
}

export function classifyDensity(totalChars: number, pages: number, imageHeavyPages = 0): ScanAnalysis {
  const charsPerPage = pages > 0 ? totalChars / pages : 0;
  const imageHeavyRatio = pages > 0 ? imageHeavyPages / pages : 0;

  let verdict: ScanVerdict;
  if (charsPerPage < PDF.SCAN_CHARS_PER_PAGE) verdict = 'scanned';
  else if (charsPerPage < PDF.SUSPECT_CHARS_PER_PAGE) verdict = 'suspect';
  else verdict = 'text';

  // 이미지가 페이지 대부분을 덮고 있으면 한 단계 올린다(§6.8 가중치 상향).
  if (imageHeavyRatio > 0.8) {
    if (verdict === 'suspect') verdict = 'scanned';
    else if (verdict === 'text' && charsPerPage < PDF.SUSPECT_CHARS_PER_PAGE * 2) verdict = 'suspect';
  }

  return { verdict, charsPerPage, imageHeavyPages };
}
