import type { BlockType } from '../../types';
import { BULLET_START, PDF, SENTENCE_END } from './constants';
import { median } from './items';
import type { PdfLine } from './lineGrouping';

/**
 * §6.5 단계 4 — 문단 병합.
 *
 * 앞 라인과 현재 라인을 잇는 조건을 **모두** 만족할 때만 잇는다.
 * 보수적으로 끊는다 — 잘못 이어붙이는 것이 잘못 끊는 것보다 diff 품질을
 * 더 크게 해친다(기획서 명시).
 */

export interface PdfBlockDraft {
  type: BlockType;
  level?: number;
  text: string;
  /** 이 블록을 만든 첫 라인의 y. 페이지 이음 판단에 쓴다. */
  y: number;
  page: number;
  /** 라인 안에 큰 공백이 3개 이상 있었는가 (괘선 없는 표 의심) */
  tableLike: boolean;
}

/** 라인들을 문단/제목 블록으로 묶는다. lines 는 읽기 순서로 정렬돼 있어야 한다. */
export function mergeLines(lines: PdfLine[], page: number): PdfBlockDraft[] {
  if (lines.length === 0) return [];

  const gaps: number[] = [];
  for (let i = 1; i < lines.length; i++) gaps.push(Math.abs(lines[i - 1]!.y - lines[i]!.y));
  const medianGap = median(gaps) || median(lines.map((l) => l.height)) * 1.2 || 1;
  const bodyRight = Math.max(...lines.map((l) => l.x1));
  const bodyFont = median(lines.map((l) => l.height)) || 1;
  const avgLen = lines.reduce((s, l) => s + l.text.trim().length, 0) / lines.length;

  const out: PdfBlockDraft[] = [];
  let acc: { parts: string[]; y: number; tableLike: boolean; last: PdfLine } | null = null;

  const flush = () => {
    if (!acc) return;
    const text = acc.parts.join(' ').replace(/\s+/g, ' ').trim();
    if (text) out.push({ type: 'paragraph', text, y: acc.y, page, tableLike: acc.tableLike });
    acc = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const text = line.text.trim();
    if (!text) continue;

    const next = lines[i + 1];
    const gapAfter = next ? Math.abs(line.y - next.y) : Infinity;

    // heading 승격: 짧고, 폰트가 크고, 다음 줄과 간격이 벌어져 있다.
    // 간격은 >= 로 본다 — 줄이 두어 개뿐인 표지·간지에서는 그 간격이 곧
    // 중앙값이라 > 로 두면 제목이 하나도 안 잡힌다.
    const isHeading =
      text.length < avgLen * PDF.HEADING_SHORT_RATIO &&
      line.height > bodyFont * PDF.HEADING_FONT_RATIO &&
      gapAfter >= medianGap;

    if (isHeading) {
      flush();
      out.push({
        type: 'heading',
        level: headingLevel(line.height, bodyFont),
        text,
        y: line.y,
        page,
        tableLike: line.wideGaps >= 3,
      });
      continue;
    }

    if (acc && canJoin(acc.last, line, medianGap, bodyRight)) {
      acc.parts.push(text);
      acc.tableLike = acc.tableLike || line.wideGaps >= 3;
      acc.last = line;
      continue;
    }

    flush();
    acc = { parts: [text], y: line.y, tableLike: line.wideGaps >= 3, last: line };
  }
  flush();

  return out;
}

function canJoin(prev: PdfLine, cur: PdfLine, medianGap: number, bodyRight: number): boolean {
  const gap = Math.abs(prev.y - cur.y);
  if (gap > medianGap * PDF.PARA_GAP_RATIO) return false;

  const prevText = prev.text.trim();
  if (SENTENCE_END.test(prevText)) return false;
  if (BULLET_START.test(cur.text)) return false;

  // 앞 라인이 우측 경계까지 갔어야 "자연 줄바꿈"이다. 중간에서 끝났으면
  // 사용자가 일부러 끊은 줄이다.
  if (bodyRight > 0 && prev.x1 < bodyRight * PDF.LINE_FULL_RATIO) return false;

  if (prev.fontName !== cur.fontName) return false;
  if (Math.abs(prev.height - cur.height) > Math.max(prev.height, cur.height) * 0.15) return false;

  return true;
}

function headingLevel(size: number, bodyFont: number): number {
  const ratio = size / (bodyFont || 1);
  if (ratio >= 1.8) return 1;
  if (ratio >= 1.4) return 2;
  return 3;
}
