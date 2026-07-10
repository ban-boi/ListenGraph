import { describe, expect, it } from 'vitest';
import { resolveOverlaps, type CenterPos } from './force-core-v2';
import type { NodeSize } from './round3-types';

describe('resolveOverlaps', () => {
  it('两个不重叠的节点不动', () => {
    const pos: Record<string, CenterPos> = {
      a: { cx: 0, cy: 0 },
      b: { cx: 500, cy: 500 },
    };
    const sizes: Record<string, NodeSize> = {
      a: { width: 200, height: 100 },
      b: { width: 200, height: 100 },
    };
    resolveOverlaps(pos, sizes);
    expect(pos.a.cx).toBe(0);
    expect(pos.b.cx).toBe(500);
  });

  it('两个水平重叠的节点沿 X 轴推开', () => {
    const pos: Record<string, CenterPos> = {
      a: { cx: 100, cy: 0 },
      b: { cx: 150, cy: 0 },
    };
    const sizes: Record<string, NodeSize> = {
      a: { width: 200, height: 100 },
      b: { width: 200, height: 100 },
    };
    resolveOverlaps(pos, sizes);
    const dist = Math.abs(pos.a.cx - pos.b.cx);
    expect(dist).toBeGreaterThanOrEqual(200);
  });

  it('两个垂直重叠的节点沿 Y 轴推开', () => {
    const pos: Record<string, CenterPos> = {
      a: { cx: 0, cy: 100 },
      b: { cx: 0, cy: 130 },
    };
    const sizes: Record<string, NodeSize> = {
      a: { width: 200, height: 100 },
      b: { width: 200, height: 100 },
    };
    resolveOverlaps(pos, sizes);
    const dist = Math.abs(pos.a.cy - pos.b.cy);
    expect(dist).toBeGreaterThanOrEqual(100);
  });

  it('中心重合时按 id 稳定方向推开', () => {
    const pos: Record<string, CenterPos> = {
      b: { cx: 0, cy: 0 },
      a: { cx: 0, cy: 0 },
    };
    const sizes: Record<string, NodeSize> = {
      a: { width: 200, height: 100 },
      b: { width: 200, height: 100 },
    };
    resolveOverlaps(pos, sizes);
    expect(pos.a.cx).not.toBe(pos.b.cx);
    expect(pos.a.cx).toBeLessThan(pos.b.cx);
  });

  it('多轮迭代消除三节点链式重叠', () => {
    const pos: Record<string, CenterPos> = {
      a: { cx: 0, cy: 0 },
      b: { cx: 10, cy: 0 },
      c: { cx: 20, cy: 0 },
    };
    const sizes: Record<string, NodeSize> = {
      a: { width: 200, height: 100 },
      b: { width: 200, height: 100 },
      c: { width: 200, height: 100 },
    };
    resolveOverlaps(pos, sizes, 30);
    const distAC = Math.abs(pos.a.cx - pos.c.cx);
    const overlapAC = (200 / 2 + 200 / 2) - distAC;
    expect(overlapAC).toBeLessThanOrEqual(0);
  });
});
