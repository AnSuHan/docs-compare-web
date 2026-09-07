/**
 * §7.4.7 — PrvText 폴백.
 *
 * PrvText 스트림에는 미리보기용 순수 텍스트가 UTF-16LE 로 들어 있다.
 * 본문 파싱이 실패했을 때 최소한 내용을 볼 수는 있게 해준다.
 *
 * 단, 앞부분만 담고 있을 수 있으므로 **비교에는 쓰지 않는다**.
 * 그래서 confidence 를 0.4 로 낮춰 돌려주고, UI 는 0.7 미만에서 경고를 띄운다.
 */

/** 줄바꿈·탭만 남기고 나머지 C0 제어문자와 NUL 패딩을 버린다. */
function isJunk(code: number): boolean {
  if (code === 0x09 || code === 0x0a) return false;
  return code < 0x20 || code === 0x7f;
}

export function stripControls(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (!isJunk(code)) out += s[i];
  }
  return out;
}

export function decodePrvText(stream: Uint8Array): string {
  // 홀수 바이트로 끝나는 스트림이 있어 안전하게 잘라 읽는다.
  const even = stream.byteLength - (stream.byteLength % 2);
  const raw = new TextDecoder('utf-16le').decode(stream.subarray(0, even));

  return stripControls(raw.replace(/\r\n?/g, '\n')).trim();
}
