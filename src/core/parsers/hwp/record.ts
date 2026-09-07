/**
 * T-053 초안 — HWP 레코드 구조.
 *
 *   레코드 헤더 = UInt32 LE
 *     bits  0~9   tagId (10bit)
 *     bits 10~19  level (10bit)
 *     bits 20~31  size  (12bit)
 *   size 가 0xFFF 이면 뒤따르는 UInt32 LE 가 실제 크기다.
 */
export const HWPTAG_BEGIN = 0x10;

export const TAG = {
  PARA_HEADER: HWPTAG_BEGIN + 50, // 66
  PARA_TEXT: HWPTAG_BEGIN + 51, // 67
  PARA_CHAR_SHAPE: HWPTAG_BEGIN + 52, // 68
  CTRL_HEADER: HWPTAG_BEGIN + 55, // 71
  LIST_HEADER: HWPTAG_BEGIN + 56, // 72
  TABLE: HWPTAG_BEGIN + 61, // 77
} as const;

export interface HwpRecord {
  tagId: number;
  level: number;
  payload: DataView;
}

export function* readRecords(buf: Uint8Array): Generator<HwpRecord> {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let p = 0;

  while (p + 4 <= buf.byteLength) {
    const header = dv.getUint32(p, true);
    p += 4;

    const tagId = header & 0x3ff;
    const level = (header >>> 10) & 0x3ff;
    let size = (header >>> 20) & 0xfff;

    if (size === 0xfff) {
      if (p + 4 > buf.byteLength) break;
      size = dv.getUint32(p, true);
      p += 4;
    }

    // 손상 파일 방어: 남은 바이트보다 큰 크기를 만나면 조용히 멈춘다.
    if (size < 0 || p + size > buf.byteLength) break;

    yield { tagId, level, payload: new DataView(buf.buffer, buf.byteOffset + p, size) };
    p += size;
  }
}
