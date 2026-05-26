/**
 * 自动导览（Auto Tour）相关的纯函数。
 *
 * 从 App.tsx 中提取，不依赖 React 状态或副作用。
 */

import type { Node, Edge } from 'reactflow';
import { getViewportForBounds } from 'reactflow';

import type { MergedGraph } from '@listen-graphic/schema';

import type { ViewBounds, AutoTourSeed, AutoTourBatch, AutoTourStage } from './types';
import {
  STABLE_LAYOUT_CARD_WIDTH,
  STABLE_LAYOUT_CARD_HEIGHT,
} from './graph-utils';
import {
  AUTO_REVEAL_PADDING,
  AUTO_REVEAL_MIN_WIDTH_RATIO,
  AUTO_REVEAL_MIN_HEIGHT_RATIO,
  AUTO_REVEAL_VIEWPORT_EPSILON,
  AUTO_REVEAL_ZOOM_EPSILON,
  AUTO_TOUR_ABSOLUTE_READABLE_ZOOM,
  AUTO_TOUR_FIRST_BATCH_RELATIVE_RATIO,
  AUTO_TOUR_RELATIVE_READABLE_RATIO,
  AUTO_TOUR_BASE_DWELL_MS,
  AUTO_TOUR_CHAR_DWELL_MS,
  AUTO_TOUR_NODE_DWELL_MS,
  AUTO_TOUR_EDGE_DWELL_MS,
  AUTO_TOUR_MIN_DWELL_MS,
  AUTO_TOUR_MAX_DWELL_MS,
} from './constants';

// ===== 节点差异 =====

/** 返回 nextGraph 中新增（previousGraph 不存在）的节点 id 列表。 */
export function getAddedNodeIds(previousGraph: MergedGraph | null, nextGraph: MergedGraph) {
  const previousNodeIds = new Set(previousGraph?.nodes.map((node) => node.id) ?? []);
  return nextGraph.nodes
    .filter((node) => !previousNodeIds.has(node.id))
    .map((node) => node.id);
}

/** 返回与新增节点相连、且已存在于 previousGraph 中的锚点节点 id 列表。 */
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
    const sourceIsAdded = addedNodeSet.has(edge.source);
    const targetIsAdded = addedNodeSet.has(edge.target);
    if (sourceIsAdded && previousNodeIds.has(edge.target)) {
      anchorIds.add(edge.target);
    }
    if (targetIsAdded && previousNodeIds.has(edge.source)) {
      anchorIds.add(edge.source);
    }
  }

  return Array.from(anchorIds);
}

// ===== 视口几何 =====

/** 根据节点位置 + 固定卡片尺寸计算节点包围盒。 */
export function getNodeBounds(node: { position: { x: number; y: number } }): ViewBounds {
  return {
    left: node.position.x,
    top: node.position.y,
    right: node.position.x + STABLE_LAYOUT_CARD_WIDTH,
    bottom: node.position.y + STABLE_LAYOUT_CARD_HEIGHT,
  };
}

/** 合并多个 ViewBounds 为一个外接矩形。 */
export function mergeViewBounds(bounds: ViewBounds[]) {
  return bounds.reduce<ViewBounds | null>((acc, next) => {
    if (!acc) {
      return { ...next };
    }
    return {
      left: Math.min(acc.left, next.left),
      top: Math.min(acc.top, next.top),
      right: Math.max(acc.right, next.right),
      bottom: Math.max(acc.bottom, next.bottom),
    };
  }, null);
}

/** 将 ViewBounds 四边外扩 padding。 */
export function expandViewBounds(bounds: ViewBounds, padding: number) {
  return {
    left: bounds.left - padding,
    top: bounds.top - padding,
    right: bounds.right + padding,
    bottom: bounds.bottom + padding,
  };
}

/** 若包围盒小于最小尺寸，以中心点等比放大。 */
export function ensureMinimumBoundsSize(params: {
  bounds: ViewBounds;
  minimumWidth: number;
  minimumHeight: number;
}) {
  const width = params.bounds.right - params.bounds.left;
  const height = params.bounds.bottom - params.bounds.top;
  const centerX = (params.bounds.left + params.bounds.right) / 2;
  const centerY = (params.bounds.top + params.bounds.bottom) / 2;
  const nextWidth = Math.max(width, params.minimumWidth);
  const nextHeight = Math.max(height, params.minimumHeight);

  return {
    left: centerX - nextWidth / 2,
    right: centerX + nextWidth / 2,
    top: centerY - nextHeight / 2,
    bottom: centerY + nextHeight / 2,
  };
}

