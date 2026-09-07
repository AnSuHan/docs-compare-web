/** §6.3 — 기하 재조립 휴리스틱의 모든 임계값을 한곳에 모은다. */
export const PDF = {
  LINE_Y_TOLERANCE_RATIO: 0.3, // 같은 라인 판정: y차 < median(height)*0.3
  SPACE_GAP_RATIO: 0.3, // x간격 > 평균문자폭*0.3 이면 공백 삽입
  PARA_GAP_RATIO: 1.5, // 수직간격 > median(행간)*1.5 이면 문단 분리
  LINE_FULL_RATIO: 0.95, // 라인 끝이 우측경계의 95% 이상 = 자연 줄바꿈
  COLUMN_GUTTER_RATIO: 0.03, // 세로 여백 띠 폭 > 페이지폭*3% 이면 단 분리
  COLUMN_MIN_LINES: 5, // 컬럼 후보 최소 라인 수 (표 오탐 방지)
  HEADER_ZONE: 0.1, // 상단 10%
  FOOTER_ZONE: 0.1, // 하단 10%
  HEADER_REPEAT_RATIO: 0.6, // 60% 이상 페이지에서 반복 → 머리말
  MIN_PAGES_FOR_HEADER_DETECT: 3,
  SCAN_CHARS_PER_PAGE: 50, // 이 미만 → 스캔본 확정
  SUSPECT_CHARS_PER_PAGE: 200, // 이 미만 → 부분 스캔 의심
  DUP_COORD_EPS: 1.0, // 1pt 이내 동일 문자열 = 그림자 효과, 병합
  MAX_PAGES: 1_000,
  /** heading 승격: 라인이 평균의 이 비율보다 짧아야 한다 */
  HEADING_SHORT_RATIO: 0.6,
  /** heading 승격: 폰트가 본문보다 이 배 이상 커야 한다 */
  HEADING_FONT_RATIO: 1.15,
} as const;

/**
 * 문장이 끝났는지. 한국어는 마침표를 안 찍고 '~다/요/임/함/음' 으로 끝나는
 * 경우가 흔해서 종결어미도 함께 본다.
 */
export const SENTENCE_END = /[.?!。]$|[다요임함음](\.)?$|[:;]$/;

/** 새 항목의 시작. 이런 줄은 앞 문단에 이어붙이지 않는다. */
export const BULLET_START = /^\s*([①-⑳]|[가-힣]\.|\d+[.)]|[-•·▪○□◇◆■▶*])\s/;
