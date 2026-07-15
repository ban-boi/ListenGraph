import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { computeIncrementalLayout, createEmptyIncrementalState, computeAllNodeSizes } from './index';
import { partitionClusters } from './partition';
import type { MergedGraph, GraphNode, GraphEdge } from '@listen-graphic/schema';

/**
 * 等价性 + 确定性测试。
 *
 * 修复 B1/M1（review finding）：
 * - 旧实现读取 gitignored 的 tools/layout-lab/inputs/real-graphs-dump.json，
 *   新 clone / CI 必抛 ENOENT；且只断言 r1===r2（确定性），未对比 golden baseline，
 *   名为"等价性"实则没有验证提取后行为不变。
 * - 现改用 graph-fixtures 里 git 跟踪的合成 sequence（seq-late-burst 最终态，16 节点），
 *   并嵌入提取时录制的 golden positions 快照，精确对比每个节点坐标，
 *   一旦内核输出漂移即可捕获。
 */
const here = dirname(fileURLToPath(import.meta.url));
const seqPath = join(here, '../../../../packages/graph-fixtures/fixtures/sequences/seq-late-burst.json');
const seq = JSON.parse(readFileSync(seqPath, 'utf8')) as { steps: Array<{ graph: MergedGraph }> };
const graph = seq.steps[seq.steps.length - 1].graph;

/**
 * Golden positions：方案 1.5 首帧初始化器上线后重录（computeIncrementalLayout
 * 首帧改为调用 computeInitialClusterLayout，分簇纵向堆叠）。
 * seq-late-burst 最终态是单簇（16 节点全连通），故新首帧退化为单簇力导向，
 * 与旧"圆形初始化+内联力迭代"形态等价，仅坐标系原点因 CLUSTER_PADDING 归一化而偏移
 * （cx 差 ~22px、cy 整体下移 ~845px）。坐标圆整到 0.01px。
 * 任何内核改动若导致这些坐标漂移，测试会失败——改动合法时需显式更新此快照。
 */
const GOLDEN_POSITIONS: Record<string, { cx: number; cy: number }> = {
  n1: { cx: 326.05, cy: 992.98 },
  n2: { cx: 545.69, cy: 965.39 },
  n3: { cx: 467.05, cy: 1225.75 },
  n4: { cx: 542.08, cy: 1099.12 },
  n5: { cx: 270.65, cy: 1261.29 },
  n6: { cx: 154.69, cy: 1168.43 },
  n7: { cx: 350.14, cy: 1151.20 },
  n8: { cx: 100.76, cy: 1048.01 },
  n9: { cx: 339.03, cy: 824.94 },
  n10: { cx: 106.00, cy: 914.43 },
  n11: { cx: 149.03, cy: 793.36 },
  n12: { cx: 529.03, cy: 833.42 },
  n13: { cx: 376.47, cy: 673.62 },
  n14: { cx: 412.06, cy: 439.96 },
  n15: { cx: 443.12, cy: 232.29 },
  n16: { cx: 470.85, cy: 45.00 },
};

describe('R3b 等价性与确定性（合成 fixture + golden baseline）', () => {
  it('golden baseline：每个节点坐标与提取时录制的快照一致', () => {
    const sizes = computeAllNodeSizes(graph.nodes);
    const result = computeIncrementalLayout(graph, createEmptyIncrementalState(), 'R3b', sizes);

    // 每个节点都必须有 golden 记录且坐标精确匹配（容差 0.01px）
    for (const id of Object.keys(GOLDEN_POSITIONS)) {
      expect(result.positions[id], `节点 ${id} 应存在于输出`).toBeDefined();
      expect(result.positions[id].cx).toBeCloseTo(GOLDEN_POSITIONS[id].cx, 1);
      expect(result.positions[id].cy).toBeCloseTo(GOLDEN_POSITIONS[id].cy, 1);
    }
    // 输出不应多出未知节点
    expect(Object.keys(result.positions).sort()).toEqual(Object.keys(GOLDEN_POSITIONS).sort());
  });

  it('确定性：同一输入跑两次，positions 完全一致', () => {
    const sizes = computeAllNodeSizes(graph.nodes);
    const r1 = computeIncrementalLayout(graph, createEmptyIncrementalState(), 'R3b', sizes);
    const r2 = computeIncrementalLayout(graph, createEmptyIncrementalState(), 'R3b', sizes);

    for (const id of Object.keys(r1.positions)) {
      expect(r2.positions[id].cx).toBe(r1.positions[id].cx);
      expect(r2.positions[id].cy).toBe(r1.positions[id].cy);
    }
  });
});

