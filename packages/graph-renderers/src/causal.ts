import type { MergedGraph } from '@listen-graphic/schema';
import type { RendererGraph } from './types';

export function toCausalRendererGraph(graph: MergedGraph): RendererGraph {
  return {
    viewType: 'causal',
    nodes: graph.nodes.map((n) => ({
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
