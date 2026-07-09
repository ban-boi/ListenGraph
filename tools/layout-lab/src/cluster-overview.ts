import type { MergedGraph } from '@listen-graphic/schema';
import { partitionClusters } from './cluster-partition';
import { computeClusterLayoutA, layoutClusterInternal, computeBounds } from './cluster-layout';
import type { RenderModel, RenderItem, RenderEdge, ClusterInfo, Position } from './round2-types';
import { CARD_WIDTH, CARD_HEIGHT, CLUSTER_GAP, LOOSE_NOTE_ITEM_HEIGHT, LOOSE_NOTE_ITEM_WIDTH } from './round2-types';

const TOP_MAJOR_EXPAND = 4;

export function computeClusterLayoutB(
  graph: MergedGraph,
  graphIndex: number,
): RenderModel {
  const partition = partitionClusters(graph);
  const majorClusters = partition.clusters.filter((c) => c.type === 'major');
  const minorClusters = partition.clusters.filter((c) => c.type === 'minor');

  // 如果 major <= TOP_MAJOR_EXPAND，B 退化为 A（无 summary）
  if (majorClusters.length <= TOP_MAJOR_EXPAND) {
    return computeClusterLayoutA(graph, graphIndex);
  }

  // B 不复用 A 的坐标，完全独立重算（和 A 一样的 local → decide → offset 流程）
  // 区别：第 5+ major 替换为 clusterSummary，不画具体节点
  const items: RenderItem[] = [];
  const edges: RenderEdge[] = [];
  const clusters: ClusterInfo[] = [];

  const MAX_ROW_WIDTH = 1200;
  let currentX = 0;
  let currentY = 0;
  let rowMaxY = 0;
  let majorRank = 0;

  const SUMMARY_WIDTH = 200;
  const SUMMARY_HEIGHT = 80;

  for (const cluster of partition.clusters) {
    // —— 第 1 步：先算 local 坐标 / summary 信息 ——
    let localItems: RenderItem[] = [];
    let localWidth = 0;
    let localHeight = 0;

    if (cluster.type === 'major') {
      if (majorRank < TOP_MAJOR_EXPAND) {
        // 展开：跑 baseline 坐标（local 原点 0,0）
        const localPositions = layoutClusterInternal(graph, cluster.nodeIds, cluster.edges);
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
        const localBounds = computeBounds(localPositions, false);
        localWidth = localBounds.width;
        localHeight = localBounds.height;
      } else {
        // 第 5+ major：summary（不画节点，只占位）
        localItems = [{
          kind: 'clusterSummary' as const,
          clusterId: cluster.id,
          position: { x: 0, y: 0 },
          nodeCount: cluster.nodeIds.length,
          edgeCount: cluster.edges.length,
        }];
        localWidth = SUMMARY_WIDTH;
        localHeight = SUMMARY_HEIGHT;
      }
      majorRank++;
    } else {
      // minor → loose notes（local 原点 0,0）
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

    // —— 第 2 步：决定 placement（先判断换行）——
    if (currentX + localWidth + CLUSTER_GAP > MAX_ROW_WIDTH && currentX > 0) {
      currentX = 0;
      currentY = rowMaxY + CLUSTER_GAP;
      rowMaxY = 0;
    }
    const placeX = currentX;
    const placeY = currentY;

    // —— 第 3 步：offset 节点坐标到最终位置 ——
    for (const item of localItems) {
      if ('position' in item) {
        items.push({
          ...item,
          position: { x: item.position.x + placeX, y: item.position.y + placeY },
        });
      } else {
        items.push(item);
      }
    }

    // —— 第 4 步：写 cluster bounds + 推进游标 ——
    clusters.push({
      id: cluster.id,
      type: cluster.type,
      nodeIds: cluster.nodeIds,
      bounds: { x: placeX, y: placeY, width: localWidth, height: localHeight },
    });
    currentX = placeX + localWidth + CLUSTER_GAP;
    rowMaxY = Math.max(rowMaxY, placeY + localHeight);
  }

  return {
    items, edges, clusters,
    meta: {
      candidate: 'B', graphIndex,
      nodeCount: graph.nodes.length, edgeCount: graph.edges.length,
      clusterCount: partition.clusters.length,
      majorCount: majorClusters.length, minorCount: minorClusters.length,
    },
  };
}
