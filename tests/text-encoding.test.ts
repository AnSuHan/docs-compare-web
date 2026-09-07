import { describe, expect, it } from 'vitest';
import { decodeBytes } from '../src/core/parsers/text';

/** '한글 문서' 를 각 인코딩 바이트로 직접 만든다. */
const UTF8 = new TextEncoder().encode('한글 문서');
const EUCKR = new Uint8Array([0xc7, 0xd1, 0xb1, 0xdb, 0x20, 0xb9, 0xae, 0xbc, 0xad]); // 한글 문서

function utf16le(s: string): Uint8Array {
  const u = new Uint8Array(s.length * 2);
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    u[i * 2] = c & 0xff;
    u[i * 2 + 1] = c >> 8;
  }
  return u;
}

describe('decodeBytes', () => {
  it('UTF-8 BOM 을 벗기고 읽는다', () => {
    const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...UTF8]);
    const r = decodeBytes(withBom);
    expect(r.text).toBe('한글 문서');
    expect(r.encoding).toBe('utf-8-bom');
    expect(r.guessed).toBe(false);
  });

  it('BOM 없는 UTF-8 을 추정 없이 읽는다', () => {
    const r = decodeBytes(UTF8);
    expect(r.text).toBe('한글 문서');
    expect(r.guessed).toBe(false);
  });

  it('CP949(EUC-KR) 를 알아본다 — 국내 텍스트 파일의 실제 문제', () => {
    const r = decodeBytes(EUCKR);
    expect(r.text).toBe('한글 문서');
    expect(r.encoding).toBe('euc-kr');
    expect(r.guessed).toBe(true); // ENCODING_GUESS 경고 + confidence 0.7
  });

  it('UTF-16LE BOM 을 읽는다', () => {
    const bytes = new Uint8Array([0xff, 0xfe, ...utf16le('한글')]);
    expect(decodeBytes(bytes).text).toBe('한글');
  });

  it('UTF-16BE BOM 을 읽는다', () => {
    const le = utf16le('한글');
    const be = new Uint8Array([0xfe, 0xff]);
    const swapped = new Uint8Array(le.length);
    for (let i = 0; i < le.length; i += 2) {
      swapped[i] = le[i + 1]!;
      swapped[i + 1] = le[i]!;
    }
    expect(decodeBytes(new Uint8Array([...be, ...swapped])).text).toBe('한글');
  });

  it('BOM 없는 UTF-16LE 도 NUL 패턴으로 알아본다', () => {
    const r = decodeBytes(utf16le('한글 문서입니다 여기까지 봅니다'));
    expect(r.text).toContain('한글');
    expect(r.encoding).toBe('utf-16le');
  });

  it('빈 파일에서 죽지 않는다', () => {
    expect(decodeBytes(new Uint8Array(0)).text).toBe('');
  });

  it('ASCII 는 UTF-8 로 확정한다', () => {
    const r = decodeBytes(new TextEncoder().encode('hello world'));
    expect(r.text).toBe('hello world');
    expect(r.guessed).toBe(false);
  });
});
