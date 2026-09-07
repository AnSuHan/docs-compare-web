/**
 * T-052 초안 — HWP 5.0 FileHeader.
 * 스파이크 단계에서 먼저 쓰이지만 그대로 M4 로 승격된다.
 */
export const HWP_SIGNATURE = 'HWP Document File';

export interface HwpFileHeader {
  version: { major: number; minor: number; build: number; revision: number };
  compressed: boolean;
  passwordProtected: boolean;
  distributionDoc: boolean;
}

export function readFileHeader(fh: Uint8Array): HwpFileHeader {
  if (fh.byteLength < 40) throw new Error('FileHeader too short');

  const sig = new TextDecoder('ascii').decode(fh.subarray(0, HWP_SIGNATURE.length));
  if (sig !== HWP_SIGNATURE) throw new Error('not a HWP 5.0 file');

  const dv = new DataView(fh.buffer, fh.byteOffset, fh.byteLength);
  const ver = dv.getUint32(32, true);
  const props = dv.getUint32(36, true);

  return {
    version: {
      major: (ver >>> 24) & 0xff,
      minor: (ver >>> 16) & 0xff,
      build: (ver >>> 8) & 0xff,
      revision: ver & 0xff,
    },
    compressed: (props & 0x01) !== 0,
    passwordProtected: (props & 0x02) !== 0,
    distributionDoc: (props & 0x04) !== 0,
  };
}
