import type { BlockType, NormalizedDoc, ParseCtx } from '../types';
import type { Parser } from './index';
import { buildDoc, finishBlocks, warn, type DraftBlock } from './common';
import { decodeBytes, encodingWarnings } from './text';

/**
 * §8.2 — MD.
 *
 * 기획서는 marked 의 lexer 를 쓰지만, 우리에게 필요한 건 블록 경계와 종류뿐이다
 * (인라인 서식은 D-03 에 따라 diff 대상이 아니다). 블록 문법만 다루면 의존성
 * 없이 짧게 끝나고, core 를 라이브러리 없이 Node 에서 테스트할 수 있다.
 *
 * rawText 에는 마크다운 원문을, text 에는 마크업을 벗긴 순수 텍스트를 넣는다.
 */

const HEADING = /^(#{1,6})\s+(.*)$/;
const SETEXT_H1 = /^=+\s*$/;
const SETEXT_H2 = /^-{2,}\s*$/;
const FENCE = /^(\s*)(```+|~~~+)(.*)$/;
const HR = /^\s*([-*_])(\s*\1){2,}\s*$/;
const QUOTE = /^\s*>\s?/;
const BULLET = /^(\s*)([-*+])\s+(.*)$/;
const ORDERED = /^(\s*)(\d{1,9})[.)]\s+(.*)$/;
const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_DELIM = /^\s*\|?[\s:-]*-[\s|:-]*\|?\s*$/;

/** 인라인 마크업을 벗긴다. 링크는 표시 텍스트만 남긴다. */
export function stripInline(md: string): string {
  let s = md;
  s = s.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1'); // 이미지
  s = s.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1'); // 링크
  s = s.replace(/`([^`]*)`/g, '$1'); // 인라인 코드
  s = s.replace(/(\*\*\*|___)(.+?)\1/g, '$2');
  s = s.replace(/(\*\*|__)(.+?)\1/g, '$2');
  s = s.replace(/(\*|_)(.+?)\1/g, '$2');
  s = s.replace(/~~(.+?)~~/g, '$1');
  s = s.replace(/<\/?[A-Za-z][^>]*>/g, ''); // 인라인 HTML 태그
  return s;
}

interface Acc {
  type: BlockType;
  level?: number;
  raw: string[];
  plain: string[];
}

export function parseMarkdownBlocks(md: string): DraftBlock[] {
  const lines = md.split(/\r\n?|\n/);
  const out: DraftBlock[] = [];
  let acc: Acc | null = null;
  let offset = 0;
  let accOffset = 0;

  const flush = () => {
    if (!acc) return;
    const rawText = acc.raw.join('\n');
    if (rawText.trim()) {
      const d: DraftBlock = {
        type: acc.type,
        rawText: acc.plain.join('\n'),
        source: { charOffset: accOffset },
      };
      if (acc.level !== undefined) d.level = acc.level;
      out.push(d);
    }
    acc = null;
  };

  const start = (type: BlockType, raw: string, plain: string, level?: number) => {
    flush();
    accOffset = offset;
    acc = { type, raw: [raw], plain: [plain] };
    if (level !== undefined) acc.level = level;
  };

  let fence: { marker: string; indent: number } | null = null;

  for (const line of lines) {
    const lineStart = offset;
    offset += line.length + 1;

    // 코드 펜스 안에서는 어떤 문법도 해석하지 않는다.
    if (fence) {
      const close = line.match(FENCE);
      if (close && close[2]!.startsWith(fence.marker[0]!) && close[2]!.length >= fence.marker.length) {
        fence = null;
        flush();
        continue;
      }
      if (acc) {
        acc.raw.push(line);
        acc.plain.push(line);
      }
      continue;
    }

    const fenceOpen = line.match(FENCE);
    if (fenceOpen) {
      flush();
      accOffset = lineStart;
      fence = { marker: fenceOpen[2]!, indent: fenceOpen[1]!.length };
      acc = { type: 'code', raw: [line], plain: [] };
      continue;
    }

    if (!line.trim()) {
      flush();
      continue;
    }

    if (HR.test(line) && !(acc && acc.type === 'paragraph')) {
      flush();
      continue;
    }

    const h = line.match(HEADING);
    if (h) {
      start('heading', line, stripInline(h[2]!.replace(/\s+#+\s*$/, '')), h[1]!.length);
      flush();
      continue;
    }

    // Setext: 앞 문단이 제목으로 승격된다.
    if (acc && acc.type === 'paragraph' && (SETEXT_H1.test(line) || SETEXT_H2.test(line))) {
      acc.type = 'heading';
      acc.level = SETEXT_H1.test(line) ? 1 : 2;
      acc.raw.push(line);
      flush();
      continue;
    }

    if (QUOTE.test(line)) {
      const body = stripInline(line.replace(QUOTE, ''));
      if (acc && acc.type === 'quote') {
        acc.raw.push(line);
        acc.plain.push(body);
      } else {
        start('quote', line, body);
      }
      continue;
    }

    const bullet = line.match(BULLET);
    const ordered = line.match(ORDERED);
    if (bullet || ordered) {
      const indent = (bullet ? bullet[1]! : ordered![1]!).length;
      const body = stripInline(bullet ? bullet[3]! : ordered![3]!);
      // 항목 하나가 블록 하나다. 항목별로 끊어야 diff 가 항목 단위로 나온다.
      start('listItem', line, body, Math.floor(indent / 2));
      continue;
    }

    if (TABLE_ROW.test(line)) {
      if (TABLE_DELIM.test(line) && acc && acc.type === 'table') {
        acc.raw.push(line); // 구분선은 텍스트에 넣지 않는다
        continue;
      }
      const cells = line
        .trim()
        .replace(/^\||\|$/g, '')
        .split('|')
        .map((c) => stripInline(c).trim())
        .join(' | ');
      if (acc && acc.type === 'table') {
        acc.raw.push(line);
        acc.plain.push(cells);
      } else {
        start('table', line, cells);
      }
      continue;
    }

    // 이어지는 본문 줄. 단일 개행은 문단 안에서 보존한다.
    if (acc && (acc.type === 'paragraph' || acc.type === 'quote' || acc.type === 'listItem')) {
      acc.raw.push(line);
      acc.plain.push(stripInline(line));
    } else {
      start('paragraph', line, stripInline(line));
    }
  }

  flush();
  return out;
}

export const markdownParser: Parser = {
  async parse(buf: ArrayBuffer, fileName: string, ctx: ParseCtx): Promise<NormalizedDoc> {
    ctx.progress({ phase: 'parsing', current: 0, total: 1 });

    const decoded = decodeBytes(buf);
    const drafts = parseMarkdownBlocks(decoded.text);
    const blocks = finishBlocks(drafts, ctx.options);
    const warnings = encodingWarnings(decoded);
    if (drafts.some((d) => d.type === 'table')) {
      warnings.push(warn('TABLE_FLATTENED', 'info', '표는 셀을 " | " 로 이어 한 블록으로 비교합니다.'));
    }

    ctx.progress({ phase: 'parsing', current: 1, total: 1 });

    return buildDoc({
      format: 'md',
      fileName,
      fileSize: buf.byteLength,
      parserVersion: 'md@1',
      blocks,
      warnings,
      confidence: decoded.guessed ? 0.7 : 1.0,
    });
  },
};
