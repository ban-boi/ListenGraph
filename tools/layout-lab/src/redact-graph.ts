import type { MergedGraph, ViewType } from '@listen-graphic/schema';

export type RedactOptions = {
  caseId: string;
};

/** graph-fixtures / schema ViewType；dump 可能含历史多余键（如 flow），入库前剔除。 */
const ALLOWED_VIEWS = new Set<ViewType>([
  'timeline',
  'causal',
  'comparison',
  'hierarchy',
]);

/** 用等长占位符替换真实文本，保留布局尺寸相关的长度信号。 */
export function redactText(text: string, seed: string): string {
  const len = Math.max(1, text.length);
  const unit = `N${seed} `;
  let out = '';
  while (out.length < len) out += unit;
  return out.slice(0, len);
}

function sanitizeViewHints(
  viewHints: MergedGraph['viewHints'],
): MergedGraph['viewHints'] {
  if (!viewHints) return undefined;
  const scores = viewHints.scores
    ? (Object.fromEntries(
        Object.entries(viewHints.scores).filter(([k]) =>
          ALLOWED_VIEWS.has(k as ViewType),
        ),
      ) as Partial<Record<ViewType, number>>)
    : undefined;
  const defaultView =
    viewHints.defaultView && ALLOWED_VIEWS.has(viewHints.defaultView)
      ? viewHints.defaultView
      : undefined;
  return { defaultView, scores };
}

export function redactMergedGraph(graph: MergedGraph, opts: RedactOptions): MergedGraph {
  return {
    ...graph,
    sessionId: `regression_${opts.caseId}`,
    topics: (graph.topics ?? []).map((t, i) => ({
      ...t,
      title: `Topic ${i + 1}`,
    })),
    nodes: graph.nodes.map((n, i) => ({
      ...n,
      text: redactText(n.text, String(i + 1)),
      evidenceChunkIds: [],
      speaker: n.speaker ? `S${(i % 3) + 1}` : undefined,
    })),
    edges: graph.edges.map((e) => ({
      ...e,
      evidenceChunkIds: [],
    })),
    viewHints: sanitizeViewHints(graph.viewHints),
  };
}
