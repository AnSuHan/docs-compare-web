import { PDF } from './constants';
import type { PdfLine } from './lineGrouping';

/**
 * §6.5 단계 3 — 머리말/꼬리말 제거.
 *
 * 이걸 안 하면 두 문서의 머리말이 조금만 달라도 페이지 수만큼 변경점이 생긴다.
 * PDF diff 에서 가장 흔한 잡음원 중 하나다.
 *
 * 쪽번호가 페이지마다 다르므로 숫자를 '#' 로 마스킹한 키로 반복을 센다.
 */

export interface PageGeometry {
  /** 페이지 하단 y (보통 0) */
  yMin: number;
  /** 페이지 상단 y */
  yMax: number;
}

/** '- 12 -' → '- # -' */
export function repeatKey(text: string): string {
  return text.trim().replace(/\d+/g, '#').replace(/\s+/g, ' ');
}

export function findRepeatedLines(pages: PdfLine[][], geoms: PageGeometry[]): Set<string> {
  const repeated = new Set<string>();
  if (pages.length < PDF.MIN_PAGES_FOR_HEADER_DETECT) return repeated;

  const seenOnPages = new Map<string, Set<number>>();

  pages.forEach((lines, p) => {
    const geo = geoms[p];
    if (!geo) return;
    const height = geo.yMax - geo.yMin;
    if (height <= 0) return;
    const headerFrom = geo.yMax - height * PDF.HEADER_ZONE;
    const footerTo = geo.yMin + height * PDF.FOOTER_ZONE;

    for (const l of lines) {
      if (l.y < headerFrom && l.y > footerTo) continue;
      const key = repeatKey(l.text);
      if (!key) continue;
      const set = seenOnPages.get(key);
      if (set) set.add(p);
      else seenOnPages.set(key, new Set([p]));
    }
  });

  const need = pages.length * PDF.HEADER_REPEAT_RATIO;
  for (const [key, set] of seenOnPages) {
    if (set.size >= need) repeated.add(key);
  }
  return repeated;
}

export function stripRepeated(
  pages: PdfLine[][],
  geoms: PageGeometry[],
  repeated: Set<string>,
): { pages: PdfLine[][]; removed: string[] } {
  if (repeated.size === 0) return { pages, removed: [] };

  const removed = new Set<string>();
  const out = pages.map((lines, p) => {
    const geo = geoms[p];
    if (!geo) return lines;
    const height = geo.yMax - geo.yMin;
    const headerFrom = geo.yMax - height * PDF.HEADER_ZONE;
    const footerTo = geo.yMin + height * PDF.FOOTER_ZONE;

    return lines.filter((l) => {
      const inZone = l.y >= headerFrom || l.y <= footerTo;
      if (!inZone) return true;
      const key = repeatKey(l.text);
      if (repeated.has(key)) {
        removed.add(l.text.trim());
        return false;
      }
      return true;
    });
  });

  return { pages: out, removed: [...removed] };
}