/** 根据容器尺寸和当前缩放计算自动展示的最小包围盒尺寸。 */
export function getAutoRevealMinimumBoundsSize(params: {
  containerWidth: number;
  containerHeight: number;
  currentZoom: number;
}) {
  const currentZoom = params.currentZoom > 0 ? params.currentZoom : 1;
  const readableWidth = params.containerWidth / AUTO_TOUR_ABSOLUTE_READABLE_ZOOM;
  const readableHeight = params.containerHeight / AUTO_TOUR_ABSOLUTE_READABLE_ZOOM;

  return {
    minimumWidth: Math.min(
      (params.containerWidth / currentZoom) * AUTO_REVEAL_MIN_WIDTH_RATIO,
      readableWidth,
    ),
    minimumHeight: Math.min(
      (params.containerHeight / currentZoom) * AUTO_REVEAL_MIN_HEIGHT_RATIO,
      readableHeight,
    ),
  };
}

// ===== 视口比较 =====

/** 判断当前视口是否足够接近目标视口（位置 + 缩放容差）。 */
export function isViewportCloseToTarget(params: {
  current: { x: number; y: number; zoom: number };
  target: { x: number; y: number; zoom: number };
}) {
  return (
    Math.abs(params.current.x - params.target.x) <= AUTO_REVEAL_VIEWPORT_EPSILON &&
    Math.abs(params.current.y - params.target.y) <= AUTO_REVEAL_VIEWPORT_EPSILON &&
    Math.abs(params.current.zoom - params.target.zoom) <= AUTO_REVEAL_ZOOM_EPSILON
  );
}

// ===== 导览驻留时间 =====

/** 根据节点/边/字符数估算当前批次的驻留毫秒数。 */
export function estimateAutoTourDwellMs(params: {
  nodeCount: number;
  edgeCount: number;
  charCount: number;
}) {
  const estimated =
    AUTO_TOUR_BASE_DWELL_MS +
    params.charCount * AUTO_TOUR_CHAR_DWELL_MS +
    params.nodeCount * AUTO_TOUR_NODE_DWELL_MS +
    params.edgeCount * AUTO_TOUR_EDGE_DWELL_MS;
  return Math.min(Math.max(estimated, AUTO_TOUR_MIN_DWELL_MS), AUTO_TOUR_MAX_DWELL_MS);
}

// ===== 批次构建 =====

