import { describe, expect, it } from 'vitest';
import { resolveFormat, sniff } from '../src/core/detect';

const bytes = (...n: number[]) => new Uint8Array([...n, ...new Array(64).fill(0x41)]);

describe('sniff (매직 넘버 우선)', () => {
  it('%PDF 를 pdf 로 본다', () => {
    expect(sniff(bytes(0x25, 0x50, 0x44, 0x46)).kind).toBe('pdf');
  });

  it('OLE2 시그니처를 cfb 로 본다', () => {
    expect(sniff(bytes(0xd0, 0xcf, 0x11, 0xe0)).kind).toBe('cfb');
  });

  it('ZIP 시그니처를 zip 으로 본다', () => {
    expect(sniff(bytes(0x50, 0x4b, 0x03, 0x04)).kind).toBe('zip');
  });

  it('평범한 바이트는 text', () => {
    expect(sniff(new TextEncoder().encode('안녕하세요 계약서')).kind).toBe('text');
  });
});

describe('resolveFormat', () => {
  it('확장자와 내용이 맞으면 mismatch 없음', () => {
    const r = resolveFormat('a.pdf', bytes(0x25, 0x50, 0x44, 0x46));
    expect(r).toEqual({ format: 'pdf', mismatch: false });
  });

  it('확장자가 거짓이면 실제 내용을 따르고 mismatch 를 알린다', () => {
    const r = resolveFormat('a.docx', bytes(0x25, 0x50, 0x44, 0x46));
    expect(r).toEqual({ format: 'pdf', mismatch: true });
  });

  it('지원하지 않는 확장자는 던진다', () => {
    expect(() => resolveFormat('a.hwp3', bytes(0x00))).toThrow();
  });
});
