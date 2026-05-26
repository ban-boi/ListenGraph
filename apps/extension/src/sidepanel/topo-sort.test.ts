import { describe, it, expect } from 'vitest';
import { topologicalSort } from '@listen-graphic/graph-renderers';
import type { RendererNode, RendererEdge } from '@listen-graphic/graph-renderers';

function n(id: string, ms: number): RendererNode {
  return { id, label: id, type: 'claim', speaker: undefined, timestampMs: ms, status: 'draft' };
}

function e(source: string, target: string, relation: RendererEdge['relation'] = 'supports'): RendererEdge {
  return { id: `e-${source}-${target}`, source, target, relation };
}

describe('topologicalSort', () => {
  it('空节点返回空数组', () => {
    expect(topologicalSort([], [])).toEqual([]);
  });

  it('单个节点无边', () => {
    const nodes = [n('a', 0)];
    expect(topologicalSort(nodes, []).map((nd) => nd.id)).toEqual(['a']);
  });

  it('线性链 A→B→C 按拓扑序排列', () => {
    const nodes = [n('c', 2000), n('a', 0), n('b', 1000)];
    const edges = [e('a', 'b', 'causes'), e('b', 'c', 'causes')];
    expect(topologicalSort(nodes, edges).map((nd) => nd.id)).toEqual(['a', 'b', 'c']);
  });

  it('无连接的节点按时间戳排列', () => {
    const nodes = [n('c', 2000), n('a', 0)];
    expect(topologicalSort(nodes, []).map((nd) => nd.id)).toEqual(['a', 'c']);
  });

  it('有环时按时间戳兜底（不无限循环）', () => {
    const nodes = [n('a', 0), n('b', 1000)];
    const edges = [e('a', 'b', 'supports'), e('b', 'a', 'supports')];
    const result = topologicalSort(nodes, edges);
    expect(result).toHaveLength(2);
    expect(result.map((nd) => nd.id)).toEqual(['a', 'b']);
  });

  it('忽略 follows 边（不参与拓扑）', () => {
    const nodes = [n('a', 0), n('b', 1000)];
    const edges = [e('a', 'b', 'follows')];
    expect(topologicalSort(nodes, edges).map((nd) => nd.id)).toEqual(['a', 'b']);
  });

  it('钻石形依赖 A→B, A→C, B→D, C→D', () => {
    const nodes = [n('d', 3000), n('b', 1000), n('a', 0), n('c', 2000)];
    const edges = [e('a', 'b'), e('a', 'c'), e('b', 'd'), e('c', 'd')];
    const result = topologicalSort(nodes, edges).map((nd) => nd.id);
    expect(result[0]).toBe('a');
    expect(result[3]).toBe('d');
    expect(result).toContain('b');
    expect(result).toContain('c');
  });
});
