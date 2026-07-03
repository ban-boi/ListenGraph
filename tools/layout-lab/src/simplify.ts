import type { MergedGraph } from '@listen-graphic/schema';
import type { SimplifiedGraphJSON } from './types';

// 精简 graph JSON：只保留 LLM/人判断需要的字段，去掉 confidence/evidenceChunkIds 等
export function simplifyGraph(graph: MergedGraph): SimplifiedGraphJSON {
  return {
    nodes: graph.nodes.map((n) => ({
      id: n.id,
      type: n.type,
      text: n.text,
      ...(n.speaker ? { speaker: n.speaker } : {}),
    })),
    edges: graph.edges.map((e) => ({
      source: e.source,
      target: e.target,
      type: e.type,
    })),
  };
}
