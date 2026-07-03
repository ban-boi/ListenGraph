import type { MergedGraph, NodeType, GraphEdge } from '@listen-graphic/schema';
import { LONG_LABEL_THRESHOLD, type StructureMetrics } from './types';

// 并查集：无向连通分量
class UnionFind {
  private parent = new Map<string, string>();
  private rank = new Map<string, number>();

  add(id: string) {
    if (!this.parent.has(id)) {
      this.parent.set(id, id);
      this.rank.set(id, 0);
    }
  }

  find(id: string): string {
    let root = id;
    while (this.parent.get(root) !== root) {
      root = this.parent.get(root)!;
    }
    // 路径压缩
    let cur = id;
    while (this.parent.get(cur) !== root) {
      const next = this.parent.get(cur)!;
      this.parent.set(cur, root);
      cur = next;
    }
    return root;
  }

  union(a: string, b: string) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return;
    const rankA = this.rank.get(ra)!;
    const rankB = this.rank.get(rb)!;
    if (rankA < rankB) this.parent.set(ra, rb);
    else if (rankA > rankB) this.parent.set(rb, ra);
    else {
      this.parent.set(rb, ra);
      this.rank.set(ra, rankA + 1);
    }
  }

  componentCount(): number {
    const roots = new Set<string>();
    for (const id of this.parent.keys()) roots.add(this.find(id));
    return roots.size;
  }

  largestComponentSize(): number {
    const sizes = new Map<string, number>();
    for (const id of this.parent.keys()) {
      const r = this.find(id);
      sizes.set(r, (sizes.get(r) ?? 0) + 1);
    }
    return Math.max(0, ...sizes.values());
  }
}

export function computeMetrics(graph: MergedGraph): StructureMetrics {
  const nodes = graph.nodes ?? [];
  const edges = graph.edges ?? [];
  const nodeCount = nodes.length;
  const edgeCount = edges.length;

  // 类型分布
  const nodeTypeCounts: Partial<Record<NodeType, number>> = {};
  for (const n of nodes) {
    nodeTypeCounts[n.type] = (nodeTypeCounts[n.type] ?? 0) + 1;
  }
  const edgeTypeCounts: Partial<Record<GraphEdge['type'], number>> = {};
  for (const e of edges) {
    edgeTypeCounts[e.type] = (edgeTypeCounts[e.type] ?? 0) + 1;
  }

  // 对立信号
  const opposesCount = edgeTypeCounts['opposes'] ?? 0;

  // speaker
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const speakerCounts: Record<string, number> = {};
  for (const n of nodes) {
    if (n.speaker) speakerCounts[n.speaker] = (speakerCounts[n.speaker] ?? 0) + 1;
  }

  const isCrossSpeaker = (e: GraphEdge): boolean => {
    const s = nodeById.get(e.source)?.speaker;
    const t = nodeById.get(e.target)?.speaker;
    return Boolean(s && t && s !== t);
  };
  const crossSpeakerEdgeCount = edges.filter(isCrossSpeaker).length;
  const opposesCrossSpeakerCount = edges.filter(
    (e) => e.type === 'opposes' && isCrossSpeaker(e),
  ).length;

  // 连通性（无向）
  const uf = new UnionFind();
  for (const n of nodes) uf.add(n.id);
  for (const e of edges) {
    if (nodeById.has(e.source) && nodeById.has(e.target)) uf.union(e.source, e.target);
  }

  // 度
  const outDeg = new Map<string, number>();
  const inDeg = new Map<string, number>();
  for (const e of edges) {
    outDeg.set(e.source, (outDeg.get(e.source) ?? 0) + 1);
    inDeg.set(e.target, (inDeg.get(e.target) ?? 0) + 1);
  }
  let maxOutDegree = 0;
  let maxOutDegreeNodeId: string | null = null;
  for (const [id, d] of outDeg) {
    if (d > maxOutDegree) {
      maxOutDegree = d;
      maxOutDegreeNodeId = id;
    }
  }
  let maxInDegree = 0;
  let maxInDegreeNodeId: string | null = null;
  for (const [id, d] of inDeg) {
    if (d > maxInDegree) {
      maxInDegree = d;
      maxInDegreeNodeId = id;
    }
  }

  // 时间跨度
  const timestamps = nodes.map((n) => n.timestampMs);
  const spanMs = timestamps.length > 0 ? Math.max(...timestamps) - Math.min(...timestamps) : 0;

  // 长标签
  const longLabelNodeCount = nodes.filter((n) => n.text.length > LONG_LABEL_THRESHOLD).length;

  // 除零规则：分母 0 → null（见 spec 3.4）
  const safeDiv = (num: number, den: number): number | null =>
    den === 0 ? null : num / den;

  return {
    nodeCount,
    edgeCount,
    isLargeGraph: nodeCount >= 10,
    nodeTypeCounts,
    edgeTypeCounts,
    opposesCount,
    opposesRatio: safeDiv(opposesCount, edgeCount),
    connectedComponents: nodeCount === 0 ? 0 : uf.componentCount(),
    largestComponentRatio: safeDiv(uf.largestComponentSize(), nodeCount),
    maxOutDegree,
    maxOutDegreeNodeId,
    maxInDegree,
    maxInDegreeNodeId,
    avgDegree: safeDiv(2 * edgeCount, nodeCount),
    spanMs,
    speakerCounts,
    crossSpeakerEdgeRatio: safeDiv(crossSpeakerEdgeCount, edgeCount),
    opposesCrossSpeakerRatio: safeDiv(opposesCrossSpeakerCount, opposesCount),
    longLabelNodeCount,
  };
}
