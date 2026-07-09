import { describe, expect, it } from 'vitest';
import { partitionClusters } from './cluster-partition';
import type { MergedGraph } from '@listen-graphic/schema';

function makeGraph(nodes: string[], edges: Array<[string, string]>): MergedGraph {
  return {
    sessionId: 's1', revision: 1, topics: [], updatedAt: 0,
    nodes: nodes.map((id) => ({ id, type: 'claim' as const, text: id, timestampMs: 0, status: 'confirmed' as const })),
    edges: edges.map(([s, t], i) => ({ id: `e${i}`, source: s, target: t, type: 'supports' as const })),
  };
}

describe('partitionClusters', () => {
  it('两个连通子图 → 2 个分量', () => {
    const g = makeGraph(['a', 'b', 'c', 'd'], [['a', 'b'], ['c', 'd']]);
    const p = partitionClusters(g);
    expect(p.clusters.length).toBe(2);
  });

  it('self-loop 边不参与分量，节点保留为单节点 minor', () => {
    const g: MergedGraph = {
      sessionId: 's1', revision: 1, topics: [], updatedAt: 0,
      nodes: [{ id: 'a', type: 'claim', text: 'a', timestampMs: 0, status: 'confirmed' }],
      edges: [{ id: 'e1', source: 'a', target: 'a', type: 'supports' }],
    };
    const p = partitionClusters(g);
    expect(p.clusters.length).toBe(1);
    expect(p.clusters[0].nodeIds).toEqual(['a']);
    expect(p.selfLoopNodes).toContain('a');
  });

  it('dangling edge 不参与分量，进异常统计', () => {
    const g: MergedGraph = {
      sessionId: 's1', revision: 1, topics: [], updatedAt: 0,
      nodes: [{ id: 'a', type: 'claim', text: 'a', timestampMs: 0, status: 'confirmed' }],
      edges: [{ id: 'e1', source: 'a', target: 'ghost', type: 'supports' }],
    };
    const p = partitionClusters(g);
    expect(p.clusters.length).toBe(1);
    expect(p.clusters[0].nodeIds).toEqual(['a']);
    expect(p.danglingEdges.length).toBe(1);
  });

  it('major: nodeCount>=3', () => {
    const g = makeGraph(['a', 'b', 'c'], [['a', 'b'], ['b', 'c']]);
    const p = partitionClusters(g);
    expect(p.clusters[0].type).toBe('major');
  });

  it('minor: 1-2 节点少边', () => {
    const g = makeGraph(['a', 'b'], [['a', 'b']]);
    const p = partitionClusters(g);
    expect(p.clusters[0].type).toBe('minor');
  });

  it('保护规则：全图无 major 时最大 minor 升级为 major', () => {
    const g = makeGraph(['a', 'b', 'c', 'd'], [['a', 'b'], ['c', 'd']]);
    const p = partitionClusters(g);
    const majors = p.clusters.filter((c) => c.type === 'major');
    expect(majors.length).toBe(1);
  });

  it('孤立节点（无边）各自为单节点 minor', () => {
    const g = makeGraph(['a', 'b', 'c'], []);
    const p = partitionClusters(g);
    expect(p.clusters.length).toBe(3);
    expect(p.clusters.every((c) => c.type === 'minor')).toBe(true);
  });
});
