import { describe, expect, it } from 'vitest';
import { analyzeHangul, detectGarbledHangul, entropy, jongseong } from '../src/core/parsers/pdf/hangulSanity';

/** 받침 분포가 정상 한국어에 가깝게 나오는 문장. 100음절을 넘겨야 판정이 돈다. */
const NORMAL = (
  '이 계약은 갑과 을 사이의 권리와 의무를 정하기 위하여 체결한다. ' +
  '갑은 을에게 대금을 지급하고 을은 갑에게 물품을 인도한다. ' +
  '본 계약의 유효기간은 계약일로부터 일년으로 하며 상호 합의에 따라 연장할 수 있다. ' +
  '분쟁이 발생한 경우 관할 법원은 서울중앙지방법원으로 한다.'
).repeat(2);

describe('jongseong', () => {
  it('받침 없는 음절은 0 이다', () => {
    expect(jongseong('가'.charCodeAt(0))).toBe(0);
    expect(jongseong('나'.charCodeAt(0))).toBe(0);
  });

  it('받침 있는 음절은 0 이 아니다', () => {
    expect(jongseong('각'.charCodeAt(0))).toBeGreaterThan(0);
    expect(jongseong('한'.charCodeAt(0))).toBeGreaterThan(0);
  });
});

describe('entropy', () => {
  it('한쪽에 몰리면 0 이다', () => {
    expect(entropy([10, 0, 0, 0])).toBe(0);
  });

  it('균등하면 최대다', () => {
    expect(entropy([5, 5, 5, 5])).toBeCloseTo(2, 5);
  });
});

describe('analyzeHangul', () => {
  it('정상 한국어 문서는 통과시킨다', () => {
    const r = analyzeHangul(NORMAL);
    expect(r.syllables).toBeGreaterThan(100);
    expect(r.garbled).toBe(false);
  });

  it('표본이 적으면 판정하지 않는다 — 오탐이 더 위험하다', () => {
    expect(detectGarbledHangul('한글 조금')).toBe(false);
  });

  it('한글이 거의 없는 문서는 판정 대상이 아니다', () => {
    expect(detectGarbledHangul('This is an English document. '.repeat(50))).toBe(false);
  });

  it('받침이 하나도 없으면 깨진 것으로 본다', () => {
    // ToUnicode 오매핑이 특정 구간으로 쏠린 경우
    const noJong = '가나다라마바사아자차카타파하'.repeat(20);
    const r = analyzeHangul(noJong);
    expect(r.noJongRatio).toBe(1);
    expect(r.garbled).toBe(true);
  });

  it('종성 분포가 균등에 가까우면 깨진 것으로 본다', () => {
    // 받침을 0~27 로 골고루 돌린 음절열 = 무작위 CID 매핑의 특징
    let s = '';
    for (let i = 0; i < 400; i++) {
      s += String.fromCharCode(0xac00 + (i % 28) + Math.floor(i / 28) * 28);
    }
    const r = analyzeHangul(s);
    expect(r.normalizedEntropy).toBeGreaterThan(0.92);
    expect(r.garbled).toBe(true);
  });

  it('단독 자모가 많으면 깨진 것으로 본다', () => {
    const jamo = ('ㄱㅏㄴㅓㄷㅗ' + '가나다라마바사아자차'.repeat(2)).repeat(12);
    expect(analyzeHangul(jamo).jamoRatio).toBeGreaterThan(0.05);
  });

  it('왜 그렇게 판정했는지 이유를 남긴다', () => {
    const r = analyzeHangul('가나다라마바사아자차카타파하'.repeat(20));
    expect(r.reason).toBeTruthy();
  });
});
