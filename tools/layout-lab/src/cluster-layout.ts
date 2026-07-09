import type { MergedGraph, EdgeType } from '@listen-graphic/schema';
import { buildStableReactFlowDebugGraph } from '../../../apps/extension/src/sidepanel/graph-utils.ts';
import { toHierarchyRendererGraph } from '../../../packages/graph-renderers/src/hierarchy.ts';
import { partitionClusters } from './cluster-partition';
import type { RenderModel, RenderItem, RenderEdge, ClusterInfo, Position } from './round2-types';
import { CARD_WIDTH, CARD_HEIGHT, CLUSTER_GAP, LOOSE_NOTE_ITEM_HEIGHT, LOOSE_NOTE_ITEM_WIDTH } from './round2-types';

// 对单个 cluster 的子图跑 baseline 坐标算法（B 也复用，故 export）
export function layoutClusterInternal(
  graph: MergedGraph,
  clusterNodeIds: string[],
  clusterEdges: Array<{ source: string; target: string; type: EdgeType }>,
): Record<string, Position> {
  const nodeSet = new Set(clusterNodeIds);
  const subNodes = graph.nodes.filter((n) => nodeSet.has(n.id));
  const subEdges = graph.edges.filter(
    (e) => nodeSet.has(e.source) && nodeSet.has(e.target) && e.source !== e.target,
  );
  const subGraph: MergedGraph = { ...graph, nodes: subNodes, edges: subEdges };

  const rendererGraph = toHierarchyRendererGraph(subGraph);
  const result = buildStableReactFlowDebugGraph({
    rendererGraph,
    view: 'hierarchy',
    currentTimeMs: 0,
    selectedNodeId: null,
    previousLayoutState: { positions: {} },
  });

  return result.layoutState.positions;
}

// 算一个 cluster 的 local bounds（B 也复用，故 export）
export function computeBounds(positions: Record<string, Position>, isLoose: boolean): {
  x: number; y: number; width: number; height: number;
} {
  const pos = Object.values(positions);
  if (pos.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  const xs = pos.map((p) => p.x);
  const ys = pos.map((p) => p.y);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const w = isLoose ? LOOSE_NOTE_ITEM_WIDTH : CARD_WIDTH;
  const h = isLoose ? LOOSE_NOTE_ITEM_HEIGHT : CARD_HEIGHT;
  return { x: minX, y: minY, width: maxX + w - minX, height: maxY + h - minY };
}

export function computeClusterLayoutA(
  graph: MergedGraph,
  graphIndex: number,
): RenderModel {
  const partition = partitionClusters(graph);
  const items: RenderItem[] = [];
  const edges: RenderEdge[] = [];
  const clusters: ClusterInfo[] = [];

  const MAX_ROW_WIDTH = 1200;
  let currentX = 0;
  let currentY = 0;
  let rowMaxY = 0;

  for (const cluster of partition.clusters) {
    // —— 第 1 步：先算 local 坐标（原点 0,0），不 offset ——
    let localPositions: Record<string, Position> = {};
    let localItems: RenderItem[] = [];

    if (cluster.type === 'major') {
      localPositions = layoutClusterInternal(graph, cluster.nodeIds, cluster.edges);
      localItems = cluster.nodeIds
        .filter((id) => localPositions[id])
        .map((id) => ({
          kind: 'fullNode' as const,
          nodeId: id,
          position: localPositions[id],
        }));
      for (const e of cluster.edges) {
        if (localPositions[e.source] && localPositions[e.target]) {
          edges.push({ source: e.source, target: e.target, type: e.type });
        }
      }
    } else {
      const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
      const sorted = [...cluster.nodeIds].sort((a, b) => {
        return (nodeById.get(a)?.timestampMs ?? 0) - (nodeById.get(b)?.timestampMs ?? 0);
      });
      sorted.forEach((id, i) => {
        localPositions[id] = { x: 0, y: i * LOOSE_NOTE_ITEM_HEIGHT };
        localItems.push({
          kind: 'looseNoteItem' as const,
          nodeId: id,
          position: localPositions[id],
        });
      });
    }

    // —— 第 2 步：算 local bounds ——
    const localBounds = computeBounds(localPositions, cluster.type === 'minor');

    // —— 第 3 步：决定 placement（先判断换行，再定 placeX/placeY）——
    if (currentX + localBounds.width + CLUSTER_GAP > MAX_ROW_WIDTH && currentX > 0) {
      currentX = 0;
      currentY = rowMaxY + CLUSTER_GAP;
      rowMaxY = 0;
    }
    const placeX = currentX;
    const placeY = currentY;

    // —— 第 4 步：offset 节点坐标到最终位置 ——
    for (const item of localItems) {
      if ('position' in item) {
        items.push({
          ...item,
          position: { x: item.position.x + placeX, y: item.position.y + placeY },
        });
      }
    }

    // —— 第 5 步：写 cluster bounds + 推进游标 ——
    clusters.push({
      id: cluster.id,
      type: cluster.type,
      nodeIds: cluster.nodeIds,
      bounds: { x: placeX, y: placeY, width: localBounds.width, height: localBounds.height },
    });
    currentX = placeX + localBounds.width + CLUSTER_GAP;
    rowMaxY = Math.max(rowMaxY, placeY + localBounds.height);
  }

  const majorCount = partition.clusters.filter((c) => c.type === 'major').length;
  const minorCount = partition.clusters.filter((c) => c.type === 'minor').length;

  return {
    items, edges, clusters,
    meta: {
      candidate: 'A', graphIndex,
      nodeCount: graph.nodes.length, edgeCount: graph.edges.length,
      clusterCount: partition.clusters.length, majorCount, minorCount,
    },
  };
}
