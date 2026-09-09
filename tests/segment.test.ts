import { describe, expect, it } from 'vitest';
import { contextHead, contextTail, graphemes } from '../src/core/segment';

/**
 * 글자·낱말 경계.
 *
 * 코드포인트로 쪼개면 이모지 조합과 결합 문자가 반쪽으로 갈리고, 공백으로 낱말을
 * 자르면 띄어쓰기 없는 언어가 통째로 딸려 온다. 둘 다 화면에서 바로 드러나는
 * 문제라서 여기서 못박는다.
 */
describe('graphemes', () => {
  it('한글·영문은 글자 그대로 센다', () => {
    expect(graphemes('계약서')).toEqual(['계', '약', '서']);
    expect(graphemes('abc')).toEqual(['a', 'b', 'c']);
  });

  it('ZWJ 로 이어 붙인 이모지를 쪼개지 않는다', () => {
    // 가족 이모지: 사람 넷을 ZWJ 로 이었다. 코드포인트로 세면 7개로 갈린다.
    const family = '👨‍👩‍👧‍👦';
    expect([...family].length).toBeGreaterThan(1);
    expect(graphemes(family)).toEqual([family]);
  });

  it('NFD 로 분해된 한글을 한 글자로 본다', () => {
    const nfd = '가'.normalize('NFD'); // ᄀ + ᅡ
    expect([...nfd].length).toBe(2);
    expect(graphemes(nfd)).toEqual([nfd]);
  });

  it('결합 문자(태국어 성조)를 쪼개지 않는다', () => {
    const thai = 'ก้'; // ก + 성조 부호
    expect(graphemes(thai)).toEqual([thai]);
  });
});

describe('contextTail / contextHead', () => {
  it('낱말 가운데를 자르지 않는다', () => {
    // 12자 안에서 낱말 경계까지만 가져온다.
    expect(contextTail('계약 기간은 2026년 1월 1일부터 ', 12).startsWith(' ')).toBe(false);
    expect('계약 기간은 2026년 1월 1일부터 '.endsWith(contextTail('계약 기간은 2026년 1월 1일부터 ', 12))).toBe(true);
  });

  it('짧은 문자열은 통째로 돌려준다', () => {
    expect(contextTail('년으로 한다.', 20)).toBe('년으로 한다.');
    expect(contextHead('년으로 한다.', 20)).toBe('년으로 한다.');
  });

  it('빈 문자열은 빈 문자열이다', () => {
    expect(contextTail('', 10)).toBe('');
    expect(contextHead('', 10)).toBe('');
  });

  it('상한을 넘기지 않는다', () => {
    const long = '가나다라마바사아자차카타파하가나다라마바사';
    expect(graphemes(contextTail(long, 8)).length).toBeLessThanOrEqual(8);
    expect(graphemes(contextHead(long, 8)).length).toBeLessThanOrEqual(8);
  });

  it('띄어쓰기가 없는 언어도 통째로 끌고 오지 않는다', () => {
    // 공백만 보고 자르면 문장 전체가 한 낱말이라 상한을 넘긴다.
    const zh = '这是一份关于文件审阅服务的合同条款说明文字';
    expect(graphemes(contextTail(zh, 6)).length).toBeLessThanOrEqual(6);
    expect(graphemes(contextHead(zh, 6)).length).toBeLessThanOrEqual(6);
  });
});
