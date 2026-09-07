/**
 * §6.6 (1) — ToUnicode 오매핑으로 생기는 조용한 mojibake 탐지.
 *
 * 한국어 PDF 는 CID 폰트를 쓰는데 ToUnicode CMap 이 없거나 잘못되면
 * **추출이 실패하지 않고 그럴듯한 쓰레기 한글을 반환한다.** 예외가 안 나므로
 * 그대로 diff 로 흘러가 화면 전체가 빨개진다.
 *
 * 종성(받침) 분포는 정상 한국어에서 매우 치우쳐 있다. 무작위 CID 매핑은
 * 균등분포에 가까워지므로, 그 차이로 잡는다.
 */

const SYLLABLE_START = 0xac00;
const SYLLABLE_END = 0xd7a3;
const JAMO_START = 0x3131;
const JAMO_END = 0x318e;

function isSyllable(code: number): boolean {
  return code >= SYLLABLE_START && code <= SYLLABLE_END;
}

function isJamo(code: number): boolean {
  return code >= JAMO_START && code <= JAMO_END;
}

/** 한글 음절의 종성 인덱스. 0 = 받침 없음 */
export function jongseong(code: number): number {
  return (code - SYLLABLE_START) % 28;
}

export function entropy(counts: number[]): number {
  const total = counts.reduce((a, b) => a + b, 0);
  if (total === 0) return 0;
  let h = 0;
  for (const c of counts) {
    if (c === 0) continue;
    const p = c / total;
    h -= p * Math.log2(p);
  }
  return h;
}

export interface HangulSanity {
  garbled: boolean;
  /** 왜 그렇게 판정했는지. 경고 detail 에 넣어 디버깅을 돕는다. */
  reason?: string;
  syllables: number;
  noJongRatio: number;
  normalizedEntropy: number;
  jamoRatio: number;
}

export function analyzeHangul(text: string): HangulSanity {
  let syllables = 0;
  let noJong = 0;
  let jamo = 0;
  const counts = new Array<number>(28).fill(0);

  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (isSyllable(code)) {
      syllables++;
      const j = jongseong(code);
      counts[j]!++;
      if (j === 0) noJong++;
    } else if (isJamo(code)) {
      jamo++;
    }
  }

  const noJongRatio = syllables ? noJong / syllables : 0;
  const normalizedEntropy = syllables ? entropy(counts) / Math.log2(28) : 0;
  const jamoRatio = text.length ? jamo / text.length : 0;

  const base: HangulSanity = { garbled: false, syllables, noJongRatio, normalizedEntropy, jamoRatio };

  // 표본이 적거나 한국어 문서가 아니면 판정하지 않는다.
  if (syllables < 100) return base;
  if (text.length === 0 || syllables / text.length < 0.3) return base;

  if (noJongRatio < 0.15 || noJongRatio > 0.8) {
    return { ...base, garbled: true, reason: `받침 없는 음절 비율 ${(noJongRatio * 100).toFixed(0)}% (정상 40~55%)` };
  }
  if (normalizedEntropy > 0.92) {
    return { ...base, garbled: true, reason: `종성 분포가 균등에 가깝습니다 (정규화 엔트로피 ${normalizedEntropy.toFixed(2)})` };
  }
  if (jamoRatio > 0.05) {
    return { ...base, garbled: true, reason: `단독 자모 비율 ${(jamoRatio * 100).toFixed(1)}%` };
  }
  return base;
}

export function detectGarbledHangul(text: string): boolean {
  return analyzeHangul(text).garbled;
}
