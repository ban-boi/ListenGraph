import type { MergedGraph } from '@listen-graphic/schema';
import type { RendererGraph } from './types';

/**
 * 对比/辩论视图渲染器
 * 按 speaker 或立场分组，适合正反讨论、多方观点冲突
 */
export function toComparisonRendererGraph(graph: MergedGraph): RendererGraph {
  // 按 speaker 分组排序（有 speaker 的排前面）
  const sortedNodes = [...graph.nodes].sort((a, b) => {
    if (a.speaker && !b.speaker) return -1;
    if (!a.speaker && b.speaker) return 1;
    if (a.speaker && b.speaker) return a.speaker.localeCompare(b.speaker);
    return a.timestampMs - b.timestampMs;
  });

  return {
    viewType: 'comparison',
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
