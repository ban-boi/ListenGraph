import { describe, expect, it } from 'vitest';
import { computeIncrementalLayout, type IncrementalState } from './incremental-force';
import { computeAllNodeSizes } from './round3-types';
import type { MergedGraph } from '@listen-graphic/schema';

function makeGraph(nodes: string[], edges: Array<[string, string]>, ts: number[] = []): MergedGraph {
  return {
    sessionId: 's1', revision: 1, topics: [], updatedAt: 0,
    nodes: nodes.map((id, i) => ({
      id, type: 'claim' as const, text: id, timestampMs: ts[i] ?? i * 1000, status: 'confirmed' as const,
    })),
    edges: edges.map(([s, t], i) => ({ id: `e${i}`, source: s, target: t, type: 'supports' as const })),
  };
}

const emptyState = (): IncrementalState => ({ positions: {}, sizes: {}, clusterOrigins: {}, prevClusters: [] });

function run(graph: MergedGraph, state: IncrementalState) {
  return computeIncrementalLayout(graph, state, 'R3b', computeAllNodeSizes(graph.nodes));
}

describe('computeIncrementalLayout', () => {
  it('第一个 revision：所有节点有坐标', () => {
    const graph = makeGraph(['a', 'b', 'c'], [['a', 'b'], ['b', 'c']]);
    const result = run(graph, emptyState());
    expect(result.positions).toHaveProperty('a');
    expect(result.positions).toHaveProperty('b');
    expect(result.positions).toHaveProperty('c');
  });

  it('增量：旧节点硬固定（hard-pin）—— 位移 ≈ 0px', () => {
    // 修复 M2（review finding）：原断言 < 101px 引用已废弃的 MAX_DRIFT_LOOSE=100，
    // 但 incremental-force 已改为硬固定模式（mobility[old]=0，旧节点 0px 移动），
    // 真实漂移为 0。101px 上限宽松 ∞ 倍，任何把硬固定改回 drift clamp 的回归都测不出。
    // 现收紧到 0.5px（仅容忍 overlap resolution 的浮点噪声）。
    const graph1 = makeGraph(['a', 'b', 'c'], [['a', 'b'], ['b', 'c']], [0, 1000, 2000]);
    const result1 = run(graph1, emptyState());

    const graph2 = makeGraph(['a', 'b', 'c', 'd'], [['a', 'b'], ['b', 'c'], ['c', 'd']], [0, 1000, 2000, 3000]);
    const result2 = run(graph2, result1.state);

    for (const id of ['a', 'b', 'c']) {
      const p1 = result1.state.positions[id];
      const p2 = result2.state.positions[id];
      const dist = Math.hypot(p2.cx - p1.cx, p2.cy - p1.cy);
      expect(dist).toBeLessThan(0.5); // hard-pin：旧节点钉死，仅容忍浮点噪声
    }
  });

  it('新节点在邻居附近（< 500px）', () => {
    const graph1 = makeGraph(['a', 'b'], [['a', 'b']]);
    const result1 = run(graph1, emptyState());
    const graph2 = makeGraph(['a', 'b', 'c'], [['a', 'b'], ['b', 'c']]);
    const result2 = run(graph2, result1.state);

    const newPos = result2.positions['c'];
    const neighborPos = result2.positions['b'];
    const dist = Math.hypot(newPos.cx - neighborPos.cx, newPos.cy - neighborPos.cy);
    expect(dist).toBeLessThan(500);
  });

  it('统计：displacementStats 含 median/max/capHitRate', () => {
    const graph1 = makeGraph(['a', 'b', 'c'], [['a', 'b'], ['b', 'c']]);
    const result1 = run(graph1, emptyState());
    const graph2 = makeGraph(['a', 'b', 'c', 'd'], [['a', 'b'], ['b', 'c'], ['c', 'd']]);
    const result2 = run(graph2, result1.state);

    expect(result2.stats).toBeDefined();
    expect(result2.stats!.medianDisplacement).toBeGreaterThanOrEqual(0);
    expect(result2.stats!.maxDisplacement).toBeGreaterThanOrEqual(0);
    expect(result2.stats!.capHitRate).toBeGreaterThanOrEqual(0);
    expect(result2.stats!.capHitRate).toBeLessThanOrEqual(1);
  });

  it('第一个 revision stats 为 null', () => {
    const graph = makeGraph(['a', 'b'], [['a', 'b']]);
    const result = run(graph, emptyState());
    expect(result.stats).toBeNull();
  });
});
