import type { MergedGraph, GraphNode, GraphEdge, EdgeType } from '@listen-graphic/schema';
import { partitionClusters } from './partition';
import { resolveOverlaps, type CenterPos } from './force-core';
import {
  FORCE_PARAMS, GRAVITY_STRENGTH, PENALTY_STRENGTH, TARGET_WIDTH,
  type NodeSize,
} from './node-size';

// r3b 内部类型（从 round2-types 提取的子集）
export type Position = { x: number; y: number };
export type RenderItem =
  | { kind: 'fullNode'; nodeId: string; position: Position }
  | { kind: 'looseNoteItem'; nodeId: string; position: Position }
  | { kind: 'clusterSummary'; clusterId: string; position: Position; nodeCount: number; edgeCount: number };
export type RenderEdge = { source: string; target: string; type: EdgeType };
export type ClusterInfo = { id: string; type: 'major' | 'minor'; nodeIds: string[]; bounds: { x: number; y: number; width: number; height: number } };
export type RenderModel = { items: RenderItem[]; edges: RenderEdge[]; clusters: ClusterInfo[]; meta: { candidate: string; graphIndex: number; nodeCount: number; edgeCount: number; clusterCount: number; majorCount: number; minorCount: number } };

export const CLUSTER_GAP = 60;
export const CLUSTER_PADDING = 16;
const LOOSE_NOTE_ITEM_HEIGHT = 32;
const LOOSE_NOTE_ITEM_WIDTH = 200;

const STRUCTURAL_TYPES = new Set<EdgeType>(['causes', 'supports', 'example_of', 'follows', 'opposes']);

// 簇内力导向（面积斥力 + spring + 竖向约束 + resolveOverlaps）
// 坐标语义：内部使用中心点 (cx, cy)，渲染时转 top-left
function layoutClusterForce(
  nodes: GraphNode[],
  edges: GraphEdge[],
  sizes: Record<string, NodeSize>,
  variant: 'R3a' | 'R3b',
): Record<string, CenterPos> {
  if (nodes.length === 0) return {};
  if (nodes.length === 1) return { [nodes[0].id]: { cx: TARGET_WIDTH / 2, cy: 0 } };

  const nodeIds = new Set(nodes.map((n) => n.id));
  const edgeList: Array<{ source: string; target: string }> = [];
  for (const e of edges) {
    if (!STRUCTURAL_TYPES.has(e.type)) continue;
    if (!nodeIds.has(e.source) || !nodeIds.has(e.target)) continue;
    if (e.source === e.target) continue;
    edgeList.push({ source: e.source, target: e.target });
  }

  // 初始位置：圆形
  const positions: Record<string, CenterPos> = {};
  const radius = Math.max(200, nodes.length * 15);
  nodes.forEach((n, i) => {
    const angle = (i / nodes.length) * Math.PI * 2;
    positions[n.id] = {
      cx: Math.cos(angle) * radius + (i % 3) * 10,
      cy: Math.sin(angle) * radius + (i % 3) * 10,
    };
  });

  const { REPULSION_K, SPRING_LENGTH, SPRING_K, DAMPING, MAX_DISPLACEMENT, ITERATIONS } = FORCE_PARAMS;
  const velocities: Record<string, { x: number; y: number }> = {};
  for (const n of nodes) velocities[n.id] = { x: 0, y: 0 };

  for (let iter = 0; iter < ITERATIONS; iter++) {
    const forces: Record<string, { x: number; y: number }> = {};
    for (const n of nodes) forces[n.id] = { x: 0, y: 0 };

    // 面积斥力
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i], b = nodes[j];
        const dx = positions[a.id].cx - positions[b.id].cx;
        const dy = positions[a.id].cy - positions[b.id].cy;
        let dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 1) dist = 1;
        const areaA = sizes[a.id].width * sizes[a.id].height;
        const areaB = sizes[b.id].width * sizes[b.id].height;
        const repulsion = REPULSION_K * Math.sqrt(areaA * areaB) / (dist * dist);
        forces[a.id].x += (dx / dist) * repulsion;
        forces[a.id].y += (dy / dist) * repulsion;
        forces[b.id].x -= (dx / dist) * repulsion;
        forces[b.id].y -= (dy / dist) * repulsion;
      }
    }

    // Spring attraction
    for (const edge of edgeList) {
      const dx = positions[edge.target].cx - positions[edge.source].cx;
      const dy = positions[edge.target].cy - positions[edge.source].cy;
      let dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 1) dist = 1;
      const force = SPRING_K * (dist - SPRING_LENGTH);
      forces[edge.source].x += (dx / dist) * force;
      forces[edge.source].y += (dy / dist) * force;
      forces[edge.target].x -= (dx / dist) * force;
      forces[edge.target].y -= (dy / dist) * force;
    }

    // 竖向约束力
    if (variant === 'R3a') {
      const centerX = TARGET_WIDTH / 2;
      for (const n of nodes) {
        forces[n.id].x += (centerX - positions[n.id].cx) * GRAVITY_STRENGTH;
      }
    } else {
      // R3b: soft width penalty（按矩形边界）
      for (const n of nodes) {
        const w = sizes[n.id].width;
        const cx = positions[n.id].cx;
        const leftOvershoot = Math.max(0, w / 2 - cx);
        const rightOvershoot = Math.max(0, cx + w / 2 - TARGET_WIDTH);
        forces[n.id].x += leftOvershoot * PENALTY_STRENGTH - rightOvershoot * PENALTY_STRENGTH;
      }
    }

    // Apply
    for (const n of nodes) {
      velocities[n.id].x = (velocities[n.id].x + forces[n.id].x) * DAMPING;
      velocities[n.id].y = (velocities[n.id].y + forces[n.id].y) * DAMPING;
      positions[n.id].cx += Math.max(-MAX_DISPLACEMENT, Math.min(MAX_DISPLACEMENT, velocities[n.id].x));
      positions[n.id].cy += Math.max(-MAX_DISPLACEMENT, Math.min(MAX_DISPLACEMENT, velocities[n.id].y));
    }
  }

  // 碰撞消除后处理
  resolveOverlaps(positions, sizes);

  return positions;
}

