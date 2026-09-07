import { PDF } from './constants';

/**
 * §6.5 단계 0 — 아이템 정규화.
 *
 * pdf.js 의 TextItem 은 transform 행렬을 그대로 준다. 우리가 쓰는 형태로 바꾸고,
 * 회전각을 유도한다.
 *
 * 이 파일은 pdfjs 를 import 하지 않는다. 입력 모양만 맞으면 되므로 Node 에서
 * 그대로 테스트할 수 있다(§11: core 는 DOM·라이브러리에 묶이지 않는다).
 */

export interface RawTextItem {
  str: string;
  transform: number[];
  width: number;
  height: number;
  fontName?: string;
  hasEOL?: boolean;
}

export interface PdfItem {
  str: string;
  /** transform[4] */
  x: number;
  /** transform[5]. PDF 좌표계라 위로 갈수록 크다. */
  y: number;
  width: number;
  height: number;
  fontName: string;
  /** 도(degree). 0 이 아니면 눕힌 텍스트다. */
  rotation: number;
}

export function toItem(raw: RawTextItem): PdfItem {
  const [a = 1, b = 0, , , e = 0, f = 0] = raw.transform;
  const scale = Math.hypot(a, b) || 1;
  return {
    str: raw.str,
    x: e,
    y: f,
    width: raw.width,
    // height 가 0 으로 오는 뷰어가 있어 행렬 스케일로 보완한다.
    height: raw.height > 0 ? raw.height : scale,
    fontName: raw.fontName ?? '',
    rotation: Math.round((Math.atan2(b, a) * 180) / Math.PI),
  };
}

/**
 * §6.5 단계 5 — 중복 제거.
 * 볼드·그림자 효과를 내려고 같은 글자를 1pt 어긋나게 두 번 그리는 PDF 가 있다.
 * 그대로 두면 모든 글자가 두 번씩 나온다.
 */
export function dedupeItems(items: PdfItem[]): PdfItem[] {
  const out: PdfItem[] = [];
  // 좌표를 eps 격자로 버킷팅해 O(n) 에 가깝게 처리한다.
  const seen = new Map<string, PdfItem[]>();
  const eps = PDF.DUP_COORD_EPS;

  for (const it of items) {
    if (!it.str) continue;
    const bx = Math.round(it.x / eps);
    const by = Math.round(it.y / eps);
    let dup = false;

    for (let dx = -1; dx <= 1 && !dup; dx++) {
      for (let dy = -1; dy <= 1 && !dup; dy++) {
        const bucket = seen.get(`${bx + dx},${by + dy}`);
        if (!bucket) continue;
        for (const p of bucket) {
          if (p.str === it.str && Math.abs(p.x - it.x) <= eps && Math.abs(p.y - it.y) <= eps) {
            dup = true;
            break;
          }
        }
      }
    }
    if (dup) continue;

    const key = `${bx},${by}`;
    const bucket = seen.get(key);
    if (bucket) bucket.push(it);
    else seen.set(key, [it]);
    out.push(it);
  }
  return out;
}

/** 회전각별로 나눈다. 0도는 본문, 나머지는 눕힌 표 머리글·사이드 탭이다(§6.5 단계 0). */
export function splitByRotation(items: PdfItem[]): { upright: PdfItem[]; rotated: Map<number, PdfItem[]> } {
  const upright: PdfItem[] = [];
  const rotated = new Map<number, PdfItem[]>();

  for (const it of items) {
    // 반올림 오차로 ±1도가 섞이므로 여유를 둔다.
    if (Math.abs(it.rotation) <= 1) {
      upright.push(it);
      continue;
    }
    const bucket = rotated.get(it.rotation);
    if (bucket) bucket.push(it);
    else rotated.set(it.rotation, [it]);
  }
  return { upright, rotated };
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}
