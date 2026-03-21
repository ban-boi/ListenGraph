import type { MergedGraph } from '@listen-graphic/schema';
import type { RendererGraph } from './types';

/**
 * 时间线视图渲染器
 * 按时间顺序排列节点，适合人物经历、项目发展、事件复盘
 */
export function toTimelineRendererGraph(graph: MergedGraph): RendererGraph {
  // 按时间戳排序节点
  const sortedNodes = [...graph.nodes].sort(
    (a, b) => a.timestampMs - b.timestampMs,
  );

  return {
    viewType: 'timeline',
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
