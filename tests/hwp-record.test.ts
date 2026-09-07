import { describe, expect, it } from 'vitest';
import { readRecords, TAG } from '../src/core/parsers/hwp/record';
import { decodeParaText } from '../src/core/parsers/hwp/paraText';

/** 레코드 하나를 손으로 만든다. */
function record(tagId: number, level: number, payload: Uint8Array): Uint8Array {
  const big = payload.byteLength >= 0xfff;
  const size = big ? 0xfff : payload.byteLength;
  const head = (tagId & 0x3ff) | ((level & 0x3ff) << 10) | ((size & 0xfff) << 20);

  const extra = big ? 4 : 0;
  const out = new Uint8Array(4 + extra + payload.byteLength);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, head >>> 0, true);
  if (big) dv.setUint32(4, payload.byteLength, true);
  out.set(payload, 4 + extra);
  return out;
}

function utf16(s: string): Uint8Array {
  const out = new Uint8Array(s.length * 2);
  const dv = new DataView(out.buffer);
  for (let i = 0; i < s.length; i++) dv.setUint16(i * 2, s.charCodeAt(i), true);
  return out;
}

describe('readRecords (T-053)', () => {
  it('태그·레벨·크기를 비트필드에서 정확히 뽑는다', () => {
    const buf = record(TAG.PARA_TEXT, 3, utf16('가나다'));
    const [r] = [...readRecords(buf)];
    expect(r!.tagId).toBe(TAG.PARA_TEXT);
    expect(r!.level).toBe(3);
    expect(r!.payload.byteLength).toBe(6);
  });

  it('4095바이트 이상이면 확장 크기 필드를 읽는다', () => {
    const payload = utf16('가'.repeat(3000)); // 6000 bytes
    const [r] = [...readRecords(record(TAG.PARA_TEXT, 0, payload))];
    expect(r!.payload.byteLength).toBe(6000);
  });

  it('잘린 파일을 만나면 조용히 멈춘다', () => {
    const full = record(TAG.PARA_TEXT, 0, utf16('가나다라'));
    const truncated = full.slice(0, full.length - 3);
    expect([...readRecords(truncated)]).toHaveLength(0);
  });
});

describe('decodeParaText (T-054)', () => {
  const dv = (u8: Uint8Array) => new DataView(u8.buffer, u8.byteOffset, u8.byteLength);

  it('일반 문자를 그대로 읽는다', () => {
    expect(decodeParaText(dv(utf16('계약서'))).text).toBe('계약서');
  });

  it('확장 컨트롤은 8 WCHAR 를 건너뛴다 — 안 하면 본문이 오염된다', () => {
    // 코드 2(구역 정의)는 확장 컨트롤: 자신 + 6워드 + 자신 = 8 WCHAR
    const seq = String.fromCharCode(2) + '\u0000'.repeat(6) + String.fromCharCode(2) + '본문';
    const r = decodeParaText(dv(utf16(seq)));
    expect(r.text).toBe('본문');
    expect(r.controls).toBe(1);
    expect(r.unknown).toBe(0);
  });

  it('문단 끝(13)과 줄바꿈(10)은 개행으로', () => {
    const seq = '가' + String.fromCharCode(10) + '나' + String.fromCharCode(13);
    expect(decodeParaText(dv(utf16(seq))).text).toBe('가\n나\n');
  });

  it('추출 결과에 제어문자가 남지 않는다 (§7.8 검수 4번)', () => {
    const seq = String.fromCharCode(3) + '\u0000'.repeat(6) + String.fromCharCode(3) + '조항';
    const { text } = decodeParaText(dv(utf16(seq)));
    // eslint-disable-next-line no-control-regex
    expect(text.match(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g)).toBeNull();
  });
});
