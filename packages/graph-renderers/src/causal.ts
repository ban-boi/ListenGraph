import type { MergedGraph } from '@listen-graphic/schema';
import type { RendererGraph, RendererNode, RendererEdge } from './types';

/**
 * 拓扑排序（Kahn 算法），带环检测和时间戳兜底。
 * 只考虑结构性边类型（causes, supports, example_of）构建依赖图。
 * follows 边不参与拓扑，因为它只是顺序关系而非结构关系。
 */
export function topologicalSort(
  nodes: RendererNode[],
  edges: RendererEdge[],
): RendererNode[] {
  if (nodes.length <= 1) return nodes;

  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const inDegree = new Map(nodes.map((n) => [n.id, 0]));

  const structuralEdgeTypes = new Set(['causes', 'supports', 'example_of']);
  const adjacency = new Map<string, string[]>();
  for (const node of nodes) {
    adjacency.set(node.id, []);
  }

  for (const edge of edges) {
    if (!structuralEdgeTypes.has(edge.relation)) continue;
    if (!nodeMap.has(edge.source) || !nodeMap.has(edge.target)) continue;
    adjacency.get(edge.source)!.push(edge.target);
    inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
  }

  // 入度为 0 的节点作为起始队列，按时间戳排序保证稳定
  const queue: string[] = nodes
    .filter((n) => (inDegree.get(n.id) ?? 0) === 0)
    .map((n) => n.id)
    .sort((a, b) => (nodeMap.get(a)?.timestampMs ?? 0) - (nodeMap.get(b)?.timestampMs ?? 0));

  const sorted: string[] = [];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);
    sorted.push(current);

    const neighbors = adjacency.get(current) ?? [];
    for (const neighbor of neighbors) {
      const newDegree = (inDegree.get(neighbor) ?? 1) - 1;
      inDegree.set(neighbor, newDegree);
      if (newDegree === 0 && !visited.has(neighbor)) {
        queue.push(neighbor);
      }
    }
    // 按时间戳排序队列保证稳定
    queue.sort(
      (a, b) => (nodeMap.get(a)?.timestampMs ?? 0) - (nodeMap.get(b)?.timestampMs ?? 0),
    );
  }

  // 环中的节点追加到末尾（按时间戳）
  const unvisited = nodes
    .filter((n) => !visited.has(n.id))
    .sort((a, b) => a.timestampMs - b.timestampMs);
  for (const node of unvisited) {
    sorted.push(node.id);
  }

  return sorted.map((id) => nodeMap.get(id)!).filter(Boolean);
}

export function toCausalRendererGraph(graph: MergedGraph): RendererGraph {
  const baseNodes: RendererNode[] = graph.nodes.map((n) => ({
    id: n.id,
    label: n.text,
    type: n.type,
    speaker: n.speaker,
    timestampMs: n.timestampMs,
    status: n.status,
  }));

  const baseEdges: RendererEdge[] = graph.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    relation: e.type,
  }));

  const sortedNodes = topologicalSort(baseNodes, baseEdges);

  return {
    viewType: 'causal',
    nodes: sortedNodes,
    edges: baseEdges,
  };
}
