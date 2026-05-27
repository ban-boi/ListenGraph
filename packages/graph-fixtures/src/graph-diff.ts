import type { MergedGraph } from '@listen-graphic/schema';

export function getAddedNodeIds(previousGraph: MergedGraph | null, nextGraph: MergedGraph) {
  const previousNodeIds = new Set(previousGraph?.nodes.map((node) => node.id) ?? []);
  return nextGraph.nodes
    .filter((node) => !previousNodeIds.has(node.id))
    .map((node) => node.id);
}

export function getAutoRevealAnchorNodeIds(params: {
  addedNodeIds: string[];
  previousGraph: MergedGraph | null;
  nextGraph: MergedGraph;
}) {
  if (!params.addedNodeIds.length) {
    return [];
  }

  const previousNodeIds = new Set(params.previousGraph?.nodes.map((node) => node.id) ?? []);
  const addedNodeSet = new Set(params.addedNodeIds);
  const anchorIds = new Set<string>();

  for (const edge of params.nextGraph.edges) {
    if (addedNodeSet.has(edge.source) && previousNodeIds.has(edge.target)) {
      anchorIds.add(edge.target);
    }
    if (addedNodeSet.has(edge.target) && previousNodeIds.has(edge.source)) {
      anchorIds.add(edge.source);
    }
  }

  return Array.from(anchorIds);
}
