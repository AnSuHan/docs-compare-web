import type { Format, FormatGroup } from './types';
import { AppError } from './errors';

export const SUPPORTED_EXTS = ['txt', 'md', 'markdown', 'docx', 'pdf', 'hwp', 'hwpx'] as const;

const EXT_TO_FORMAT: Record<string, Format> = {
  txt: 'txt',
  md: 'md',
  markdown: 'md',
  docx: 'docx',
  pdf: 'pdf',
  hwp: 'hwp',
  hwpx: 'hwpx',
};

export const FORMAT_TO_GROUP: Record<Format, FormatGroup> = {
  txt: 'text',
  md: 'text',
  docx: 'docx',
  pdf: 'pdf',
  hwp: 'hwp',
  hwpx: 'hwp',
};

export function extOf(fileName: string): string {
  const i = fileName.lastIndexOf('.');
  return i < 0 ? '' : fileName.slice(i + 1).toLowerCase();
}

export function formatFromExt(fileName: string): Format | null {
  return EXT_TO_FORMAT[extOf(fileName)] ?? null;
}

export function groupOf(fileName: string): FormatGroup {
  const f = formatFromExt(fileName);
  if (!f) throw new AppError('UNSUPPORTED_FORMAT', fileName);
  return FORMAT_TO_GROUP[f];
}

// ------------------------------------------------------------------ 매직 넘버

function startsWith(u8: Uint8Array, sig: readonly number[]): boolean {
  if (u8.length < sig.length) return false;
  for (let i = 0; i < sig.length; i++) if (u8[i] !== sig[i]) return false;
  return true;
}

const SIG = {
  PDF: [0x25, 0x50, 0x44, 0x46], // %PDF
  CFB: [0xd0, 0xcf, 0x11, 0xe0], // OLE2 복합문서: .hwp, .doc, .xls 공통
  ZIP: [0x50, 0x4b, 0x03, 0x04], // .docx, .hwpx, .xlsx 공통
} as const;

export type Sniffed =
  | { kind: 'pdf' }
  | { kind: 'cfb' }   // FileHeader 스트림을 열어야 hwp 인지 확정된다
  | { kind: 'zip' }   // 엔트리 목록을 봐야 docx 인지 hwpx 인지 확정된다
  | { kind: 'text' }
  | { kind: 'binary' };

/** 확장자를 믿지 않는다. 바이트를 먼저 본다. */
export function sniff(u8: Uint8Array): Sniffed {
  if (startsWith(u8, SIG.PDF)) return { kind: 'pdf' };
  if (startsWith(u8, SIG.CFB)) return { kind: 'cfb' };
  if (startsWith(u8, SIG.ZIP)) return { kind: 'zip' };
  return isProbablyText(u8) ? { kind: 'text' } : { kind: 'binary' };
}

/** 앞부분에 NUL 이 섞여 있으면 텍스트가 아니다 (UTF-16 BOM 은 예외). */
export function isProbablyText(u8: Uint8Array, sample = 4096): boolean {
  if (u8.length >= 2 && ((u8[0] === 0xff && u8[1] === 0xfe) || (u8[0] === 0xfe && u8[1] === 0xff))) return true;
  const n = Math.min(u8.length, sample);
  let nul = 0;
  for (let i = 0; i < n; i++) if (u8[i] === 0) nul++;
  return nul / Math.max(n, 1) < 0.01;
}

/**
 * 확장자와 실제 바이트를 대조한다.
 * 불일치하면 실제 내용을 따르되 호출자가 사용자에게 알릴 수 있도록 mismatch 를 돌려준다.
 */
export function resolveFormat(fileName: string, u8: Uint8Array): { format: Format; mismatch: boolean } {
  const declared = formatFromExt(fileName);
  if (!declared) throw new AppError('UNSUPPORTED_FORMAT', fileName);

  const s = sniff(u8);
  const actual: Format | null =
    s.kind === 'pdf' ? 'pdf'
    : s.kind === 'cfb' ? 'hwp'
    : s.kind === 'zip' ? (declared === 'hwpx' ? 'hwpx' : 'docx')
    : s.kind === 'text' ? (declared === 'md' ? 'md' : 'txt')
    : null;

  if (!actual) throw new AppError('UNSUPPORTED_FORMAT', 'unrecognized binary');
  return { format: actual, mismatch: actual !== declared };
}
