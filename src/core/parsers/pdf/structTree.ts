import type { BlockType } from '../../types';
import type { PdfBlockDraft } from './paragraphMerge';

/**
 * §6.4 트랙 A — 구조 트리 직결.
 *
 * 태그된 PDF 는 문단 경계가 파일에 이미 들어 있다. 휴리스틱이 전혀 필요 없고
 * 결과도 훨씬 정확하다(confidence 0.95). Word 로 내보낸 PDF 와 접근성을 지킨
 * 공공 PDF 상당수가 여기 해당한다.
 *
 * 함정(mozilla/pdf.js#14493): getTextContent() 의 배열 순서와 구조 트리 순서가
 * 어긋나는 문서가 있다. 그래서 순서는 **구조 트리를 신뢰**하고, 텍스트는
 * includeMarkedContent 로 받은 mcid 로 연결한다.
 */

const TAG_TO_BLOCK: Record<string, BlockType> = {
  H1: 'heading',
  H2: 'heading',
  H3: 'heading',
  H4: 'heading',
  H5: 'heading',
  H6: 'heading',
  H: 'heading',
  Title: 'heading',
  P: 'paragraph',
  LI: 'listItem',
  LBody: 'listItem',
  Table: 'table',
  TR: 'table',
  TD: 'table',
  TH: 'table',
  Code: 'code',
  BlockQuote: 'quote',
  Figure: 'image',
  Caption: 'paragraph',
};

export interface StructContentRef {
  type: 'content';
  id: string;
}

export interface StructNode {
  role?: string;
  alt?: string;
  children?: Array<StructNode | StructContentRef>;
}

export interface MarkedItem {
  type?: string;
  id?: string;
  str?: string;
  hasEOL?: boolean;
}

function isContentRef(n: StructNode | StructContentRef): n is StructContentRef {
  return (n as StructContentRef).type === 'content';
}

/** marked-content id → 그 안에 들어 있는 텍스트 */
export function buildMcidIndex(items: MarkedItem[]): Map<string, string> {
  const byId = new Map<string, string>();
  const stack: string[] = [];

  for (const it of items) {
    if (it.type === 'beginMarkedContentProps' || it.type === 'beginMarkedContent') {
      stack.push(it.id ?? '');
      continue;
    }
    if (it.type === 'endMarkedContent') {
      stack.pop();
      continue;
    }
    if (typeof it.str !== 'string') continue;

    const id = stack[stack.length - 1];
    if (!id) continue;
    const piece = it.str + (it.hasEOL ? ' ' : '');
    byId.set(id, (byId.get(id) ?? '') + piece);
  }
  return byId;
}

/** 텍스트를 담은 태그가 하나라도 있는가. 없으면 트랙 B 로 폴백한다. */
export function hasTextTags(tree: StructNode | null | undefined): boolean {
  if (!tree) return false;
  let found = false;
  const visit = (n: StructNode) => {
    if (found) return;
    if (n.role && TAG_TO_BLOCK[n.role]) found = true;
    for (const c of n.children ?? []) {
      if (found) return;
      if (!isContentRef(c)) visit(c);
    }
  };
  visit(tree);
  return found;
}

function collectText(node: StructNode, byMcid: Map<string, string>): string {
  const parts: string[] = [];
  const visit = (n: StructNode | StructContentRef) => {
    if (isContentRef(n)) {
      const t = byMcid.get(n.id);
      if (t) parts.push(t);
      return;
    }
    if (n.alt) parts.push(n.alt);
    for (const c of n.children ?? []) visit(c);
  };
  visit(node);
  return parts.join('').replace(/\s+/g, ' ').trim();
}

/**
 * 구조 트리를 블록으로 옮긴다.
 * 블록이 되는 태그(P, H1…)를 만나면 그 아래 텍스트를 통째로 모은다 —
 * 하위 span 이 아무리 잘게 쪼개져 있어도 문단 하나로 유지된다.
 */
export function walkStructTree(tree: StructNode, byMcid: Map<string, string>, page: number): PdfBlockDraft[] {
  const out: PdfBlockDraft[] = [];

  const visit = (node: StructNode | StructContentRef, tableDepth: number) => {
    if (isContentRef(node)) return;

    const role = node.role ?? '';
    const type = TAG_TO_BLOCK[role];

    if (role === 'Table') {
      const text = collectText(node, byMcid);
      if (text) out.push({ type: 'table', text, y: 0, page, tableLike: true });
      return; // 표 내부는 더 파고들지 않는다 (v1 은 평탄화)
    }

    if (type && type !== 'table' && tableDepth === 0) {
      const text = collectText(node, byMcid);
      if (text) {
        const draft: PdfBlockDraft = { type, text, y: 0, page, tableLike: false };
        const m = role.match(/^H([1-6])$/);
        if (m) draft.level = Number(m[1]);
        else if (role === 'Title') draft.level = 1;
        out.push(draft);
      }
      return;
    }

    for (const c of node.children ?? []) visit(c, tableDepth);
  };

  visit(tree, 0);
  return out;
}
