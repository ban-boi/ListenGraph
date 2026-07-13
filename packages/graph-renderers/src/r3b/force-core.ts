import type { NodeSize } from './node-size';
import { FORCE_PARAMS } from './node-size';

export type CenterPos = { cx: number; cy: number };

// AABB 碰撞消除（带视觉安全间距 padding）
// 沿较小 penetration 轴推开；保证节点间净间距 ≥ padding
export function resolveOverlaps(
  positions: Record<string, CenterPos>,
  sizes: Record<string, NodeSize>,
  rounds: number = FORCE_PARAMS.OVERLAP_ROUNDS,
  padding: number = 16,
): void {
  const ids = Object.keys(positions).sort();

  for (let r = 0; r < rounds; r++) {
    let anyOverlap = false;
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = ids[i], b = ids[j];
        if (!positions[a] || !positions[b] || !sizes[a] || !sizes[b]) continue;

        const sa = sizes[a], sb = sizes[b];
        const dx = positions[a].cx - positions[b].cx;
        const dy = positions[a].cy - positions[b].cy;

        // 带 padding 的 penetration：正数表示两个节点的 padding 边界仍然重叠
        const penetrationX = (sa.width + sb.width) / 2 + padding - Math.abs(dx);
        const penetrationY = (sa.height + sb.height) / 2 + padding - Math.abs(dy);

        if (penetrationX <= 0 || penetrationY <= 0) continue;
        anyOverlap = true;

        // 沿较小 penetration 轴推开（移动量更小的方向）
        if (penetrationX < penetrationY) {
          let dir: number;
          if (dx === 0) { dir = a < b ? -1 : 1; }
          else { dir = dx > 0 ? 1 : -1; }
          positions[a].cx += dir * penetrationX / 2;
          positions[b].cx -= dir * penetrationX / 2;
        } else {
          let dir: number;
          if (dy === 0) { dir = a < b ? -1 : 1; }
          else { dir = dy > 0 ? 1 : -1; }
          positions[a].cy += dir * penetrationY / 2;
          positions[b].cy -= dir * penetrationY / 2;
        }
      }
    }
    if (!anyOverlap) break;
  }
}
