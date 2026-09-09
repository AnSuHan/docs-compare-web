/**
 * 글자·낱말 경계.
 *
 * 코드포인트로 쪼개면(`[...s]`) 이모지 조합·결합 문자·NFD 자모가 깨진다.
 * 공백으로 낱말을 자르면(`/\s+|[^\s]+/`) 중국어·일본어·태국어에서 문장 전체가
 * 토큰 하나가 된다. 둘 다 `Intl.Segmenter` 가 제대로 처리한다.
 *
 * 없는 환경(오래된 브라우저)에서는 예전 방식으로 물러난다 — 정확도는 떨어지지만
 * 화면이 죽지는 않는다.
 */

type Seg = { segment: string };

const HAS_SEGMENTER = typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function';

// Segmenter 는 만드는 비용이 있다. 한 번 만들어 재사용한다.
let graphemeSeg: Intl.Segmenter | null = null;
let wordSeg: Intl.Segmenter | null = null;

/** 자소 단위. 이모지 ZWJ 조합, 태국어 성조, 결합 자모가 한 덩어리로 남는다. */
export function graphemes(s: string): string[] {
  if (!HAS_SEGMENTER) return [...s];
  graphemeSeg ??= new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  return Array.from(graphemeSeg.segment(s) as Iterable<Seg>, (x) => x.segment);
}

/** 낱말 단위. 띄어쓰기가 없는 언어도 사전으로 끊는다. */
function words(s: string): string[] {
  if (!HAS_SEGMENTER) return s.match(/\s+|[^\s]+/g) ?? [];
  wordSeg ??= new Intl.Segmenter(undefined, { granularity: 'word' });
  return Array.from(wordSeg.segment(s) as Iterable<Seg>, (x) => x.segment);
}

/** 뒤에서부터 max 자 이내로, 낱말 가운데를 자르지 않고 가져온다. */
export function contextTail(s: string, max: number): string {
  if (!s) return '';
  let out = '';
  const w = words(s);
  for (let i = w.length - 1; i >= 0; i--) {
    const next = w[i]! + out;
    if (graphemes(next).length > max) break;
    out = next;
  }
  // 낱말 하나가 이미 max 를 넘으면 글자 단위로라도 조금은 보여준다.
  return out || graphemes(s).slice(-max).join('');
}

/** 앞에서부터 max 자 이내로, 낱말 가운데를 자르지 않고 가져온다. */
export function contextHead(s: string, max: number): string {
  if (!s) return '';
  let out = '';
  for (const w of words(s)) {
    const next = out + w;
    if (graphemes(next).length > max) break;
    out = next;
  }
  return out || graphemes(s).slice(0, max).join('');
}
