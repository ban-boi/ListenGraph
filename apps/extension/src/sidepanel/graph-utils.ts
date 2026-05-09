/**
 * graph-utils.ts — 图布局相关纯函数与常量
 *
 * 从 App.tsx 提取，包含稳定布局算法、边句柄解析和调试视图构建。
 */

import type {
  ViewType,
  MergedGraph,
  NodeType,
} from '@listen-graphic/schema';
import {
  toCausalRendererGraph,
  toTimelineRendererGraph,
  toComparisonRendererGraph,
  toHierarchyRendererGraph,
  toFlowRendererGraph,
  type RendererGraph,
} from '@listen-graphic/graph-renderers';
import type {
  StableLayoutCache,
  StableViewLayoutState,
  StableNodePosition,
  ReactFlowDebugNode,
  ReactFlowDebugEdge,
  DebugViewArtifact,
  SourceHandleId,
  TargetHandleId,
  ReactFlowDebugNodeData,
} from './types';
import { VIEW_TYPES } from './constants';

// ============ 布局常量 ============

const STABLE_LAYOUT_CARD_WIDTH = 220;
const STABLE_LAYOUT_CARD_HEIGHT = 132;
const STABLE_LAYOUT_MAIN_X = 60;
const STABLE_LAYOUT_COMPARISON_RIGHT_X = 360;
const STABLE_LAYOUT_BRANCH_OFFSET_X = 280;
const STABLE_LAYOUT_ROW_GAP = 168;
const STABLE_LAYOUT_BRANCH_GAP = 148;
const STABLE_LAYOUT_COLLISION_GAP = 24;
const EDGE_AXIS_DOMINANCE_RATIO = 1.25;

// ============ 布局工具函数 ============

function createEmptyStableLayoutCache(): StableLayoutCache {
  return {
    timeline: { positions: {} },
    causal: { positions: {} },
    comparison: { positions: {} },
    flow: { positions: {} },
    hierarchy: { positions: {} },
  };
}

function getRendererGraph(graph: MergedGraph, view: ViewType): RendererGraph {
  switch (view) {
    case 'timeline':
      return toTimelineRendererGraph(graph);
    case 'comparison':
      return toComparisonRendererGraph(graph);
    case 'hierarchy':
      return toHierarchyRendererGraph(graph);
    case 'flow':
      return toFlowRendererGraph(graph);
    default:
      return toCausalRendererGraph(graph);
  }
}

function getLaneX(
  view: ViewType,
  nodeType: ReactFlowDebugNodeData['nodeType'] | NodeType,
  speaker?: string,
) {
  switch (view) {
    case 'comparison':
      return speaker === '嘉宾B'
        ? STABLE_LAYOUT_COMPARISON_RIGHT_X
        : STABLE_LAYOUT_MAIN_X;
    case 'hierarchy':
      return nodeType === 'claim' || nodeType === 'conclusion'
        ? STABLE_LAYOUT_MAIN_X
        : STABLE_LAYOUT_MAIN_X + STABLE_LAYOUT_BRANCH_OFFSET_X;
    default:
      return STABLE_LAYOUT_MAIN_X;
  }
}

function isBranchNodeType(nodeType: NodeType) {
  return nodeType === 'reason' || nodeType === 'example' || nodeType === 'question';
}

function getNodeRect(position: StableNodePosition) {
  return {
    left: position.x,
    right: position.x + STABLE_LAYOUT_CARD_WIDTH,
    top: position.y,
    bottom: position.y + STABLE_LAYOUT_CARD_HEIGHT,
  };
}

function hasCollision(position: StableNodePosition, occupied: StableNodePosition[]) {
  const candidateRect = getNodeRect(position);
  return occupied.some((existing) => {
    const existingRect = getNodeRect(existing);
    return !(
      candidateRect.right + STABLE_LAYOUT_COLLISION_GAP <= existingRect.left ||
      existingRect.right + STABLE_LAYOUT_COLLISION_GAP <= candidateRect.left ||
      candidateRect.bottom + STABLE_LAYOUT_COLLISION_GAP <= existingRect.top ||
      existingRect.bottom + STABLE_LAYOUT_COLLISION_GAP <= candidateRect.top
    );
  });
}

function findAvailablePosition(
  basePosition: StableNodePosition,
  occupied: StableNodePosition[],
) {
  let candidate = basePosition;
  while (hasCollision(candidate, occupied)) {
    candidate = {
      x: candidate.x,
      y: candidate.y + STABLE_LAYOUT_COLLISION_GAP,
    };
  }
  return candidate;
}

function getMaxYForLane(
  positions: Record<string, StableNodePosition>,
  laneX?: number,
) {
  const relevantPositions = Object.values(positions).filter((position) =>
    laneX === undefined ? true : position.x === laneX,
  );
  if (relevantPositions.length === 0) {
    return -STABLE_LAYOUT_ROW_GAP;
  }
  return Math.max(...relevantPositions.map((position) => position.y));
}

