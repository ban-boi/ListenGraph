import type { MergedGraph, ViewType } from '@listen-graphic/schema';
import { buildStableReactFlowDebugGraph, getRendererGraph } from '../../../apps/extension/src/sidepanel/graph-utils.ts';
import type { RenderModel, RenderItem, RenderEdge } from './round2-types';

// baseline 封装：直接调用产品函数算坐标，转成 RenderModel
// view 跟随图自带的 viewHints.defaultView（与扩展行为一致），而非硬编码 hierarchy
export function computeBaselinePositions(
  graph: MergedGraph,
  graphIndex: number,
): RenderModel {
  const view: ViewType = graph.viewHints?.defaultView ?? 'causal';
  const rendererGraph = getRendererGraph(graph, view);

  const result = buildStableReactFlowDebugGraph({
    rendererGraph,
    view,
    currentTimeMs: 0,
    selectedNodeId: null,
    previousLayoutState: { positions: {} },
  });

  const positions = result.layoutState.positions;

  // 转为 RenderItem（baseline 全是 fullNode）
  const items: RenderItem[] = rendererGraph.nodes
    .filter((n) => positions[n.id])
    .map((n) => ({
      kind: 'fullNode' as const,
      nodeId: n.id,
      position: positions[n.id],
    }));

  // 边（只含两端都有 position 的）
  const validNodeIds = new Set(
    items.filter((i) => i.kind === 'fullNode').map((i) => i.nodeId),
  );
  const edges: RenderEdge[] = rendererGraph.edges
    .filter((e) => validNodeIds.has(e.source) && validNodeIds.has(e.target))
    .map((e) => ({ source: e.source, target: e.target, type: e.relation }));

  return {
    items,
    edges,
    clusters: [],
    meta: {
      candidate: 'baseline',
      graphIndex,
      nodeCount: graph.nodes.length,
      edgeCount: graph.edges.length,
      clusterCount: 0,
      majorCount: 0,
      minorCount: 0,
    },
  };
}
