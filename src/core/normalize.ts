import type { FormatGroup, NormalizeOptions } from './types';

export const DEFAULT_NORMALIZE: Record<FormatGroup, NormalizeOptions> = {
  text: { ignoreWhitespace: true, normalizePunct: false, ignoreCase: false, foldWidth: false, joinHyphen: false },
  docx: { ignoreWhitespace: true, normalizePunct: true, ignoreCase: false, foldWidth: true, joinHyphen: false },
  hwp: { ignoreWhitespace: true, normalizePunct: true, ignoreCase: false, foldWidth: true, joinHyphen: false },
  pdf: { ignoreWhitespace: true, normalizePunct: true, ignoreCase: false, foldWidth: true, joinHyphen: true },
};

/** 제로폭 문자와 소프트 하이픈. 눈에 안 보이면서 diff 를 깨뜨린다. */
const ZERO_WIDTH = /[\u200B-\u200D\uFEFF\u00AD]/g;

const PUNCT_RULES: ReadonlyArray<readonly [RegExp, string]> = [
  [/[\u2018\u2019\u201A\u201B\u2032]/g, "'"],
  [/[\u201C\u201D\u201E\u201F\u2033]/g, '"'],
  [/[\u2010-\u2015\u2212]/g, '-'],
  [/\u2026/g, '...'],
];

/** 전각 영숫자·기호를 반각으로. 전각 공백은 whitespace 단계에서 따로 처리한다. */
export function foldFullWidth(s: string): string {
  return s.replace(/[\uFF01-\uFF5E]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
}

/**
 * 순서가 고정이다. 특히 NFC 는 옵션이 아니라 항상 먼저 적용한다.
 * macOS 와 PDF 에서 한글이 NFD(자모 분해)로 들어오는 경우가 흔하고,
 * 이걸 놓치면 눈에 똑같아 보이는 두 문자열이 다르게 판정된다.
 */
export function normalizeText(raw: string, o: NormalizeOptions): string {
  let s = raw.normalize('NFC');
  s = s.replace(ZERO_WIDTH, '');
  s = s.replace(/\r\n?/g, '\n');

  if (o.foldWidth) s = foldFullWidth(s);
  if (o.joinHyphen) s = s.replace(/([A-Za-z])-\n([a-z])/g, '$1$2');
  if (o.normalizePunct) for (const [re, to] of PUNCT_RULES) s = s.replace(re, to);
  if (o.ignoreWhitespace) s = s.replace(/[ \t\u00A0\u3000]+/g, ' ');

  s = s.split('\n').map((l) => l.trim()).join('\n').trim();
  if (o.ignoreCase) s = s.toLowerCase();
  return s;
}