function pickAnchorNodeId(params: {
  nodeId: string;
  timestampMs: number;
  edges: RendererGraph['edges'];
  nodeMap: Map<string, RendererGraph['nodes'][number]>;
  positions: Record<string, StableNodePosition>;
}) {
  const neighborIds = new Set<string>();
  for (const edge of params.edges) {
    if (edge.source === params.nodeId && params.positions[edge.target]) {
      neighborIds.add(edge.target);
    }
    if (edge.target === params.nodeId && params.positions[edge.source]) {
      neighborIds.add(edge.source);
    }
  }

  const candidates = Array.from(neighborIds)
    .map((id) => params.nodeMap.get(id))
    .filter((node): node is RendererGraph['nodes'][number] => Boolean(node));

  candidates.sort((a, b) => {
    const typeScoreA =
      a.type === 'claim' || a.type === 'conclusion' ? 0 : isBranchNodeType(a.type) ? 1 : 2;
    const typeScoreB =
      b.type === 'claim' || b.type === 'conclusion' ? 0 : isBranchNodeType(b.type) ? 1 : 2;
    if (typeScoreA !== typeScoreB) return typeScoreA - typeScoreB;
    return Math.abs(a.timestampMs - params.timestampMs) - Math.abs(b.timestampMs - params.timestampMs);
  });

  return candidates[0]?.id;
}

function getRectCenter(rect: ReturnType<typeof getNodeRect>) {
  return {
    x: (rect.left + rect.right) / 2,
    y: (rect.top + rect.bottom) / 2,
  };
}

export function resolveEdgeHandles(
  sourcePosition: StableNodePosition,
  targetPosition: StableNodePosition,
): {
  sourceHandle: SourceHandleId;
  targetHandle: TargetHandleId;
} {
  const sourceRect = getNodeRect(sourcePosition);
  const targetRect = getNodeRect(targetPosition);
  const sourceCenter = getRectCenter(sourceRect);
  const targetCenter = getRectCenter(targetRect);
  const deltaX = targetCenter.x - sourceCenter.x;
  const deltaY = targetCenter.y - sourceCenter.y;
  const absDeltaX = Math.abs(deltaX);
  const absDeltaY = Math.abs(deltaY);

  if (absDeltaY >= absDeltaX * EDGE_AXIS_DOMINANCE_RATIO) {
    return deltaY >= 0
      ? { sourceHandle: 'source-bottom', targetHandle: 'target-top' }
      : { sourceHandle: 'source-top', targetHandle: 'target-bottom' };
  }

  if (absDeltaX >= absDeltaY * EDGE_AXIS_DOMINANCE_RATIO) {
    return deltaX >= 0
      ? { sourceHandle: 'source-right', targetHandle: 'target-left' }
      : { sourceHandle: 'source-left', targetHandle: 'target-right' };
  }

  return { sourceHandle: 'source-bottom', targetHandle: 'target-top' };
}

