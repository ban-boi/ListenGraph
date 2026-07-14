import type { MergedGraph, EdgeType } from '@listen-graphic/schema';
import type { ClusterPartition } from './types';

// 并查集（复用第一轮 metrics.ts 的实现模式）
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
}

export function partitionClusters(graph: MergedGraph): ClusterPartition {
  const nodes = graph.nodes ?? [];
  const edges = graph.edges ?? [];
  const nodeIds = new Set(nodes.map((n) => n.id));

  const uf = new UnionFind();
  for (const n of nodes) uf.add(n.id);

  const danglingEdges: Array<{ source: string; target: string; type: EdgeType }> = [];
  const selfLoopNodes = new Set<string>();

  for (const e of edges) {
    if (e.source === e.target) {
      selfLoopNodes.add(e.source);
      continue;
    }
    if (!nodeIds.has(e.source) || !nodeIds.has(e.target)) {
      danglingEdges.push({ source: e.source, target: e.target, type: e.type });
      continue;
    }
    uf.union(e.source, e.target);
  }

  // 按 root 分组节点
  const groups = new Map<string, string[]>();
  for (const n of nodes) {
    const root = uf.find(n.id);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root)!.push(n.id);
  }

  // 分 major / minor
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  let clusters = Array.from(groups.entries()).map(([root, clusterNodeIds], i) => {
    const clusterEdges = edges.filter(
      (e) =>
        e.source !== e.target &&
        clusterNodeIds.includes(e.source) &&
        clusterNodeIds.includes(e.target),
    );
    const edgeCount = clusterEdges.length;
    const deg = new Map<string, number>();
    for (const e of clusterEdges) {
      deg.set(e.source, (deg.get(e.source) ?? 0) + 1);
      deg.set(e.target, (deg.get(e.target) ?? 0) + 1);
    }
    const maxDegree = Math.max(0, ...deg.values());
    const isMajor = clusterNodeIds.length >= 3 || edgeCount >= 2 || maxDegree >= 2;
    return {
      id: `cluster_${i}`,
      nodeIds: clusterNodeIds,
      edges: clusterEdges.map((e) => ({ source: e.source, target: e.target, type: e.type })),
      type: (isMajor ? 'major' : 'minor') as 'major' | 'minor',
    };
  });

  // 保护规则：全图无 major 时，最大的 minor 升级为 major。
  // 仅当存在 ≥2 个分量且至少一个分量含边时才升级——否则唯一的平凡分量或全孤立节点
  // 不应被强制提升（参见测试 minor/孤立节点 用例）。
  const hasMajor = clusters.some((c) => c.type === 'major');
  const promotionMeaningful =
    clusters.length >= 2 && clusters.some((c) => c.edges.length > 0);
  if (!hasMajor && promotionMeaningful) {
    const largest = clusters.reduce((a, b) => (a.nodeIds.length >= b.nodeIds.length ? a : b));
    largest.type = 'major';
  }

  // 排序：major 优先，然后按 nodeCount 降序，最后按最早 timestamp
  clusters.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'major' ? -1 : 1;
    if (a.nodeIds.length !== b.nodeIds.length) return b.nodeIds.length - a.nodeIds.length;
    if (a.edges.length !== b.edges.length) return b.edges.length - a.edges.length;
    const aMin = Math.min(...a.nodeIds.map((id) => nodeById.get(id)?.timestampMs ?? 0));
    const bMin = Math.min(...b.nodeIds.map((id) => nodeById.get(id)?.timestampMs ?? 0));
    return aMin - bMin;
  });

  return { clusters, danglingEdges, selfLoopNodes: Array.from(selfLoopNodes) };
}
