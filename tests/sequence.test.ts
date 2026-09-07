import { describe, expect, it } from 'vitest';
import { diffSequence, type SeqOp } from '../src/core/diff/sequence';

/** ops 를 다시 적용해 b 가 복원되는지 본다. diff 의 정확성은 이걸로 증명된다. */
function applyToB(a: string[], b: string[], ops: SeqOp[]): string[] {
  const out: string[] = [];
  for (const op of ops) {
    if (op.kind === 'equal') out.push(a[op.ai]!);
    else if (op.kind === 'insert') out.push(b[op.bi]!);
  }
  return out;
}

function applyToA(a: string[], ops: SeqOp[]): string[] {
  const out: string[] = [];
  for (const op of ops) {
    if (op.kind === 'equal' || op.kind === 'delete') out.push(a[op.ai]!);
  }
  return out;
}

describe('diffSequence', () => {
  it('같은 배열이면 전부 equal 이다', () => {
    const a = ['가', '나', '다'];
    const ops = diffSequence(a, a);
    expect(ops.every((o) => o.kind === 'equal')).toBe(true);
    expect(ops).toHaveLength(3);
  });

  it('빈 배열끼리도 죽지 않는다', () => {
    expect(diffSequence([], [])).toHaveLength(0);
  });

  it('한쪽이 비면 전부 insert / delete 다', () => {
    expect(diffSequence([], ['가', '나']).map((o) => o.kind)).toEqual(['insert', 'insert']);
    expect(diffSequence(['가', '나'], []).map((o) => o.kind)).toEqual(['delete', 'delete']);
  });

  it('중간 삽입을 최소 편집으로 찾는다', () => {
    const ops = diffSequence(['가', '다'], ['가', '나', '다']);
    expect(ops.filter((o) => o.kind === 'insert')).toHaveLength(1);
    expect(ops.filter((o) => o.kind === 'delete')).toHaveLength(0);
  });

  it('교체는 delete + insert 로 나온다', () => {
    const ops = diffSequence(['가', '나', '다'], ['가', '라', '다']);
    expect(ops.filter((o) => o.kind === 'delete')).toHaveLength(1);
    expect(ops.filter((o) => o.kind === 'insert')).toHaveLength(1);
  });

  it('임의의 두 배열에 대해 ops 를 적용하면 양쪽이 정확히 복원된다', () => {
    // 결정적 의사난수. 실패하면 항상 같은 입력으로 재현된다.
    let seed = 12345;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const pick = () => String.fromCharCode(97 + Math.floor(rnd() * 6));

    for (let round = 0; round < 200; round++) {
      const a = Array.from({ length: Math.floor(rnd() * 20) }, pick);
      const b = Array.from({ length: Math.floor(rnd() * 20) }, pick);
      const ops = diffSequence(a, b);
      expect(applyToA(a, ops)).toEqual(a);
      expect(applyToB(a, b, ops)).toEqual(b);
    }
  });

  it('블록이 많아도(앵커 분할 경로) 정확하다', () => {
    const a = Array.from({ length: 3000 }, (_, i) => `줄 ${i}`);
    const b = [...a];
    b.splice(1500, 1, '바뀐 줄');
    b.splice(20, 0, '새 줄');

    const ops = diffSequence(a, b);
    expect(applyToA(a, ops)).toEqual(a);
    expect(applyToB(a, b, ops)).toEqual(b);
    expect(ops.filter((o) => o.kind !== 'equal').length).toBeLessThan(10);
  });

  it('공통 부분이 거의 없는 큰 입력에서도 결과가 정확하다', () => {
    const a = Array.from({ length: 600 }, (_, i) => `A${i}`);
    const b = Array.from({ length: 600 }, (_, i) => `B${i}`);
    const ops = diffSequence(a, b);
    expect(applyToA(a, ops)).toEqual(a);
    expect(applyToB(a, b, ops)).toEqual(b);
  });
});
