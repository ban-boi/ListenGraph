import { describe, it, expect } from 'vitest';
import { getLaneX } from './graph-utils';

describe('getLaneX comparison 车道分配', () => {
  it('第一个出现的 speaker 在主车道（左侧）', () => {
    const mainX = getLaneX('comparison', 'claim', 'Alice', ['Alice', 'Bob']);
    const rightX = getLaneX('comparison', 'claim', 'Bob', ['Alice', 'Bob']);
    expect(mainX).toBeLessThan(rightX);
  });

  it('无 speaker 时走主车道', () => {
    const x = getLaneX('comparison', 'claim', undefined, []);
    expect(x).toBe(60);
  });

  it('causal 视图不受 speaker 影响', () => {
    const x = getLaneX('causal', 'claim', 'Alice', ['Alice', 'Bob']);
    expect(x).toBe(60);
  });

  it('三个 speaker 时第一个左车道其余右车道', () => {
    const xAlice = getLaneX('comparison', 'claim', 'Alice', ['Alice', 'Bob', 'Charlie']);
    const xBob = getLaneX('comparison', 'claim', 'Bob', ['Alice', 'Bob', 'Charlie']);
    const xCharlie = getLaneX('comparison', 'claim', 'Charlie', ['Alice', 'Bob', 'Charlie']);
    expect(xAlice).toBe(60);
    expect(xBob).toBe(360);
    expect(xCharlie).toBe(360);
  });

  it('speakersInGraph 为 undefined 时走主车道', () => {
    const x = getLaneX('comparison', 'claim', 'Alice', undefined);
    expect(x).toBe(60);
  });

  it('只有一个 speaker 时所有节点走主车道', () => {
    const x = getLaneX('comparison', 'claim', 'Alice', ['Alice']);
    expect(x).toBe(60);
  });
});
