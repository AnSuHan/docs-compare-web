import * as CFB from 'cfb';
import pako from 'pako';
import { readFileHeader } from '@/core/parsers/hwp/fileHeader';
import { readRecords, TAG } from '@/core/parsers/hwp/record';
import { decodeParaText } from '@/core/parsers/hwp/paraText';

export interface HwpProbeResult {
  fileName: string;
  ok: boolean;
  reason?: string;
  version?: string;
  compressed?: boolean;
  distributionDoc?: boolean;
  sections?: number;
  paragraphs?: number;
  chars?: number;
  /** 제어문자 잔여 개수. §7.8 검수 4번: 0 이어야 한다. */
  residualControlChars?: number;
  unknownCodes?: number;
  sample?: string;
  ms?: number;
}

function findStream(cfb: CFB.CFB$Container, name: string): Uint8Array | undefined {
  const entry = CFB.find(cfb, name);
  const content = entry?.content as unknown;
  if (!content) return undefined;
  return content instanceof Uint8Array ? content : new Uint8Array(content as ArrayLike<number>);
}

function listSections(cfb: CFB.CFB$Container): Uint8Array[] {
  const out: Uint8Array[] = [];
  for (let i = 0; ; i++) {
    const s = findStream(cfb, `/BodyText/Section${i}`) ?? findStream(cfb, `BodyText/Section${i}`);
    if (!s) break;
    out.push(s);
  }
  return out;
}

/** U-03 측정기. 성공률과 실패 사유를 숫자로 뽑는 것이 목적이다. */
export async function probeHwp(file: File): Promise<HwpProbeResult> {
  const t0 = performance.now();
  const base: HwpProbeResult = { fileName: file.name, ok: false };

  try {
    const buf = new Uint8Array(await file.arrayBuffer());
    const cfb = CFB.read(buf, { type: 'array' });

    const fhStream = findStream(cfb, '/FileHeader') ?? findStream(cfb, 'FileHeader');
    if (!fhStream) return { ...base, reason: 'FileHeader 스트림 없음 (HWP 5.0 아님)' };

    const fh = readFileHeader(fhStream);
    const v = `${fh.version.major}.${fh.version.minor}.${fh.version.build}.${fh.version.revision}`;

    if (fh.passwordProtected) return { ...base, version: v, reason: '암호 설정 문서' };
    if (fh.distributionDoc) return { ...base, version: v, distributionDoc: true, reason: '배포용(열람 제한) 문서' };

    const sections = listSections(cfb);
    if (sections.length === 0) return { ...base, version: v, reason: 'BodyText/Section 스트림 없음' };

    let paragraphs = 0;
    let chars = 0;
    let unknown = 0;
    let residual = 0;
    const sampleParts: string[] = [];

    for (const raw of sections) {
      const data = fh.compressed ? pako.inflateRaw(raw) : raw;
      for (const rec of readRecords(data)) {
        if (rec.tagId === TAG.PARA_HEADER) paragraphs++;
        else if (rec.tagId === TAG.PARA_TEXT) {
          const r = decodeParaText(rec.payload);
          chars += r.text.length;
          unknown += r.unknown;
          // eslint-disable-next-line no-control-regex
          residual += (r.text.match(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g) ?? []).length;
          if (sampleParts.length < 12 && r.text.trim()) sampleParts.push(r.text.trim());
        }
      }
    }

    return {
      fileName: file.name,
      ok: chars > 0,
      reason: chars === 0 ? '텍스트를 한 글자도 추출하지 못함' : undefined,
      version: v,
      compressed: fh.compressed,
      distributionDoc: false,
      sections: sections.length,
      paragraphs,
      chars,
      residualControlChars: residual,
      unknownCodes: unknown,
      sample: sampleParts.join(' / ').slice(0, 300),
      ms: Math.round(performance.now() - t0),
    };
  } catch (e) {
    return { ...base, reason: e instanceof Error ? e.message : String(e), ms: Math.round(performance.now() - t0) };
  }
}
