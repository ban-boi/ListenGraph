import type { MergedGraph, GraphNode, GraphEdge, EdgeType } from '@listen-graphic/schema';
import { partitionClusters } from './cluster-partition';
import { resolveOverlaps, type CenterPos } from './force-core-v2';
import {
  computeAllNodeSizes,
  FORCE_PARAMS, GRAVITY_STRENGTH, PENALTY_STRENGTH, TARGET_WIDTH, OUTER_TARGET_WIDTH,
  type NodeSize,
} from './round3-types';
import type {
  RenderModel, RenderItem, RenderEdge, ClusterInfo, Position,
} from './round2-types';
import { CLUSTER_GAP, LOOSE_NOTE_ITEM_HEIGHT, LOOSE_NOTE_ITEM_WIDTH } from './round2-types';

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
): RenderModel {
  const partition = partitionClusters(graph);
  const allSizes = computeAllNodeSizes(graph.nodes);
  const items: RenderItem[] = [];
  const edges: RenderEdge[] = [];
  const clusters: ClusterInfo[] = [];

  let currentX = 0;
  let currentY = 0;
  let rowMaxY = 0;

  for (const cluster of partition.clusters) {
    const clusterNodes = graph.nodes.filter((n) => cluster.nodeIds.includes(n.id));
    const clusterEdges = graph.edges.filter(
      (e) => cluster.nodeIds.includes(e.source) && cluster.nodeIds.includes(e.target) && e.source !== e.target,
    );
    const clusterSizes: Record<string, NodeSize> = {};
    for (const id of cluster.nodeIds) clusterSizes[id] = allSizes[id];

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

      const positions = localItems
        .filter((i): i is Extract<RenderItem, { kind: 'fullNode' }> => i.kind === 'fullNode')
        .map((i) => i.position);
      if (positions.length > 0) {
        const xs = positions.map((p) => p.x);
        const ys = positions.map((p) => p.y);
        const maxNodeWidth = Math.max(...cluster.nodeIds.map((id) => clusterSizes[id]?.width ?? 200));
        const maxNodeHeight = Math.max(...cluster.nodeIds.map((id) => clusterSizes[id]?.height ?? 100));
        localWidth = Math.max(...xs) + maxNodeWidth - Math.min(...xs);
        localHeight = Math.max(...ys) + maxNodeHeight - Math.min(...ys);
      } else {
        localWidth = 200;
        localHeight = 100;
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
      localWidth = LOOSE_NOTE_ITEM_WIDTH;
      localHeight = sorted.length * LOOSE_NOTE_ITEM_HEIGHT;
    }

    // offset 到外层（row packing：宽度内横向排，超宽换行）
    if (currentX + localWidth + CLUSTER_GAP > OUTER_TARGET_WIDTH && currentX > 0) {
      currentX = 0;
      currentY = rowMaxY + CLUSTER_GAP;
      rowMaxY = 0;
    }
    const placeX = currentX;
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

    currentX = placeX + localWidth + CLUSTER_GAP;
    rowMaxY = Math.max(rowMaxY, placeY + localHeight);
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
