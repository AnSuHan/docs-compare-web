import { PDF } from './constants';
import type { PdfLine } from './lineGrouping';

/**
 * §6.5 단계 2 — 다단 조판 감지 (XY-cut).
 *
 * 페이지를 가로로 훑어 "글자가 하나도 없는 세로 띠"를 찾는다. 그 띠가 충분히
 * 넓고 양쪽에 각각 충분한 라인이 있으면 단(column)으로 인정한다.
 *
 * 표가 만드는 세로 여백에 속지 않으려고 COLUMN_MIN_LINES 조건을 둔다.
 * 그래도 확신이 낮으므로 호출자는 MULTI_COLUMN_GUESS 경고를 붙인다.
 */

export interface ColumnSplit {
  columns: PdfLine[][];
  /** 실제로 갈랐는지. false 면 단일 단이다. */
  multiColumn: boolean;
}

export function detectColumns(lines: PdfLine[], pageWidth: number): ColumnSplit {
  if (lines.length < PDF.COLUMN_MIN_LINES * 2 || pageWidth <= 0) {
    return { columns: [lines], multiColumn: false };
  }

  const bins = Math.max(1, Math.ceil(pageWidth));
  const occupied = new Uint8Array(bins);
  for (const l of lines) {
    const from = Math.max(0, Math.floor(l.x0));
    const to = Math.min(bins - 1, Math.ceil(l.x1));
    for (let i = from; i <= to; i++) occupied[i] = 1;
  }

  const minGutter = pageWidth * PDF.COLUMN_GUTTER_RATIO;
  const contentFrom = Math.max(0, Math.floor(Math.min(...lines.map((l) => l.x0))));
  const contentTo = Math.min(bins - 1, Math.ceil(Math.max(...lines.map((l) => l.x1))));

  // 본문 영역 안쪽의 빈 띠만 후보다. 좌우 여백은 단 구분이 아니다.
  const gutters: Array<{ start: number; end: number }> = [];
  let runStart = -1;
  for (let i = contentFrom; i <= contentTo; i++) {
    if (!occupied[i]) {
      if (runStart < 0) runStart = i;
    } else if (runStart >= 0) {
      if (i - runStart >= minGutter) gutters.push({ start: runStart, end: i });
      runStart = -1;
    }
  }

  if (gutters.length === 0) return { columns: [lines], multiColumn: false };

  // 가장 넓은 띠 하나만 쓴다. 3단 이상은 실무 문서에서 드물고 오탐 위험이 크다.
  const widest = gutters.reduce((a, b) => (b.end - b.start > a.end - a.start ? b : a));
  const cut = (widest.start + widest.end) / 2;

  const left = lines.filter((l) => l.x1 <= cut);
  const right = lines.filter((l) => l.x0 >= cut);
  const straddling = lines.filter((l) => l.x0 < cut && l.x1 > cut);

  if (left.length < PDF.COLUMN_MIN_LINES || right.length < PDF.COLUMN_MIN_LINES) {
    return { columns: [lines], multiColumn: false };
  }
  // 띠를 가로지르는 라인이 많으면 단이 아니라 표다.
  if (straddling.length > (left.length + right.length) * 0.2) {
    return { columns: [lines], multiColumn: false };
  }

  // 읽기 순서 = 컬럼 좌→우, 각 컬럼 내 위→아래.
  // 제목처럼 양단을 가로지르는 라인은 위쪽 것부터 왼쪽 단 앞에 둔다.
  const byY = (a: PdfLine, b: PdfLine) => b.y - a.y;
  const head = straddling.filter((l) => l.y > Math.max(...left.map((x) => x.y), ...right.map((x) => x.y)) - 1);
  const rest = straddling.filter((l) => !head.includes(l));

  return {
    columns: [
      [...head.sort(byY), ...left.sort(byY)],
      [...right.sort(byY), ...rest.sort(byY)],
    ],
    multiColumn: true,
  };
}
