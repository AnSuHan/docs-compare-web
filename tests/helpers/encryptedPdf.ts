import { createHash } from 'node:crypto';

/**
 * 암호가 걸린 PDF 를 만든다 (T-040 회귀 테스트용).
 *
 * 바이너리 픽스처를 저장소에 넣지 않으려고 직접 만든다. 표준 보안 핸들러의
 * 가장 단순한 형태(V=1 / R=2 / 40비트 RC4, PDF 1.4 §3.5.2)만 구현한다.
 * RC4 는 OpenSSL 3 에서 기본 제공되지 않아 여기서 직접 돌린다 —
 * 20줄이고, 테스트 입력을 만드는 데만 쓴다.
 */

/** PDF 1.4 §3.5.2 의 32바이트 패딩 상수. */
const PAD = Buffer.from([
  0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41, 0x64, 0x00, 0x4e, 0x56, 0xff, 0xfa, 0x01, 0x08,
  0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e, 0x80, 0x2f, 0x0c, 0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a,
]);

const ID0 = Buffer.from('0123456789abcdef', 'latin1');
const PERMISSIONS = -1;

function pad32(password: string): Buffer {
  const pw = Buffer.from(password, 'latin1').subarray(0, 32);
  return Buffer.concat([pw, PAD], 32);
}

function md5(...parts: Buffer[]): Buffer {
  const h = createHash('md5');
  for (const p of parts) h.update(p);
  return h.digest();
}

function rc4(key: Buffer, data: Buffer): Buffer {
  const s = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 0, j = 0; i < 256; i++) {
    j = (j + s[i]! + key[i % key.length]!) & 0xff;
    [s[i], s[j]] = [s[j]!, s[i]!];
  }
  const out = Buffer.alloc(data.length);
  for (let n = 0, i = 0, j = 0; n < data.length; n++) {
    i = (i + 1) & 0xff;
    j = (j + s[i]!) & 0xff;
    [s[i], s[j]] = [s[j]!, s[i]!];
    out[n] = data[n]! ^ s[(s[i]! + s[j]!) & 0xff]!;
  }
  return out;
}

function int32le(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeInt32LE(n);
  return b;
}

/** 개체마다 키가 다르다. §3.5.1 알고리즘 1. */
function objectKey(key: Buffer, objNum: number): Buffer {
  const num = Buffer.from([objNum & 0xff, (objNum >> 8) & 0xff, (objNum >> 16) & 0xff]);
  const gen = Buffer.from([0, 0]);
  return md5(key, num, gen).subarray(0, Math.min(key.length + 5, 16));
}

const hex = (b: Buffer) => `<${b.toString('hex')}>`;

/**
 * 본문 몇 줄이 들어 있는 1쪽짜리 암호 PDF 를 만든다.
 * 소유자 비밀번호는 사용자 비밀번호와 같게 둔다 — 여는 쪽만 시험하면 된다.
 */
export function makeEncryptedPdf(userPassword: string, lines: string[]): Uint8Array {
  // O: 소유자 비밀번호로 사용자 비밀번호를 감싼다 (§3.5.2 알고리즘 3).
  const o = rc4(md5(pad32(userPassword)).subarray(0, 5), pad32(userPassword));
  // 암호화 키 (알고리즘 2).
  const key = md5(pad32(userPassword), o, int32le(PERMISSIONS), ID0).subarray(0, 5);
  // U: 패딩 상수를 그 키로 감싼 것 (알고리즘 4).
  const u = rc4(key, PAD);

  let y = 720;
  const content = lines.map((t) => `BT /F1 12 Tf 72 ${(y -= 20)} Td (${t}) Tj ET`).join('\n');
  const encrypted = rc4(objectKey(key, 4), Buffer.from(content, 'latin1'));

  const objs: Record<number, string> = {
    1: '<< /Type /Catalog /Pages 2 0 R >>',
    2: '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    3: '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    4: `<< /Length ${encrypted.length} >>\nstream\n${encrypted.toString('latin1')}\nendstream`,
    5: '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    // 암호 사전 자체는 암호화하지 않는다.
    6: `<< /Filter /Standard /V 1 /R 2 /O ${hex(o)} /U ${hex(u)} /P ${PERMISSIONS} >>`,
  };

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (let i = 1; i <= 6; i++) {
    offsets[i] = Buffer.byteLength(pdf, 'latin1');
    pdf += `${i} 0 obj\n${objs[i]}\nendobj\n`;
  }
  const xrefAt = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 7\n0000000000 65535 f \n`;
  for (let i = 1; i <= 6; i++) pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size 7 /Root 1 0 R /Encrypt 6 0 R /ID [${hex(ID0)} ${hex(ID0)}] >>\n`;
  pdf += `startxref\n${xrefAt}\n%%EOF\n`;

  return new Uint8Array(Buffer.from(pdf, 'latin1'));
}
