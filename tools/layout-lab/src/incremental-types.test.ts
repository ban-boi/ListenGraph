import { describe, expect, it } from 'vitest';
import { computePinK, computeMaxDrift, computeOldMobility, stableHash, matchClusters } from './incremental-types';

describe('Pin 参数公式', () => {
  it('无新增（r=0）：PIN_K=TIGHT=0.10', () => {
    expect(computePinK(0)).toBeCloseTo(0.10);
  });
  it('新增 30%（r=0.3）：PIN_K=LOOSE=0.025', () => {
    expect(computePinK(0.3)).toBeCloseTo(0.025);
  });
  it('新增 15%（r=0.15）：PIN_K 在 TIGHT 和 LOOSE 之间', () => {
    const k = computePinK(0.15);
    expect(k).toBeGreaterThan(0.025);
    expect(k).toBeLessThan(0.10);
  });
  it('新增超 30%（r=0.5）：不继续降，PIN_K=LOOSE', () => {
    expect(computePinK(0.5)).toBeCloseTo(0.025);
  });
});

describe('MaxDrift 公式', () => {
  it('r=0 → 50px', () => { expect(computeMaxDrift(0)).toBe(50); });
  it('r=0.3 → 100px', () => { expect(computeMaxDrift(0.3)).toBe(100); });
});

describe('Mobility 公式', () => {
  it('r=0 → 0.2', () => { expect(computeOldMobility(0)).toBeCloseTo(0.2); });
  it('r=0.3 → 0.6', () => { expect(computeOldMobility(0.3)).toBeCloseTo(0.6); });
});

describe('stableHash', () => {
  it('同一输入同一输出', () => { expect(stableHash('node_123')).toBe(stableHash('node_123')); });
  it('不同输入不同输出', () => { expect(stableHash('node_123')).not.toBe(stableHash('node_456')); });
  it('返回 0-359 整数', () => {
    const h = stableHash('test');
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThan(360);
    expect(Number.isInteger(h)).toBe(true);
  });
});

describe('matchClusters', () => {
  it('新 cluster：无交集', () => {
    const result = matchClusters(
      [{ id: 'c_new', nodeIds: ['x', 'y'] }],
      [{ id: 'old1', nodeIds: ['a', 'b'] }],
    );
    expect(result[0].isNew).toBe(true);
    expect(result[0].predecessorIds).toEqual([]);
  });
  it('继承：一个前驱', () => {
    const result = matchClusters(
      [{ id: 'c1', nodeIds: ['a', 'b', 'c'] }],
      [{ id: 'old1', nodeIds: ['a', 'b'] }],
    );
    expect(result[0].isNew).toBe(false);
    expect(result[0].isMerge).toBe(false);
    expect(result[0].predecessorIds).toEqual(['old1']);
  });
  it('merge：多个前驱', () => {
    const result = matchClusters(
      [{ id: 'c_merged', nodeIds: ['a', 'b', 'c', 'd'] }],
      [
        { id: 'old1', nodeIds: ['a', 'b'] },
        { id: 'old2', nodeIds: ['c', 'd'] },
      ],
    );
    expect(result[0].isMerge).toBe(true);
    expect(result[0].predecessorIds).toEqual(['old1', 'old2']);
  });
  it('split：一个旧簇对应多个新簇', () => {
    const result = matchClusters(
      [
        { id: 'c1', nodeIds: ['a', 'b'] },
        { id: 'c2', nodeIds: ['c', 'd'] },
      ],
      [{ id: 'old1', nodeIds: ['a', 'b', 'c', 'd'] }],
    );
    expect(result[0].predecessorIds).toEqual(['old1']);
    expect(result[1].predecessorIds).toEqual(['old1']);
    expect(result[0].isNew).toBe(false);
  });
  it('混合：新 + 继承 + merge', () => {
    const result = matchClusters(
      [
        { id: 'c_new', nodeIds: ['x'] },
        { id: 'c_inherit', nodeIds: ['a', 'b'] },
        { id: 'c_merge', nodeIds: ['c', 'd', 'e'] },
      ],
      [
        { id: 'old1', nodeIds: ['a', 'b'] },
        { id: 'old2', nodeIds: ['c'] },
        { id: 'old3', nodeIds: ['d', 'e'] },
      ],
    );
    expect(result[0].isNew).toBe(true);
    expect(result[1].predecessorIds).toEqual(['old1']);
    expect(result[2].isMerge).toBe(true);
  });
});