// center → top-left 转换
function centerToTopLeft(pos: CenterPos, size: NodeSize): Position {
  return { x: pos.cx - size.width / 2, y: pos.cy - size.height / 2 };
}

export function computeClusterForceLayout(
  graph: MergedGraph,
  graphIndex: number,
  variant: 'R3a' | 'R3b',
  sizes: Record<string, NodeSize>,
): RenderModel {
  const partition = partitionClusters(graph);
  const items: RenderItem[] = [];
  const edges: RenderEdge[] = [];
  const clusters: ClusterInfo[] = [];

  let currentY = 0;

  for (const cluster of partition.clusters) {
    const clusterNodes = graph.nodes.filter((n) => cluster.nodeIds.includes(n.id));
    const clusterEdges = graph.edges.filter(
      (e) => cluster.nodeIds.includes(e.source) && cluster.nodeIds.includes(e.target) && e.source !== e.target,
    );
    const clusterSizes: Record<string, NodeSize> = {};
    for (const id of cluster.nodeIds) clusterSizes[id] = sizes[id];

    let localItems: RenderItem[] = [];
    let localWidth = 0;
    let localHeight = 0;

    if (cluster.type === 'major') {
      const centerPositions = layoutClusterForce(clusterNodes, clusterEdges, clusterSizes, variant);

      localItems = cluster.nodeIds
        .filter((id) => centerPositions[id])
        .map((id) => ({
          kind: 'fullNode' as const,
          nodeId: id,
          position: centerToTopLeft(centerPositions[id], clusterSizes[id]),
        }));

      for (const e of clusterEdges) {
        if (centerPositions[e.source] && centerPositions[e.target]) {
          edges.push({ source: e.source, target: e.target, type: e.type });
        }
      }
    } else {
      const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
      const sorted = [...cluster.nodeIds].sort((a, b) => {
        return (nodeById.get(a)?.timestampMs ?? 0) - (nodeById.get(b)?.timestampMs ?? 0);
      });
      sorted.forEach((id, i) => {
        localItems.push({
          kind: 'looseNoteItem' as const,
          nodeId: id,
          position: { x: 0, y: i * LOOSE_NOTE_ITEM_HEIGHT },
        });
      });
    }

    if (localItems.length === 0) {
      localItems.push({
        kind: 'fullNode' as const,
        nodeId: cluster.nodeIds[0],
        position: { x: 0, y: 0 },
      });
    }

    // 用实际节点 left/top/right/bottom 算 local bounds（修正：之前用近似公式导致 bounds 没包住节点）
    let localMinX = Infinity, localMinY = Infinity, localMaxX = 0, localMaxY = 0;
    for (const item of localItems) {
      if (item.kind === 'fullNode' || item.kind === 'looseNoteItem') {
        const size = cluster.type === 'major'
          ? clusterSizes[item.nodeId] ?? { width: 200, height: 100 }
          : { width: LOOSE_NOTE_ITEM_WIDTH, height: LOOSE_NOTE_ITEM_HEIGHT };
        localMinX = Math.min(localMinX, item.position.x);
        localMinY = Math.min(localMinY, item.position.y);
        localMaxX = Math.max(localMaxX, item.position.x + size.width);
        localMaxY = Math.max(localMaxY, item.position.y + size.height);
      }
    }
    if (localMinX === Infinity) { localMinX = 0; localMinY = 0; }

    // 归一化 local 坐标到 0,0 起点（用模块级 CLUSTER_PADDING）
    for (const item of localItems) {
      if ('position' in item) {
        item.position.x = item.position.x - localMinX + CLUSTER_PADDING;
        item.position.y = item.position.y - localMinY + CLUSTER_PADDING;
      }
    }
    localWidth = (localMaxX - localMinX) + CLUSTER_PADDING * 2;
    localHeight = (localMaxY - localMinY) + CLUSTER_PADDING * 2;

    // 外层 placement：major 纵向堆叠（不横向并排，防止跨簇挤压）
    const placeX = CLUSTER_PADDING;
    const placeY = currentY;

    for (const item of localItems) {
      if ('position' in item) {
        items.push({
          ...item,
          position: { x: item.position.x + placeX, y: item.position.y + placeY },
        });
      }
    }

    clusters.push({
      id: cluster.id,
      type: cluster.type,
      nodeIds: cluster.nodeIds,
      bounds: { x: placeX, y: placeY, width: localWidth, height: localHeight },
    });

    // 纵向堆叠：每个 cluster 独占一行
    currentY = placeY + localHeight + CLUSTER_GAP * 2; // 双倍 gap 保证 ≥64px 净间距
  }

  const majorCount = partition.clusters.filter((c) => c.type === 'major').length;
  const minorCount = partition.clusters.filter((c) => c.type === 'minor').length;

  return {
    items, edges, clusters,
    meta: {
      candidate: variant, graphIndex,
      nodeCount: graph.nodes.length, edgeCount: graph.edges.length,
      clusterCount: partition.clusters.length, majorCount, minorCount,
    },
  };
}

