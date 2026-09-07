/** FNV-1a 32bit. 짧고 빠르고 의존성이 없다. */
export function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * 같은 내용의 블록이 반복되는 문서가 흔하므로 내용만으로 해시하면 충돌한다.
 * 순번을 섞어 React key / 스크롤 앵커 / diff 참조에 모두 안전하게 쓴다.
 */
export function makeBlockId(text: string, index: number): string {
  return index.toString(36) + '-' + fnv1a(text).toString(36);
}
