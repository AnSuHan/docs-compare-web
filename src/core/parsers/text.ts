import type { NormalizedDoc, ParseCtx, ParseWarning } from '../types';
import type { Parser } from './index';
import { buildDoc, finishBlocks, splitParagraphs, warn } from './common';

/**
 * §8.1 — TXT 는 인코딩이 전부다.
 *
 * 기획서는 jschardet 를 쓰지만 그건 Node 의 Buffer 를 요구한다. 파서는 워커
 * 안에서 돌고 워커에는 Buffer 가 없다. 그래서 직접 판정한다.
 *   1. BOM 이 있으면 그대로 믿는다 (가장 확실)
 *   2. NUL 패턴이 뚜렷하면 BOM 없는 UTF-16 (ASCII 위주 본문)
 *   3. UTF-8 로 엄격 디코딩해서 통과하면 UTF-8
 *   4. 남은 후보를 전부 디코딩해 보고 "가장 말이 되는" 것을 고른다
 *
 * 4번이 필요한 이유: 한국어를 BOM 없이 UTF-16 으로 저장하면 NUL 이 거의 없어서
 * 바이트 패턴만으로는 CP949 와 구분되지 않는다. 실제로 읽어 보는 수밖에 없다.
 */

export type DetectedEncoding = 'utf-8' | 'utf-8-bom' | 'utf-16le' | 'utf-16be' | 'euc-kr' | 'windows-1252';

export interface DecodeResult {
  text: string;
  encoding: DetectedEncoding;
  /** 추정으로 정한 경우 true → ENCODING_GUESS 경고 + confidence 0.7 */
  guessed: boolean;
}

function decodeWith(u8: Uint8Array, label: string, fatal = false): string | null {
  try {
    return new TextDecoder(label, { fatal }).decode(u8);
  } catch {
    return null;
  }
}

/** BOM 없는 UTF-16 은 NUL 이 한 칸 걸러 나온다 — 본문이 ASCII 위주일 때만. */
function nulPattern(u8: Uint8Array): 'utf-16le' | 'utf-16be' | null {
  const n = Math.min(u8.length, 4096);
  if (n < 4) return null;

  let evenNul = 0;
  let oddNul = 0;
  for (let i = 0; i < n; i++) {
    if (u8[i] === 0) {
      if (i % 2 === 0) evenNul++;
      else oddNul++;
    }
  }

  const half = n / 2;
  if (oddNul > half * 0.3 && evenNul < half * 0.05) return 'utf-16le';
  if (evenNul > half * 0.3 && oddNul < half * 0.05) return 'utf-16be';
  return null;
}

/**
 * 디코딩 결과가 "사람이 읽는 글"처럼 보이는 정도.
 * 인코딩을 잘못 고르면 제어문자와 U+FFFD 가 쏟아지므로 그걸 세게 깎는다.
 */
export function plausibility(s: string): number {
  if (!s.length) return -Infinity;

  let good = 0;
  let bad = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 0xfffd) bad++;
    else if (c < 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d) bad++;
    else if (c >= 0xac00 && c <= 0xd7a3) good += 2; // 한글 음절
    else if (c >= 0x3131 && c <= 0x318e) good += 1; // 낱자
    else if (c >= 0x4e00 && c <= 0x9fff) good += 1; // 한자
    else if (c >= 0x20 && c < 0x7f) good += 1; // ASCII 인쇄 가능
    else if (c === 0x0a || c === 0x09) good += 1;
    // 서로게이트가 짝 없이 남으면 잘못 읽은 것이다
    else if (c >= 0xd800 && c <= 0xdfff) bad++;
  }
  return (good - bad * 6) / s.length;
}

interface Candidate {
  encoding: DetectedEncoding;
  text: string;
  score: number;
}

function candidate(u8: Uint8Array, encoding: DetectedEncoding, label: string): Candidate | null {
  const text = decodeWith(u8, label);
  if (text === null) return null;
  return { encoding, text, score: plausibility(text) };
}

export function decodeBytes(buf: ArrayBuffer | Uint8Array): DecodeResult {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  if (u8.length === 0) return { text: '', encoding: 'utf-8', guessed: false };

  // 1. BOM
  if (u8.length >= 3 && u8[0] === 0xef && u8[1] === 0xbb && u8[2] === 0xbf) {
    return { text: decodeWith(u8.subarray(3), 'utf-8') ?? '', encoding: 'utf-8-bom', guessed: false };
  }
  if (u8.length >= 2 && u8[0] === 0xff && u8[1] === 0xfe) {
    return { text: decodeWith(u8.subarray(2), 'utf-16le') ?? '', encoding: 'utf-16le', guessed: false };
  }
  if (u8.length >= 2 && u8[0] === 0xfe && u8[1] === 0xff) {
    return { text: decodeWith(u8.subarray(2), 'utf-16be') ?? '', encoding: 'utf-16be', guessed: false };
  }

  // 2. NUL 패턴
  const byNul = nulPattern(u8);
  if (byNul) {
    const text = decodeWith(u8, byNul);
    if (text !== null) return { text, encoding: byNul, guessed: true };
  }

  // 3. UTF-8 엄격 검사
  const strict = decodeWith(u8, 'utf-8', true);
  if (strict !== null) return { text: strict, encoding: 'utf-8', guessed: false };

  // 4. 남은 후보를 실제로 읽어 보고 가장 말이 되는 것을 고른다.
  const candidates = [
    candidate(u8, 'euc-kr', 'euc-kr'),
    candidate(u8, 'utf-16le', 'utf-16le'),
    candidate(u8, 'utf-16be', 'utf-16be'),
    candidate(u8, 'windows-1252', 'windows-1252'),
  ].filter((c): c is Candidate => c !== null);

  if (candidates.length === 0) return { text: '', encoding: 'utf-8', guessed: true };

  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0]!;
  return { text: best.text, encoding: best.encoding, guessed: true };
}

export function encodingWarnings(r: DecodeResult): ParseWarning[] {
  if (!r.guessed) return [];
  return [
    warn(
      'ENCODING_GUESS',
      'warn',
      `문자 인코딩이 파일에 적혀 있지 않아 ${r.encoding} 로 추정해 읽었습니다. 글자가 깨져 보이면 UTF-8 로 저장한 뒤 다시 올려주세요.`,
      `encoding=${r.encoding}`,
    ),
  ];
}

export const textParser: Parser = {
  async parse(buf: ArrayBuffer, fileName: string, ctx: ParseCtx): Promise<NormalizedDoc> {
    ctx.progress({ phase: 'parsing', current: 0, total: 1 });

    const decoded = decodeBytes(buf);
    const blocks = finishBlocks(splitParagraphs(decoded.text), ctx.options);

    ctx.progress({ phase: 'parsing', current: 1, total: 1 });

    return buildDoc({
      format: 'txt',
      fileName,
      fileSize: buf.byteLength,
      parserVersion: 'txt@1',
      blocks,
      warnings: encodingWarnings(decoded),
      confidence: decoded.guessed ? 0.7 : 1.0,
    });
  },
};