// ---- 多簇根因修复断言（方案 1.5）----
// 直接锁住"多簇首帧不塌缩"这个根因修复：旧实现（圆形初始化）会让多簇挤成一坨重叠，
// 新首帧（computeInitialClusterLayout 纵向堆叠）应让不同簇的 Y 区间分离、0 物理重叠。
function makeMultiClusterGraph(components: number, nodesPerComp: number): MergedGraph {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  for (let c = 0; c < components; c++) {
    for (let i = 0; i < nodesPerComp; i++) {
      nodes.push({
        id: `c${c}n${i}`,
        type: 'claim',
        text: `节点 ${c}-${i} 的文本内容`,
        timestampMs: c * 1000 + i,
        status: 'confirmed',
      });
    }
    for (let i = 0; i < nodesPerComp - 1; i++) {
      edges.push({ id: `e-c${c}-${i}`, source: `c${c}n${i}`, target: `c${c}n${i + 1}`, type: 'supports' });
    }
  }
  return { sessionId: 'test-multi', revision: 0, nodes, edges, topics: [], updatedAt: 0 };
}

describe('R3b 多簇首帧不塌缩（根因修复回归保护）', () => {
  it('多簇首帧：computeIncrementalLayout 输出 0 物理重叠', () => {
    const g = makeMultiClusterGraph(5, 4);
    const sizes = computeAllNodeSizes(g.nodes);
    const result = computeIncrementalLayout(g, createEmptyIncrementalState(), 'R3b', sizes);
    // 物理重叠检测（AABB 相交）
    const ids = Object.keys(result.positions);
    let overlaps = 0;
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = result.positions[ids[i]], b = result.positions[ids[j]];
        const sa = sizes[ids[i]], sb = sizes[ids[j]];
        const ox = Math.abs(a.cx - b.cx) < (sa.width + sb.width) / 2;
        const oy = Math.abs(a.cy - b.cy) < (sa.height + sb.height) / 2;
        if (ox && oy) overlaps++;
      }
    }
    expect(overlaps, '多簇首帧不应有任何物理重叠（旧实现会塌缩）').toBe(0);
  });

  it('多簇首帧：不同簇的 Y 区间不重叠（簇间纵向堆叠有效）', () => {
    const g = makeMultiClusterGraph(4, 3);
    const sizes = computeAllNodeSizes(g.nodes);
    const result = computeIncrementalLayout(g, createEmptyIncrementalState(), 'R3b', sizes);
    const partition = partitionClusters(g);
    const ranges = partition.clusters.map((c) => {
      let top = Infinity, bottom = -Infinity;
      for (const id of c.nodeIds) {
        const p = result.positions[id], s = sizes[id];
        if (!p || !s) continue;
        top = Math.min(top, p.cy - s.height / 2);
        bottom = Math.max(bottom, p.cy + s.height / 2);
      }
      return { id: c.id, top, bottom };
    }).sort((a, b) => a.top - b.top);
    // 任意相邻簇之间应有正 gap（不塌缩）
    for (let i = 0; i < ranges.length - 1; i++) {
      const gap = ranges[i + 1].top - ranges[i].bottom;
      expect(gap, `簇 ${ranges[i].id} 与 ${ranges[i + 1].id} Y 区间不应重叠`).toBeGreaterThan(0);
    }
  });
});
