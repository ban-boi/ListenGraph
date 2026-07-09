import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { computeClusterLayoutA } from './cluster-layout';
import type { MergedGraph } from '@listen-graphic/schema';

const DUMP_PATH = path.resolve(import.meta.dirname, '../inputs/real-graphs-dump.json');

function loadGraph(index: number): MergedGraph {
  const dump = JSON.parse(fs.readFileSync(DUMP_PATH, 'utf8')) as MergedGraph[];
  return dump[index];
}

describe('computeClusterLayoutA', () => {
  it('大图 #49：major cluster 内节点有坐标，minor 节点为 looseNoteItem', () => {
    const graph = loadGraph(49);
    const model = computeClusterLayoutA(graph, 49);
    const fullNodes = model.items.filter((i) => i.kind === 'fullNode');
    const looseNotes = model.items.filter((i) => i.kind === 'looseNoteItem');
    expect(fullNodes.length + looseNotes.length).toBe(graph.nodes.length);
    expect(model.meta.candidate).toBe('A');
    expect(model.meta.clusterCount).toBeGreaterThan(0);
  });

  it('小图 #18：不伤害——所有节点有坐标', () => {
    const graph = loadGraph(18);
    const model = computeClusterLayoutA(graph, 18);
    const positioned = model.items.filter((i) => 'position' in i);
    expect(positioned.length).toBe(graph.nodes.length);
  });

  it('纯碎片图 #6：12 孤立节点进 loose-notes', () => {
    const graph = loadGraph(6);
    const model = computeClusterLayoutA(graph, 6);
    const looseNotes = model.items.filter((i) => i.kind === 'looseNoteItem');
    expect(looseNotes.length).toBe(12);
  });

  it('cluster bounds 不重叠', () => {
    const graph = loadGraph(41);
    const model = computeClusterLayoutA(graph, 41);
    for (let i = 0; i < model.clusters.length; i++) {
      for (let j = i + 1; j < model.clusters.length; j++) {
        const a = model.clusters[i].bounds;
        const b = model.clusters[j].bounds;
        const overlaps = !(
          a.x + a.width + 10 <= b.x ||
          b.x + b.width + 10 <= a.x ||
          a.y + a.height + 10 <= b.y ||
          b.y + b.height + 10 <= a.y
        );
        expect(overlaps).toBe(false);
      }
    }
  });

  it('row packing：多 cluster 超过 1200px 宽度时换行，换行后 cluster 不重叠', () => {
    // 构造 3 个大 major cluster，每个宽度约 500px（question 根 + claim 分支列 →
    // 触发 hierarchy 的 question-branches 模式，2 列布局），
    // 总宽 3 × 500 + gap > 1200 → 应换行。
    const nodes: string[] = [];
    const edges: Array<[string, string]> = [];
    for (let c = 0; c < 3; c++) {
      const q = `c${c}q`;
      nodes.push(q);
      for (let i = 0; i < 4; i++) {
        const b = `c${c}b${i}`;
        nodes.push(b);
        edges.push([q, b]);
      }
    }
    const graph: MergedGraph = {
      sessionId: 's1', revision: 1, topics: [], updatedAt: 0,
      nodes: nodes.map((id, i) => ({
        id,
        type: id.endsWith('q') ? ('question' as const) : ('claim' as const),
        text: id,
        timestampMs: i * 1000,
        status: 'confirmed' as const,
      })),
      edges: edges.map(([s, t], i) => ({ id: `e${i}`, source: s, target: t, type: 'supports' as const })),
    };
    const model = computeClusterLayoutA(graph, 0);
    expect(model.clusters.length).toBe(3);
    const yValues = model.clusters.map((c) => c.bounds.y);
    const hasWrap = yValues.some((y) => y !== yValues[0]);
    expect(hasWrap).toBe(true);
    for (let i = 0; i < model.clusters.length; i++) {
      for (let j = i + 1; j < model.clusters.length; j++) {
        const a = model.clusters[i].bounds;
        const b = model.clusters[j].bounds;
        const overlaps = !(
          a.x + a.width + 10 <= b.x ||
          b.x + b.width + 10 <= a.x ||
          a.y + a.height + 10 <= b.y ||
          b.y + b.height + 10 <= a.y
        );
        expect(overlaps).toBe(false);
      }
    }
  });
});
