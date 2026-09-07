import { PDF } from './constants';
import { median, type PdfItem } from './items';

/**
 * §6.5 단계 1 — 라인 그룹핑.
 *
 * PDF 는 공백을 문자로 넣지 않고 좌표 이동으로 표현하는 경우가 많다.
 * 그래서 아이템 사이 간격을 보고 공백을 되살려야 한다. 이걸 안 하면
 * "계약서를체결한다" 처럼 붙어 나와 diff 가 통째로 망가진다.
 */

export interface PdfLine {
  text: string;
  /** 라인 왼쪽 끝 */
  x0: number;
  /** 라인 오른쪽 끝 */
  x1: number;
  /** 대표 y (베이스라인) */
  y: number;
  height: number;
  fontName: string;
  itemCount: number;
  /** 한 라인 안의 큰 x 공백 개수. 3 이상이면 괘선 없는 표일 수 있다(§6.6). */
  wideGaps: number;
}

export function groupLines(items: PdfItem[]): PdfLine[] {
  if (items.length === 0) return [];

  const medianHeight = median(items.map((i) => i.height)) || 1;
  const tol = medianHeight * PDF.LINE_Y_TOLERANCE_RATIO;

  // y 내림차순(위에서 아래로). 같은 y 면 x 오름차순.
  const sorted = [...items].sort((a, b) => (b.y - a.y) || (a.x - b.x));

  const groups: PdfItem[][] = [];
  let current: PdfItem[] = [];
  let anchorY = Number.NaN;

  for (const it of sorted) {
    if (current.length === 0 || Math.abs(it.y - anchorY) < tol) {
      if (current.length === 0) anchorY = it.y;
      current.push(it);
    } else {
      groups.push(current);
      current = [it];
      anchorY = it.y;
    }
  }
  if (current.length) groups.push(current);

  return groups.map(buildLine).filter((l) => l.text.trim().length > 0);
}

function buildLine(group: PdfItem[]): PdfLine {
  const parts = [...group].sort((a, b) => a.x - b.x);

  // 평균 문자폭. 폭이 0 인 아이템(합자 등)이 섞여 있어 글자 수로 나눈다.
  let totalWidth = 0;
  let totalChars = 0;
  for (const p of parts) {
    totalWidth += p.width;
    totalChars += p.str.length;
  }
  const avgCharWidth = totalChars > 0 ? totalWidth / totalChars : median(parts.map((p) => p.height)) * 0.5;
  const spaceGap = avgCharWidth * PDF.SPACE_GAP_RATIO;
  // 표로 볼 만한 큰 공백: 문자 3개 폭 이상
  const wideGap = avgCharWidth * 3;

  let text = '';
  let wideGaps = 0;
  let prevEnd = Number.NaN;

  for (const p of parts) {
    if (Number.isFinite(prevEnd)) {
      const gap = p.x - prevEnd;
      if (gap > wideGap) wideGaps++;
      if (gap > spaceGap && !/\s$/.test(text) && !/^\s/.test(p.str)) text += ' ';
    }
    text += p.str;
    prevEnd = p.x + p.width;
  }

  const heights = parts.map((p) => p.height);
  return {
    text,
    x0: parts[0]!.x,
    x1: prevEnd,
    y: median(parts.map((p) => p.y)),
    height: median(heights),
    // 라인의 대표 폰트는 가장 많은 글자를 차지한 폰트로 잡는다.
    fontName: dominantFont(parts),
    itemCount: parts.length,
    wideGaps,
  };
}

function dominantFont(parts: PdfItem[]): string {
  const byFont = new Map<string, number>();
  for (const p of parts) byFont.set(p.fontName, (byFont.get(p.fontName) ?? 0) + p.str.length);
  let best = '';
  let bestN = -1;
  for (const [font, n] of byFont) {
    if (n > bestN) {
      best = font;
      bestN = n;
    }
  }
  return best;
}
