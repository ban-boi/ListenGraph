import type { MergedGraph, ViewType } from '@listen-graphic/schema';

export function scoreViews(graph: MergedGraph): Record<ViewType, number> {
  const scores: Record<ViewType, number> = {
    timeline: 0,
    causal: 0,
    comparison: 0,
    hierarchy: 0,
  };

  for (const edge of graph.edges) {
    if (edge.type === 'follows') {
      scores.timeline += 2;
    }
    if (edge.type === 'causes') {
      scores.causal += 3;
    }
    if (edge.type === 'opposes') {
      scores.comparison += 3;
    }
    if (edge.type === 'supports') {
      scores.causal += 1;
      scores.hierarchy += 1;
    }
    if (edge.type === 'example_of') {
      scores.hierarchy += 2;
    }
  }

  return scores;
}

export function pickDefaultView(graph: MergedGraph): ViewType {
  const scores = scoreViews(graph);
  return Object.entries(scores).sort((a, b) => b[1] - a[1])[0][0] as ViewType;
}
