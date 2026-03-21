import type { GraphEdge, GraphNode, MergedGraph, SegmentGraph } from '@listen-graphic/schema';
import { normalizeText } from './normalize';

function canMergeNode(a: GraphNode, b: GraphNode): boolean {
  if (a.type !== b.type) return false;
  if (a.speaker && b.speaker && a.speaker !== b.speaker) return false;

  return normalizeText(a.text) === normalizeText(b.text);
}

function mergeNodes(prev: GraphNode[], next: GraphNode[]): GraphNode[] {
  const result = [...prev];

  for (const node of next) {
    const existing = result.find((n) => canMergeNode(n, node));
    if (existing) {
      existing.confidence = Math.max(existing.confidence ?? 0, node.confidence ?? 0);
      existing.evidenceChunkIds = Array.from(
        new Set([...(existing.evidenceChunkIds ?? []), ...(node.evidenceChunkIds ?? [])]),
      );
    } else {
      result.push(node);
    }
  }

  return result;
}

function mergeEdges(prev: GraphEdge[], next: GraphEdge[]): GraphEdge[] {
  const result = [...prev];

  for (const edge of next) {
    const existing = result.find(
      (e) => e.source === edge.source && e.target === edge.target && e.type === edge.type,
    );

    if (existing) {
      existing.confidence = Math.max(existing.confidence ?? 0, edge.confidence ?? 0);
      existing.evidenceChunkIds = Array.from(
        new Set([...(existing.evidenceChunkIds ?? []), ...(edge.evidenceChunkIds ?? [])]),
      );
    } else {
      result.push(edge);
    }
  }

  return result;
}

export function mergeSegmentGraph(prev: MergedGraph, next: SegmentGraph): MergedGraph {
  return {
    ...prev,
    revision: prev.revision + 1,
    nodes: mergeNodes(prev.nodes, next.nodes),
    edges: mergeEdges(prev.edges, next.edges),
    updatedAt: Date.now(),
  };
}