/**
 * 统一首帧初始化器（方案 1.5）。
 *
 * 把 lab 已验证的"分簇局部力导向 + 簇间纵向 placement"提取成内核函数，
 * 供 computeIncrementalLayout 在空状态（首帧）调用，替代旧的"全图圆形初始化 + 内联力迭代"。
 *
 * 与 computeClusterForceLayout 的差异：
 * - 全程 center 语义（cx,cy），不产出 RenderModel/top-left；
 * - major / minor 都用 layoutClusterForce（真实卡片尺寸），不再用 200×32 looseNote；
 * - 输出 positions + clusterOrigins + clusters，直接喂给 IncrementalState。
 *
 * 坐标语义：positions 为节点中心点；clusterOrigins 为每簇左上角（含 CLUSTER_PADDING 偏移）。
 */
export type InitialClusterLayout = {
  /** 节点中心点坐标 */
  positions: Record<string, CenterPos>;
  /** 每簇的左上角原点（含 padding） */
  clusterOrigins: Record<string, { x: number; y: number }>;
  /** 簇列表（与 partitionClusters 顺序一致） */
  clusters: Array<{ id: string; nodeIds: string[]; type: 'major' | 'minor' }>;
};

export function computeInitialClusterLayout(
  graph: MergedGraph,
  sizes: Record<string, NodeSize>,
): InitialClusterLayout {
  const partition = partitionClusters(graph);
  const positions: Record<string, CenterPos> = {};
  const clusterOrigins: Record<string, { x: number; y: number }> = {};
  const clusters: Array<{ id: string; nodeIds: string[]; type: 'major' | 'minor' }> = [];

  let currentY = 0;

  for (const cluster of partition.clusters) {
    const clusterNodeIds = new Set(cluster.nodeIds);
    const clusterNodes = graph.nodes.filter((n) => clusterNodeIds.has(n.id));
    const clusterEdges = graph.edges.filter(
      (e) => clusterNodeIds.has(e.source) && clusterNodeIds.has(e.target) && e.source !== e.target,
    );

    // 簇内力导向（center 语义）—— major / minor 统一走这一条
    const localCenter = layoutClusterForce(clusterNodes, clusterEdges, sizes, 'R3b');

    // 簇内 center bounds（用 center ± size/2）
    let localMinX = Infinity;
    let localMinY = Infinity;
    let localMaxY = -Infinity;
    for (const id of cluster.nodeIds) {
      const cp = localCenter[id];
      const s = sizes[id];
      if (!cp || !s) continue;
      localMinX = Math.min(localMinX, cp.cx - s.width / 2);
      localMinY = Math.min(localMinY, cp.cy - s.height / 2);
      localMaxY = Math.max(localMaxY, cp.cy + s.height / 2);
    }
    if (localMinX === Infinity) { localMinX = 0; localMinY = 0; localMaxY = 0; }

    // 归一化本簇到 (CLUSTER_PADDING, CLUSTER_PADDING) 起点
    for (const id of cluster.nodeIds) {
      const cp = localCenter[id];
      if (!cp) continue;
      cp.cx = cp.cx - localMinX + CLUSTER_PADDING;
      cp.cy = cp.cy - localMinY + CLUSTER_PADDING;
    }
    const localHeight = (localMaxY - localMinY) + CLUSTER_PADDING * 2;

    // 纵向堆叠：本簇平移到 currentY
    const placeY = currentY;
    for (const id of cluster.nodeIds) {
      const cp = localCenter[id];
      if (!cp) continue;
      positions[id] = { cx: cp.cx, cy: cp.cy + placeY };
    }
    clusterOrigins[cluster.id] = { x: CLUSTER_PADDING, y: placeY + CLUSTER_PADDING };

    clusters.push({ id: cluster.id, nodeIds: cluster.nodeIds, type: cluster.type as 'major' | 'minor' });

    // 双倍 gap 保证簇间 ≥64px 净间距（与 lab computeClusterForceLayout :242 一致）
    currentY = placeY + localHeight + CLUSTER_GAP * 2;
  }

  return { positions, clusterOrigins, clusters };
}
