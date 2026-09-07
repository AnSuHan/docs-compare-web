/**
 * T-054 초안 — HWPTAG_PARA_TEXT 디코딩.
 *
 * 페이로드는 UTF-16LE 시퀀스인데 그 안에 제어 문자가 섞여 있고,
 * 제어 문자마다 차지하는 WCHAR 수가 다르다.
 * 확장/인라인 컨트롤을 1 WCHAR 로 처리하면 컨트롤 내부 바이너리가
 * 한글로 디코딩돼 본문에 그대로 섞여 들어간다. 이 파일의 존재 이유다.
 */

/** 1 WCHAR 만 차지하는 문자 컨트롤. */
const CHAR_CTRL = new Set([0, 10, 13, 24, 25, 26, 27, 28, 29, 30, 31]);
/** 8 WCHAR 를 차지하는 인라인 컨트롤 (탭, 각주 참조 등). */
const INLINE_CTRL = new Set([4, 5, 6, 7, 8, 9, 19, 20]);
/** 8 WCHAR 를 차지하는 확장 컨트롤 (표, 그림, 구역 정의 등). */
const EXTENDED_CTRL = new Set([1, 2, 3, 11, 12, 14, 15, 16, 17, 18, 21, 22, 23]);

export interface DecodeResult {
  text: string;
  /** 8 WCHAR 컨트롤을 만난 횟수. 표·그림이 얼마나 들어있는지 가늠자. */
  controls: number;
  /** 정의되지 않은 코드. 0 이 아니면 포맷 해석에 구멍이 있다는 뜻. */
  unknown: number;
}

export function decodeParaText(payload: DataView): DecodeResult {
  const out: string[] = [];
  const n = payload.byteLength >>> 1;
  let controls = 0;
  let unknown = 0;
  let i = 0;

  while (i < n) {
    const code = payload.getUint16(i * 2, true);

    if (code >= 32) {
      out.push(String.fromCharCode(code));
      i += 1;
      continue;
    }

    if (CHAR_CTRL.has(code)) {
      if (code === 10 || code === 13) out.push('\n');
      else if (code === 24) out.push('-');
      else if (code === 30 || code === 31) out.push(' ');
      i += 1;
      continue;
    }

    if (INLINE_CTRL.has(code) || EXTENDED_CTRL.has(code)) {
      if (code === 9) out.push('\t');
      controls += 1;
      i += 8; // 반드시 8 WCHAR 를 건너뛴다
      continue;
    }

    unknown += 1;
    i += 1;
  }

  return { text: out.join(''), controls, unknown };
}
