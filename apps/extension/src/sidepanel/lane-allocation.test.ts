import { describe, it, expect } from 'vitest';
import { getLaneX } from './graph-utils';

describe('getLaneX comparison 车道分配', () => {
  it('第一个出现的 speaker 在主车道（左侧）', () => {
    const speakers = new Set(['Alice', 'Bob']);
    const mainX = getLaneX('comparison', 'claim', 'Alice', speakers);
    const rightX = getLaneX('comparison', 'claim', 'Bob', speakers);
    expect(mainX).toBeLessThan(rightX);
  });

  it('无 speaker 时走主车道', () => {
    const x = getLaneX('comparison', 'claim', undefined, new Set());
    expect(x).toBe(60); // STABLE_LAYOUT_MAIN_X
  });

  it('causal 视图不受 speaker 影响', () => {
    const x = getLaneX('causal', 'claim', 'Alice', new Set(['Alice', 'Bob']));
    expect(x).toBe(60);
  });

  it('三个 speaker 时第一个左车道其余右车道', () => {
    const speakers = new Set(['Alice', 'Bob', 'Charlie']);
    const xAlice = getLaneX('comparison', 'claim', 'Alice', speakers);
    const xBob = getLaneX('comparison', 'claim', 'Bob', speakers);
    const xCharlie = getLaneX('comparison', 'claim', 'Charlie', speakers);
    expect(xAlice).toBe(60);
    expect(xBob).toBe(360);
    expect(xCharlie).toBe(360);
  });
});
