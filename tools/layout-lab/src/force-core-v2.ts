import type { NodeSize } from './round3-types';
import { FORCE_PARAMS } from './round3-types';

export type CenterPos = { cx: number; cy: number };

// AABB 碰撞消除
// 沿中心偏移较大的轴推开（各推重叠量一半）；中心重合或偏移相等时沿 X 轴，按 id 字母序稳定方向
export function resolveOverlaps(
  positions: Record<string, CenterPos>,
  sizes: Record<string, NodeSize>,
  rounds: number = FORCE_PARAMS.OVERLAP_ROUNDS,
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

        const overlapX = (sa.width + sb.width) / 2 - Math.abs(dx);
        const overlapY = (sa.height + sb.height) / 2 - Math.abs(dy);

        if (overlapX <= 0 || overlapY <= 0) continue;
        anyOverlap = true;

        if (Math.abs(dy) > Math.abs(dx)) {
          let dir: number;
          if (dy === 0) {
            dir = a < b ? -1 : 1;
          } else {
            dir = dy > 0 ? 1 : -1;
          }
          positions[a].cy += dir * overlapY / 2;
          positions[b].cy -= dir * overlapY / 2;
        } else {
          let dir: number;
          if (dx === 0) {
            dir = a < b ? -1 : 1;
          } else {
            dir = dx > 0 ? 1 : -1;
          }
          positions[a].cx += dir * overlapX / 2;
          positions[b].cx -= dir * overlapX / 2;
        }
      }
    }
    if (!anyOverlap) break;
  }
}
