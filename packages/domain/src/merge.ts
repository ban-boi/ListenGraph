import type { GraphEdge, GraphNode, MergedGraph, SegmentGraph } from '@listen-graphic/schema';
import { computeTextOverlap, normalizeText } from './normalize';

const NEAR_DUPLICATE_MAX_TIME_DELTA_MS = 30_000;
const NEAR_DUPLICATE_MIN_TEXT_LENGTH = 12;
const NEAR_DUPLICATE_OVERLAP_THRESHOLD = 0.82;
const NEAR_DUPLICATE_MIN_LENGTH_RATIO = 0.88;

function canCompareNode(a: GraphNode, b: GraphNode): boolean {
  if (a.type !== b.type) return false;
  if (a.speaker && b.speaker && a.speaker !== b.speaker) return false;
  return true;
}

function canExactlyMergeNode(a: GraphNode, b: GraphNode): boolean {
  if (!canCompareNode(a, b)) {
    return false;
  }

  return normalizeText(a.text) === normalizeText(b.text);
}

function canNearMergeNode(a: GraphNode, b: GraphNode): boolean {
  if (!canCompareNode(a, b) || a.type === 'question') {
    return false;
  }

  if (Math.abs(a.timestampMs - b.timestampMs) > NEAR_DUPLICATE_MAX_TIME_DELTA_MS) {
    return false;
  }

  const normalizedA = normalizeText(a.text);
  const normalizedB = normalizeText(b.text);
  if (
    normalizedA.length < NEAR_DUPLICATE_MIN_TEXT_LENGTH ||
    normalizedB.length < NEAR_DUPLICATE_MIN_TEXT_LENGTH
  ) {
    return false;
  }

  const minLength = Math.min(normalizedA.length, normalizedB.length);
  const maxLength = Math.max(normalizedA.length, normalizedB.length);
  if (minLength / maxLength < NEAR_DUPLICATE_MIN_LENGTH_RATIO) {
    return false;
  }

  return computeTextOverlap(a.text, b.text) >= NEAR_DUPLICATE_OVERLAP_THRESHOLD;
}

function mergeNodeMetadata(target: GraphNode, incoming: GraphNode) {
  target.confidence = Math.max(target.confidence ?? 0, incoming.confidence ?? 0);
  target.evidenceChunkIds = Array.from(
    new Set([...(target.evidenceChunkIds ?? []), ...(incoming.evidenceChunkIds ?? [])]),
  );
  target.timestampMs = Math.min(target.timestampMs, incoming.timestampMs);
  if (incoming.status === 'confirmed') {
    target.status = 'confirmed';
  }
}

function mergeNodes(prev: GraphNode[], next: GraphNode[]) {
  const result = [...prev];
  const nodeIdRemap = new Map<string, string>();

  for (const node of next) {
    const existing = result.find(
      (candidate) =>
        canExactlyMergeNode(candidate, node) || canNearMergeNode(candidate, node),
    );
    if (existing) {
      mergeNodeMetadata(existing, node);
      nodeIdRemap.set(node.id, existing.id);
    } else {
      result.push(node);
      nodeIdRemap.set(node.id, node.id);
    }
  }

  return {
    nodes: result,
    nodeIdRemap,
  };
}

function mergeEdges(params: {
  prev: GraphEdge[];
  next: GraphEdge[];
  nodeIdRemap: Map<string, string>;
  validNodeIds: Set<string>;
}): GraphEdge[] {
  const result: GraphEdge[] = [];

  for (const edge of [...params.prev, ...params.next]) {
    const rewrittenEdge = {
      ...edge,
      source: params.nodeIdRemap.get(edge.source) ?? edge.source,
      target: params.nodeIdRemap.get(edge.target) ?? edge.target,
    };

    if (
      rewrittenEdge.source === rewrittenEdge.target ||
      !params.validNodeIds.has(rewrittenEdge.source) ||
      !params.validNodeIds.has(rewrittenEdge.target)
    ) {
      continue;
    }

    const existing = result.find(
      (candidate) =>
        candidate.source === rewrittenEdge.source &&
        candidate.target === rewrittenEdge.target &&
        candidate.type === rewrittenEdge.type,
    );

    if (existing) {
      existing.confidence = Math.max(existing.confidence ?? 0, rewrittenEdge.confidence ?? 0);
      existing.evidenceChunkIds = Array.from(
        new Set([...(existing.evidenceChunkIds ?? []), ...(rewrittenEdge.evidenceChunkIds ?? [])]),
      );
    } else {
      result.push(rewrittenEdge);
    }
  }

  return result;
}

export function mergeSegmentGraph(prev: MergedGraph, next: SegmentGraph): MergedGraph {
  const mergedNodes = mergeNodes(prev.nodes, next.nodes);
  const validNodeIds = new Set(mergedNodes.nodes.map((node) => node.id));

  return {
    ...prev,
    revision: prev.revision + 1,
    nodes: mergedNodes.nodes,
    edges: mergeEdges({
      prev: prev.edges,
      next: next.edges,
      nodeIdRemap: mergedNodes.nodeIdRemap,
      validNodeIds,
    }),
    updatedAt: Date.now(),
  };
}
