import { BULLET_START, SENTENCE_END } from './constants';
import type { PdfBlockDraft } from './paragraphMerge';

/**
 * §6.5 단계 6 — 페이지 경계 문단 병합.
 *
 * 기획서가 "가장 흔하고 가장 치명적"이라고 표시한 항목이다.
 * 이걸 빼먹으면 "페이지 나눔 위치만 다른 같은 문서"가 전부 다르게 나온다.
 */
export function joinAcrossPages(pages: PdfBlockDraft[][]): { blocks: PdfBlockDraft[]; joined: number } {
  const out: PdfBlockDraft[] = [];
  let joined = 0;

  for (const page of pages) {
    if (page.length === 0) continue;

    const prev = out[out.length - 1];
    const first = page[0]!;

    if (
      prev &&
      prev.type === 'paragraph' &&
      first.type === 'paragraph' &&
      !SENTENCE_END.test(prev.text.trim()) &&
      !BULLET_START.test(first.text)
    ) {
      prev.text = `${prev.text} ${first.text}`.replace(/\s+/g, ' ').trim();
      prev.tableLike = prev.tableLike || first.tableLike;
      joined++;
      out.push(...page.slice(1));
    } else {
      out.push(...page);
    }
  }

  return { blocks: out, joined };
}
