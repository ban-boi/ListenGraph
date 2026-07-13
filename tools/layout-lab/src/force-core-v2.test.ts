import { describe, expect, it } from 'vitest';
import { resolveOverlaps, type CenterPos } from './force-core-v2';
import type { NodeSize } from './round3-types';

describe('resolveOverlaps（带 16px padding，沿较小 penetration 轴推开）', () => {
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

  it('两个完全重合的节点被推开（不再重合）', () => {
    const pos: Record<string, CenterPos> = {
      a: { cx: 0, cy: 0 },
      b: { cx: 0, cy: 0 },
    };
    const sizes: Record<string, NodeSize> = {
      a: { width: 200, height: 100 },
      b: { width: 200, height: 100 },
    };
    resolveOverlaps(pos, sizes);
    // 两节点不应再重合
    const dist = Math.hypot(pos.a.cx - pos.b.cx, pos.a.cy - pos.b.cy);
    expect(dist).toBeGreaterThan(0);
    // a 的 id 字母序 < b，沿 X 推时 a 往左
    expect(pos.a.cx).toBeLessThanOrEqual(0);
  });

  it('水平偏移大于垂直偏移时沿 Y 轴推开（较小 penetration）', () => {
    // penetrationX = 200+16-50 = 166, penetrationY = 100+16-0 = 116
    // 较小 penetration 是 Y(116)，所以沿 Y 推
    const pos: Record<string, CenterPos> = {
      a: { cx: 100, cy: 0 },
      b: { cx: 150, cy: 0 },
    };
    const sizes: Record<string, NodeSize> = {
      a: { width: 200, height: 100 },
      b: { width: 200, height: 100 },
    };
    resolveOverlaps(pos, sizes);
    // 推开后 Y 方向应有足够间距
    const distY = Math.abs(pos.a.cy - pos.b.cy);
    expect(distY).toBeGreaterThanOrEqual(100 + 16);
  });

  it('垂直偏移大于水平偏移时沿 X 轴推开（较小 penetration）', () => {
    // penetrationX = 200+16-0 = 216, penetrationY = 100+16-30 = 86
    // 较小 penetration 是 Y(86)... wait, 86 < 216 so still pushes Y
    // Need X penetration < Y penetration. Make nodes overlap mostly horizontally.
    // a={cx:0,cy:0} b={cx:0,cy:130}: penX=216, penY=100+16-130=negative → no overlap on Y
    // Need both to overlap. a={cx:0,cy:0} b={cx:5,cy:0}: penX=211, penY=116 → push Y
    // To push X: need penX < penY. Use wide-short nodes: width=100, height=200
    const pos: Record<string, CenterPos> = {
      a: { cx: 100, cy: 0 },
      b: { cx: 150, cy: 0 },
    };
    const sizes: Record<string, NodeSize> = {
      a: { width: 100, height: 200 },
      b: { width: 100, height: 200 },
    };
    // penX = 100+16-50 = 66, penY = 200+16-0 = 216. penX(66) < penY(216) → push X
    resolveOverlaps(pos, sizes);
    const distX = Math.abs(pos.a.cx - pos.b.cx);
    expect(distX).toBeGreaterThanOrEqual(100 + 16);
  });

  it('多轮迭代：三节点链式重叠最终不重叠', () => {
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
    resolveOverlaps(pos, sizes, 40);
    // 验证每对节点的 AABB（含 padding）不再重叠
    const checkPair = (id1: string, id2: string) => {
      const dx = Math.abs(pos[id1].cx - pos[id2].cx);
      const dy = Math.abs(pos[id1].cy - pos[id2].cy);
      const penX = 200 / 2 + 200 / 2 + 16 - dx;
      const penY = 100 / 2 + 100 / 2 + 16 - dy;
      return penX <= 0 || penY <= 0;
    };
    expect(checkPair('a', 'b')).toBe(true);
    expect(checkPair('b', 'c')).toBe(true);
    expect(checkPair('a', 'c')).toBe(true);
  });
});
