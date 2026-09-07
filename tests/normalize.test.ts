import { describe, expect, it } from 'vitest';
import { normalizeText } from '../src/core/normalize';
import { DEFAULT_NORMALIZE } from '../src/core/normalize';

const pdf = DEFAULT_NORMALIZE.pdf;
const text = DEFAULT_NORMALIZE.text;

describe('normalizeText', () => {
  it('NFD 로 들어온 한글을 NFC 로 되돌린다 (macOS·PDF 필수)', () => {
    const nfd = '한글'.normalize('NFD');
    expect(nfd).not.toBe('한글');
    expect(normalizeText(nfd, text)).toBe('한글');
  });

  it('제로폭 문자와 소프트 하이픈을 제거한다', () => {
    expect(normalizeText('계\u200B약\u00AD서', text)).toBe('계약서');
  });

  it('전각 공백을 일반 공백으로 접는다', () => {
    expect(normalizeText('계약\u3000금액', text)).toBe('계약 금액');
  });

  it('CRLF 를 LF 로 통일한다', () => {
    expect(normalizeText('가\r\n나', text)).toBe('가\n나');
  });

  it('전각 영숫자를 반각으로 접는다', () => {
    expect(normalizeText('ＡＢＣ１２３', pdf)).toBe('ABC123');
  });

  it('스마트 따옴표와 대시를 통일한다', () => {
    expect(normalizeText('\u201C계약\u201D \u2013 종료', pdf)).toBe('"계약" - 종료');
  });

  it('PDF 의 라틴 하이픈 줄바꿈을 결합한다', () => {
    expect(normalizeText('agree-\nment', pdf)).toBe('agreement');
  });

  it('한국어에는 하이픈 결합을 적용하지 않는다', () => {
    expect(normalizeText('계약-\n금액', pdf)).toBe('계약-\n금액');
  });
});