/** 将新增节点按可读缩放拆分为多个导览批次。 */
export function buildAutoTourBatches(params: {
  seed: AutoTourSeed;
  flowNodes: Node[];
  flowEdges: Edge[];
  containerWidth: number;
  containerHeight: number;
  currentZoom: number;
  minReadableZoom?: number;
}) {
  const nodeMap = new Map(params.flowNodes.map((node) => [node.id, node]));
  const addedNodes = params.seed.nodeIds
    .map((id) => nodeMap.get(id))
    .filter((node): node is Node => Boolean(node));
  if (addedNodes.length === 0) {
    return [];
  }

  const anchorNodes = params.seed.anchorNodeIds
    .map((id) => nodeMap.get(id))
    .filter((node): node is Node => Boolean(node));
  const anchorBounds = anchorNodes.map(getNodeBounds);

  const addedNodeIdSet = new Set(params.seed.nodeIds);
  const adjacency = new Map<string, Set<string>>();
  for (const nodeId of [...params.seed.nodeIds, ...params.seed.anchorNodeIds]) {
    adjacency.set(nodeId, new Set());
  }
  for (const edge of params.flowEdges) {
    if (
      !(adjacency.has(edge.source) && adjacency.has(edge.target))
    ) {
      continue;
    }
    adjacency.get(edge.source)?.add(edge.target);
    adjacency.get(edge.target)?.add(edge.source);
  }

  const depthByNodeId = new Map<string, number>();
  if (params.seed.anchorNodeIds.length > 0) {
    const queue = params.seed.anchorNodeIds.map((nodeId) => ({ nodeId, depth: 0 }));
    const visited = new Set(params.seed.anchorNodeIds);
    while (queue.length > 0) {
      const { nodeId, depth } = queue.shift()!;
      for (const nextId of adjacency.get(nodeId) ?? []) {
        if (visited.has(nextId)) {
          continue;
        }
        visited.add(nextId);
        if (addedNodeIdSet.has(nextId)) {
          depthByNodeId.set(nextId, depth + 1);
        }
        queue.push({ nodeId: nextId, depth: depth + 1 });
      }
    }
  }

  const clusters = params.seed.nodeIds
    .map((nodeId) => {
      const node = nodeMap.get(nodeId);
      return node
        ? {
            nodeIds: [nodeId],
            node,
            depth: depthByNodeId.get(nodeId) ?? Number.MAX_SAFE_INTEGER,
          }
        : null;
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .sort((a, b) => {
      if (a.depth !== b.depth) {
        return a.depth - b.depth;
      }
      if (a.node.position.y !== b.node.position.y) {
        return a.node.position.y - b.node.position.y;
      }
      return a.node.position.x - b.node.position.x;
    })
    .map(({ nodeIds }) => {
      const groupNodes = nodeIds
        .map((id) => nodeMap.get(id))
        .filter((node): node is Node => Boolean(node));
      const groupBounds = mergeViewBounds(groupNodes.map(getNodeBounds));
      if (!groupBounds) {
        return null;
      }
      const groupNodeIdSet = new Set(nodeIds);
      const edgeCount = params.flowEdges.filter(
        (edge) => groupNodeIdSet.has(edge.source) && groupNodeIdSet.has(edge.target),
      ).length;
      const charCount = groupNodes.reduce(
        (sum, node) => sum + String(node.data?.label ?? '').length,
        0,
      );
      return {
        nodeIds,
        bounds: groupBounds,
        edgeCount,
        charCount,
      };
    })
    .filter((cluster): cluster is NonNullable<typeof cluster> => Boolean(cluster));

  const batches: AutoTourBatch[] = [];
  let currentBatch: typeof clusters = [];
  let effectiveCurrentZoom = params.currentZoom > 0 ? params.currentZoom : 1;

  const getBatchViewport = (clustersToTest: typeof clusters, includeAnchors: boolean) => {
    const bounds = mergeViewBounds([
      ...clustersToTest.map((cluster) => cluster.bounds),
      ...(includeAnchors ? anchorBounds : []),
    ]);
    if (!bounds) {
      return null;
    }
    return getViewportForBounds(
      {
        x: bounds.left - AUTO_REVEAL_PADDING,
        y: bounds.top - AUTO_REVEAL_PADDING,
        width: bounds.right - bounds.left + AUTO_REVEAL_PADDING * 2,
        height: bounds.bottom - bounds.top + AUTO_REVEAL_PADDING * 2,
      },
      params.containerWidth,
      params.containerHeight,
      0.3,
      2,
      0,
    );
  };

  const canFitReadably = (clustersToTest: typeof clusters, includeAnchors: boolean) => {
    const viewport = getBatchViewport(clustersToTest, includeAnchors);
    if (!viewport) {
      return false;
    }
    const relativeRatio = includeAnchors
      ? AUTO_TOUR_FIRST_BATCH_RELATIVE_RATIO
      : AUTO_TOUR_RELATIVE_READABLE_RATIO;
    const allowedMinZoom = Math.max(
      typeof params.minReadableZoom === 'number' && params.minReadableZoom > 0
        ? params.minReadableZoom
        : AUTO_TOUR_ABSOLUTE_READABLE_ZOOM,
      effectiveCurrentZoom * relativeRatio,
    );
    return viewport.zoom >= allowedMinZoom;
  };

  const finalizeBatch = (clustersToFlush: typeof clusters, includeAnchors: boolean) => {
    if (clustersToFlush.length === 0) {
      return;
    }
    const viewport = getBatchViewport(clustersToFlush, includeAnchors);
    if (!viewport) {
      return;
    }
    const nodeIds = clustersToFlush.flatMap((cluster) => cluster.nodeIds);
    const edgeCount = clustersToFlush.reduce((sum, cluster) => sum + cluster.edgeCount, 0);
    const charCount = clustersToFlush.reduce((sum, cluster) => sum + cluster.charCount, 0);
    batches.push({
      nodeIds,
      anchorNodeIds: includeAnchors ? params.seed.anchorNodeIds : [],
      dwellMs: estimateAutoTourDwellMs({
        nodeCount: nodeIds.length,
        edgeCount,
        charCount,
      }),
    });
    effectiveCurrentZoom = viewport.zoom;
  };

  clusters.forEach((cluster) => {
    const candidateBatch = [...currentBatch, cluster];
    const includeAnchors = batches.length === 0;
    const canAppend =
      currentBatch.length === 0 ||
      canFitReadably(candidateBatch, includeAnchors);

    if (!canAppend) {
      finalizeBatch(currentBatch, batches.length === 0);
      currentBatch = [cluster];
      return;
    }

    currentBatch = candidateBatch;
  });

  finalizeBatch(currentBatch, batches.length === 0);

  return batches;
}

// ===== 两阶段导览 =====

/** 只保留与新增节点通过边真实相连的候选锚点。 */
export function getValidAutoTourAnchorNodeIds(params: {
  addedNodeIds: string[];
  candidateAnchorNodeIds: string[];
  flowEdges: Edge[];
}) {
  const addedNodeSet = new Set(params.addedNodeIds);
  const candidateAnchorSet = new Set(params.candidateAnchorNodeIds);
  const validAnchors = new Set<string>();

  for (const edge of params.flowEdges) {
    if (addedNodeSet.has(edge.source) && candidateAnchorSet.has(edge.target)) {
      validAnchors.add(edge.target);
    }
    if (addedNodeSet.has(edge.target) && candidateAnchorSet.has(edge.source)) {
      validAnchors.add(edge.source);
    }
  }

  return params.candidateAnchorNodeIds.filter((nodeId) => validAnchors.has(nodeId));
}

/** 检测新增节点之间是否存在可见的内部边。 */
export function hasVisibleAddedInternalEdge(params: {
  addedNodeIds: string[];
  flowEdges: Edge[];
}) {
  const addedNodeSet = new Set(params.addedNodeIds);
  return params.flowEdges.some(
    (edge) => addedNodeSet.has(edge.source) && addedNodeSet.has(edge.target),
  );
}

/** 构建两阶段导览计划：结构揭示 + 阅读聚焦。 */
export function buildTwoStageAutoTourStages(params: {
  seed: AutoTourSeed;
  flowNodes: Node[];
  flowEdges: Edge[];
  containerWidth: number;
  containerHeight: number;
  currentZoom: number;
  minReadableZoom: number;
}) {
  const validAnchorNodeIds = getValidAutoTourAnchorNodeIds({
    addedNodeIds: params.seed.nodeIds,
    candidateAnchorNodeIds: params.seed.anchorNodeIds,
    flowEdges: params.flowEdges,
  });

  const hasInternalEdges = hasVisibleAddedInternalEdge({
    addedNodeIds: params.seed.nodeIds,
    flowEdges: params.flowEdges,
  });

  const stages: AutoTourStage[] = [];
  if (validAnchorNodeIds.length > 0 || hasInternalEdges) {
    const structureNodeIds = new Set([...params.seed.nodeIds, ...validAnchorNodeIds]);
    stages.push({
      kind: 'structure',
      displayMode: 'compact',
      nodeIds: params.seed.nodeIds,
      anchorNodeIds: validAnchorNodeIds,
      dwellMs: estimateAutoTourDwellMs({
        nodeCount: params.seed.nodeIds.length + validAnchorNodeIds.length,
        edgeCount: params.flowEdges.filter(
          (edge) => structureNodeIds.has(edge.source) && structureNodeIds.has(edge.target),
        ).length,
        charCount: 0,
      }),
    });
  }

  const readingBatches = buildAutoTourBatches({
    seed: {
      ...params.seed,
      anchorNodeIds: [],
    },
    flowNodes: params.flowNodes,
    flowEdges: params.flowEdges,
    containerWidth: params.containerWidth,
    containerHeight: params.containerHeight,
    currentZoom: params.currentZoom,
    minReadableZoom: params.minReadableZoom,
  });

  stages.push(
    ...readingBatches.map((batch): AutoTourStage => ({
      ...batch,
      anchorNodeIds: [],
      kind: 'reading',
      displayMode: 'readable',
    })),
  );

  return stages;
}
