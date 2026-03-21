import type { MergedGraph } from '@listen-graphic/schema';
import type { RendererGraph } from './types';

/**
 * 流程视图渲染器
 * 单向步骤流，follows 关系驱动，适合方法论分享、操作步骤
 */
export function toFlowRendererGraph(graph: MergedGraph): RendererGraph {
  // 按时间戳排序，适合步骤流展示
  const sortedNodes = [...graph.nodes].sort(
    (a, b) => a.timestampMs - b.timestampMs,
  );

  return {
    viewType: 'flow',
    nodes: sortedNodes.map((n) => ({
      id: n.id,
      label: n.text,
      type: n.type,
      speaker: n.speaker,
      timestampMs: n.timestampMs,
      status: n.status,
    })),
    edges: graph.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      relation: e.type,
    })),
  };
}
