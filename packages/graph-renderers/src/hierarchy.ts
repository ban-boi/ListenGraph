import type { MergedGraph } from '@listen-graphic/schema';
import type { RendererGraph } from './types';

/**
 * 层级框架视图渲染器
 * 树状排布，claim 为主干，reason/example 挂载，适合分类式讲解
 */
export function toHierarchyRendererGraph(graph: MergedGraph): RendererGraph {
  // 按节点类型分组排序：claim > conclusion > reason > example > question
  const typeOrder: Record<string, number> = {
    claim: 0,
    conclusion: 1,
    reason: 2,
    example: 3,
    question: 4,
  };

  const sortedNodes = [...graph.nodes].sort((a, b) => {
    const orderA = typeOrder[a.type] ?? 5;
    const orderB = typeOrder[b.type] ?? 5;
    if (orderA !== orderB) return orderA - orderB;
    return a.timestampMs - b.timestampMs;
  });

  return {
    viewType: 'hierarchy',
    nodes: sortedNodes.map((n) => ({
      id: n.id,
      label: n.text,
      type: n.type,
      speaker: n.speaker,
      timestampMs: n.timestampMs,
      status: n.status,
    })),
    edges: graph.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      relation: e.type,
    })),
  };
}
