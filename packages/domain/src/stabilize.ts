import type { GraphNode, MergedGraph } from '@listen-graphic/schema';

function stabilizeNode(node: GraphNode): GraphNode {
  if (node.status === 'confirmed') return node;

  if ((node.confidence ?? 0) >= 0.85) {
    return { ...node, status: 'confirmed' };
  }

  return node;
}

export function stabilizeGraph(graph: MergedGraph): MergedGraph {
  return {
    ...graph,
    nodes: graph.nodes.map(stabilizeNode),
    updatedAt: Date.now(),
  };
}
