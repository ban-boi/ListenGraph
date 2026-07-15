import { describe, expect, it } from 'vitest';
import type { MergedGraph, GraphNode, GraphEdge } from '@listen-graphic/schema';

import { computeInitialClusterLayout, CLUSTER_GAP } from './cluster-force';
import { computeAllNodeSizes } from './node-size';

// 构造合成图：k 个连通分量，每分量 n 个节点链式相连
function makeMultiClusterGraph(components: number, nodesPerComp: number): MergedGraph {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  for (let c = 0; c < components; c++) {
    for (let i = 0; i < nodesPerComp; i++) {
      const id = `c${c}n${i}`;
      nodes.push({
        id,
        type: 'claim',
        text: `节点 ${c}-${i} 的文本内容`,
        timestampMs: c * 1000 + i,
        status: 'confirmed',
      });
    }
    // 簇内链式边（使每分量成为 1 个连通分量）
    for (let i = 0; i < nodesPerComp - 1; i++) {
      edges.push({
        id: `e-c${c}-${i}`,
        source: `c${c}n${i}`,
        target: `c${c}n${i + 1}`,
        type: 'supports',
      });
    }
  }
  return { sessionId: 'test-multi', revision: 0, nodes, edges, topics: [], updatedAt: 0 };
}

// 统计物理重叠对数（AABB 相交，无 padding）
function countOverlaps(
  positions: Record<string, { cx: number; cy: number }>,
  sizes: Record<string, { width: number; height: number }>,
): number {
  const ids = Object.keys(positions);
  let n = 0;
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = positions[ids[i]], b = positions[ids[j]];
      const sa = sizes[ids[i]], sb = sizes[ids[j]];
      if (!a || !b || !sa || !sb) continue;
      const ox = Math.abs(a.cx - b.cx) < (sa.width + sb.width) / 2;
      const oy = Math.abs(a.cy - b.cy) < (sa.height + sb.height) / 2;
      if (ox && oy) n++;
    }
  }
  return n;
}

// 每个簇的 Y 区间 [min cy-h/2, max cy+h/2]
function clusterYRanges(
  positions: Record<string, { cx: number; cy: number }>,
  sizes: Record<string, { width: number; height: number }>,
  clusters: Array<{ id: string; nodeIds: string[] }>,
): Array<{ id: string; top: number; bottom: number }> {
  return clusters.map((c) => {
    let top = Infinity, bottom = -Infinity;
    for (const id of c.nodeIds) {
      const p = positions[id], s = sizes[id];
      if (!p || !s) continue;
      top = Math.min(top, p.cy - s.height / 2);
      bottom = Math.max(bottom, p.cy + s.height / 2);
    }
    return { id: c.id, top, bottom };
  });
}

describe('computeInitialClusterLayout', () => {
  it('所有节点都有坐标', () => {
    const g = makeMultiClusterGraph(3, 4);
    const sizes = computeAllNodeSizes(g.nodes);
    const out = computeInitialClusterLayout(g, sizes);
    for (const n of g.nodes) {
      expect(out.positions[n.id], `节点 ${n.id} 应有坐标`).toBeDefined();
    }
  });

  it('多簇：首帧 0 物理重叠（根因修复——旧实现会塌缩成一坨）', () => {
    const g = makeMultiClusterGraph(5, 4); // 5 个簇 × 4 节点
    const sizes = computeAllNodeSizes(g.nodes);
    const out = computeInitialClusterLayout(g, sizes);
    const overlaps = countOverlaps(out.positions, sizes);
    expect(overlaps, '多簇首帧不应有任何物理重叠').toBe(0);
  });

  it('多簇：不同簇的 Y 区间不重叠（簇间纵向堆叠不塌缩）', () => {
    const g = makeMultiClusterGraph(4, 3);
    const sizes = computeAllNodeSizes(g.nodes);
    const out = computeInitialClusterLayout(g, sizes);
    const ranges = clusterYRanges(out.positions, sizes, out.clusters);
    // 任意两簇 Y 区间应有 gap
    for (let i = 0; i < ranges.length; i++) {
      for (let j = i + 1; j < ranges.length; j++) {
        const a = ranges[i], b = ranges[j];
        const gap = Math.max(a.bottom, b.bottom) - Math.min(a.top, b.top)
          - (Math.abs(a.bottom - a.top) + Math.abs(b.bottom - b.top));
        // 簇间净间距应 ≥ CLUSTER_GAP * 2 - 安全余量
        expect(gap, `簇 ${a.id} 与 ${b.id} 的 Y 区间不应重叠`).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('多簇：相邻簇间净距 ≥ CLUSTER_GAP（双倍 gap 保证 ≥64px）', () => {
    const g = makeMultiClusterGraph(4, 3);
    const sizes = computeAllNodeSizes(g.nodes);
    const out = computeInitialClusterLayout(g, sizes);
    const ranges = clusterYRanges(out.positions, sizes, out.clusters).sort((a, b) => a.top - b.top);
    for (let i = 0; i < ranges.length - 1; i++) {
      const gap = ranges[i + 1].top - ranges[i].bottom;
      expect(gap, `相邻簇 ${ranges[i].id}→${ranges[i + 1].id} 净距应 ≥ CLUSTER_GAP(${CLUSTER_GAP})`).toBeGreaterThanOrEqual(CLUSTER_GAP);
    }
  });

  it('单簇：退化为单一力导向布局，仍有坐标且 clusterOrigins 单条', () => {
    const g = makeMultiClusterGraph(1, 5);
    const sizes = computeAllNodeSizes(g.nodes);
    const out = computeInitialClusterLayout(g, sizes);
    expect(out.clusters.length).toBe(1);
    expect(Object.keys(out.clusterOrigins).length).toBe(1);
    for (const n of g.nodes) {
      expect(out.positions[n.id]).toBeDefined();
    }
  });

  it('clusterOrigins 反映真实纵向堆叠（后续簇 origin.y 递增）', () => {
    const g = makeMultiClusterGraph(4, 3);
    const sizes = computeAllNodeSizes(g.nodes);
    const out = computeInitialClusterLayout(g, sizes);
    const origins = out.clusters
      .map((c) => out.clusterOrigins[c.id])
      .filter(Boolean)
      .sort((a, b) => a.y - b.y);
    for (let i = 1; i < origins.length; i++) {
      expect(origins[i].y, '后续簇 origin.y 应严格大于前簇').toBeGreaterThan(origins[i - 1].y);
    }
  });

  it('确定性：同输入两次跑结果完全一致', () => {
    const g = makeMultiClusterGraph(3, 4);
    const sizes = computeAllNodeSizes(g.nodes);
    const r1 = computeInitialClusterLayout(g, sizes);
    const r2 = computeInitialClusterLayout(g, sizes);
    for (const id of Object.keys(r1.positions)) {
      expect(r2.positions[id].cx).toBe(r1.positions[id].cx);
      expect(r2.positions[id].cy).toBe(r1.positions[id].cy);
    }
  });
});