function buildStableReactFlowDebugGraph(params: {
  rendererGraph: RendererGraph;
  view: ViewType;
  currentTimeMs: number;
  selectedNodeId: string | null;
  previousLayoutState: StableViewLayoutState;
}) {
  const validNodeIds = new Set(params.rendererGraph.nodes.map((node) => node.id));
  const positions: Record<string, StableNodePosition> = {};
  const occupied: StableNodePosition[] = [];
  const nodeMap = new Map(params.rendererGraph.nodes.map((node) => [node.id, node]));
  const branchCountByAnchor = new Map<string, number>();
  let reusedPositions = 0;
  let newPositions = 0;
  let movedPositions = 0;

  for (const node of params.rendererGraph.nodes) {
    const existingPosition = params.previousLayoutState.positions[node.id];
    if (!existingPosition) {
      continue;
    }
    positions[node.id] = existingPosition;
    occupied.push(existingPosition);
    reusedPositions += 1;
  }

  for (const node of params.rendererGraph.nodes) {
    if (positions[node.id]) {
      continue;
    }

    const anchorId = pickAnchorNodeId({
      nodeId: node.id,
      timestampMs: node.timestampMs,
      edges: params.rendererGraph.edges,
      nodeMap,
      positions,
    });

    let basePosition: StableNodePosition;
    if (anchorId && isBranchNodeType(node.type)) {
      const anchorPosition = positions[anchorId];
      const branchCount = branchCountByAnchor.get(anchorId) ?? 0;
      basePosition = {
        x: getLaneX(params.view, node.type, node.speaker) === anchorPosition.x
          ? anchorPosition.x + STABLE_LAYOUT_BRANCH_OFFSET_X
          : getLaneX(params.view, node.type, node.speaker),
        y: anchorPosition.y + STABLE_LAYOUT_BRANCH_GAP * (branchCount + 1),
      };
      branchCountByAnchor.set(anchorId, branchCount + 1);
    } else {
      const laneX = getLaneX(params.view, node.type, node.speaker);
      basePosition = {
        x: laneX,
        y: getMaxYForLane(positions, params.view === 'comparison' ? laneX : undefined) +
          STABLE_LAYOUT_ROW_GAP,
      };
    }

    const nextPosition = findAvailablePosition(basePosition, occupied);
    const previousPosition = params.previousLayoutState.positions[node.id];
    if (previousPosition) {
      if (previousPosition.x !== nextPosition.x || previousPosition.y !== nextPosition.y) {
        movedPositions += 1;
      } else {
        reusedPositions += 1;
      }
    } else {
      newPositions += 1;
    }
    positions[node.id] = nextPosition;
    occupied.push(nextPosition);
  }

  const nodes: ReactFlowDebugNode[] = params.rendererGraph.nodes
    .filter((node) => validNodeIds.has(node.id))
    .map((node) => ({
      id: node.id,
      type: 'graphNode',
      position: positions[node.id],
      data: {
        label: node.label,
        nodeType: node.type,
        speaker: node.speaker,
        timestampMs: node.timestampMs,
        status: node.status,
        isActive:
          Math.abs(node.timestampMs - params.currentTimeMs) < 30000 ||
          node.id === params.selectedNodeId,
      },
    }));

  const edges: ReactFlowDebugEdge[] = params.rendererGraph.edges
    .filter((edge) => positions[edge.source] && positions[edge.target])
    .map((edge) => {
      const handles = resolveEdgeHandles(positions[edge.source], positions[edge.target]);
      return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        type: 'default',
        sourceHandle: handles.sourceHandle,
        targetHandle: handles.targetHandle,
        label: edge.relation,
        style: {
          stroke:
            edge.relation === 'supports'
              ? '#10b981'
              : edge.relation === 'opposes'
                ? '#ef4444'
                : edge.relation === 'causes'
                  ? '#f59e0b'
                  : '#6b7280',
        },
        animated: edge.relation === 'causes',
      };
    });

  return {
    layoutDiagnostics: {
      reusedPositions,
      newPositions,
      movedPositions,
    },
    reactFlow: { nodes, edges },
    layoutState: {
      positions: Object.fromEntries(
        Object.entries(positions).filter(([nodeId]) => validNodeIds.has(nodeId)),
      ),
    },
  }
}

function buildReactFlowDebugGraph(params: {
  rendererGraphs: Record<ViewType, RendererGraph>;
  currentTimeMs: number;
  selectedNodeId: string | null;
  previousLayoutCache: StableLayoutCache;
}) {
  const artifacts = {} as Record<ViewType, DebugViewArtifact>;
  const nextLayoutCache = createEmptyStableLayoutCache();

  for (const view of VIEW_TYPES) {
    const rendererGraph = params.rendererGraphs[view];
    const result = buildStableReactFlowDebugGraph({
      rendererGraph,
      view,
      currentTimeMs: params.currentTimeMs,
      selectedNodeId: params.selectedNodeId,
      previousLayoutState: params.previousLayoutCache[view],
    });
    artifacts[view] = {
      rendererGraph,
      layoutDiagnostics: result.layoutDiagnostics,
      reactFlow: result.reactFlow,
    };
    nextLayoutCache[view] = result.layoutState;
  }

  return {
    artifacts,
    nextLayoutCache,
  };
}

function buildDebugViewArtifacts(params: {
  graph: MergedGraph;
  currentTimeMs: number;
  selectedNodeId: string | null;
  previousLayoutCache: StableLayoutCache;
}) {
  const rendererGraphs = VIEW_TYPES.reduce(
    (acc, view) => {
      acc[view] = getRendererGraph(params.graph, view);
      return acc;
    },
    {} as Record<ViewType, RendererGraph>,
  );

  return buildReactFlowDebugGraph({
    rendererGraphs,
    currentTimeMs: params.currentTimeMs,
    selectedNodeId: params.selectedNodeId,
    previousLayoutCache: params.previousLayoutCache,
  });
}

// ============ 导出 ============

export {
  STABLE_LAYOUT_CARD_WIDTH,
  STABLE_LAYOUT_CARD_HEIGHT,
};

export {
  createEmptyStableLayoutCache,
  getRendererGraph,
  getLaneX,
  isBranchNodeType,
  getNodeRect,
  hasCollision,
  findAvailablePosition,
  getMaxYForLane,
  pickAnchorNodeId,
  getRectCenter,
  buildStableReactFlowDebugGraph,
  buildReactFlowDebugGraph,
  buildDebugViewArtifacts,
};
