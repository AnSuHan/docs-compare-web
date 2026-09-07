import type { InlineSpan } from '@/core/types';

/**
 * §9.3 — 인라인 강조.
 *
 * 색만으로 구분하지 않는다. 추가는 밑줄, 삭제는 취소선을 함께 쓴다.
 * (색각 이상 대응 + WCAG)
 *
 * 이게 이 제품의 핵심 화면이다. "계약서를 → 계약서는" 에서 조사 한 글자만
 * 짚어주는 것이 어절 통째로 빨개지는 것과 체감이 완전히 다르다.
 */
export function InlineSpans({ spans, side }: { spans: InlineSpan[]; side: 'left' | 'right' | 'both' }) {
  return (
    <>
      {spans.map((s, i) => {
        // Split 뷰에서는 왼쪽 칸에 추가분을, 오른쪽 칸에 삭제분을 보여주지 않는다.
        if (side === 'left' && s.kind === 'insert') return null;
        if (side === 'right' && s.kind === 'delete') return null;

        if (s.kind === 'equal') return <span key={i}>{s.text}</span>;

        const isInsert = s.kind === 'insert';
        return (
          <mark
            key={i}
            className={
              isInsert
                ? 'bg-[var(--color-add-strong)] underline decoration-2 underline-offset-2 text-[var(--color-ink-900)]'
                : 'bg-[var(--color-del-strong)] line-through decoration-2 text-[var(--color-ink-900)]'
            }
          >
            {s.text}
          </mark>
        );
      })}
    </>
  );
}
