import type { MergedGraph, GraphEdge, GraphNode, NodeType } from '@listen-graphic/schema';
import type {
  RendererGraph,
  RendererLayoutRole,
  SemanticLayoutPattern,
} from './types';

export type HierarchyPattern = {
  pattern: SemanticLayoutPattern;
  rootNodeId?: string;
  branchNodeIds?: string[];
  chainNodeIds?: string[];
  roles: Record<string, RendererLayoutRole>;
};

const typeOrder: Record<NodeType, number> = {
  question: 0,
  claim: 1,
  conclusion: 2,
  reason: 3,
  example: 4,
};

function outgoingEdges(nodeId: string, edges: GraphEdge[], type?: GraphEdge['type']) {
  return edges.filter((edge) => edge.source === nodeId && (!type || edge.type === type));
}

function byTimestamp(nodeById: Map<string, GraphNode>) {
  return (leftId: string, rightId: string) => {
    const left = nodeById.get(leftId);
    const right = nodeById.get(rightId);
    return (left?.timestampMs ?? 0) - (right?.timestampMs ?? 0);
  };
}

function detectQuestionBranches(
  nodes: GraphNode[],
  edges: GraphEdge[],
): HierarchyPattern | null {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  for (const question of nodes.filter((node) => node.type === 'question')) {
    const branchNodeIds = outgoingEdges(question.id, edges, 'supports')
      .map((edge) => edge.target)
      .filter((id) => nodeById.get(id)?.type === 'claim')
      .sort(byTimestamp(nodeById));

    if (branchNodeIds.length >= 2) {
      return {
        pattern: 'question-branches',
        rootNodeId: question.id,
        branchNodeIds,
        roles: Object.fromEntries([
          [question.id, 'root'],
          ...branchNodeIds.map((id) => [id, 'branch'] as const),
        ]),
      };
    }
  }
  return null;
}

function detectClaimReasonExample(
  nodes: GraphNode[],
  edges: GraphEdge[],
): HierarchyPattern | null {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  for (const claim of nodes.filter((node) => node.type === 'claim')) {
    const reasonIds = outgoingEdges(claim.id, edges, 'supports')
      .map((edge) => edge.target)
      .filter((id) => nodeById.get(id)?.type === 'reason')
      .sort(byTimestamp(nodeById));

    const exampleIds = reasonIds.flatMap((reasonId) =>
      outgoingEdges(reasonId, edges)
        .filter((edge) => edge.type === 'supports' || edge.type === 'example_of')
        .map((edge) => edge.target)
        .filter((id) => nodeById.get(id)?.type === 'example'),
    );

    if (reasonIds.length > 0 && exampleIds.length > 0) {
      return {
        pattern: 'claim-reason-example',
        rootNodeId: claim.id,
        branchNodeIds: [...reasonIds, ...exampleIds],
        roles: Object.fromEntries([
          [claim.id, 'root'],
          ...reasonIds.map((id) => [id, 'branch'] as const),
          ...exampleIds.map((id) => [id, 'support'] as const),
        ]),
      };
    }
  }
  return null;
}

function detectOpposition(nodes: GraphNode[], edges: GraphEdge[]): HierarchyPattern | null {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const opposition = edges.find(
    (edge) => edge.type === 'opposes' && nodeById.has(edge.source) && nodeById.has(edge.target),
  );
  if (!opposition) return null;

  return {
    pattern: 'opposition',
    rootNodeId: opposition.source,
    branchNodeIds: [opposition.target],
    roles: {
      [opposition.source]: 'root',
      [opposition.target]: 'branch',
    },
  };
}

function detectCausalChain(nodes: GraphNode[], edges: GraphEdge[]): HierarchyPattern | null {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const causalEdges = edges.filter(
    (edge) => edge.type === 'causes' && nodeById.has(edge.source) && nodeById.has(edge.target),
  );
  if (causalEdges.length < 2) return null;

  const targets = new Set(causalEdges.map((edge) => edge.target));
  const startEdge = causalEdges.find((edge) => !targets.has(edge.source)) ?? causalEdges[0];
  const chainNodeIds = [startEdge.source];
  let currentId = startEdge.source;
  const visited = new Set<string>();

  while (!visited.has(currentId)) {
    visited.add(currentId);
    const nextEdge = causalEdges.find((edge) => edge.source === currentId);
    if (!nextEdge) break;
    chainNodeIds.push(nextEdge.target);
    currentId = nextEdge.target;
  }

  if (chainNodeIds.length < 3) return null;

  return {
    pattern: 'causal-chain',
    rootNodeId: chainNodeIds[0],
    chainNodeIds,
    roles: Object.fromEntries(
      chainNodeIds.map((id, index) => [id, index === 0 ? 'root' : 'chain'] as const),
    ),
  };
}

function detectTimelineNote(nodes: GraphNode[], edges: GraphEdge[]): HierarchyPattern | null {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const followsEdges = edges.filter(
    (edge) => edge.type === 'follows' && nodeById.has(edge.source) && nodeById.has(edge.target),
  );
  const noteEdge = edges.find(
    (edge) =>
      edge.type === 'supports' &&
      followsEdges.some((followEdge) => followEdge.target === edge.source) &&
      nodeById.get(edge.target)?.type === 'example',
  );

  if (!noteEdge) return null;

  const timelineIds = Array.from(
    new Set(followsEdges.flatMap((edge) => [edge.source, edge.target])),
  ).sort(byTimestamp(nodeById));

  return {
    pattern: 'timeline-note',
    rootNodeId: timelineIds[0],
    chainNodeIds: timelineIds,
    branchNodeIds: [noteEdge.target],
    roles: Object.fromEntries([
      ...timelineIds.map((id, index) => [id, index === 0 ? 'root' : 'chain'] as const),
      [noteEdge.target, 'support'],
    ]),
  };
}

export function detectHierarchyLayoutPattern(graph: MergedGraph): HierarchyPattern | null {
  return (
    detectQuestionBranches(graph.nodes, graph.edges) ??
    detectClaimReasonExample(graph.nodes, graph.edges) ??
    detectOpposition(graph.nodes, graph.edges) ??
    detectCausalChain(graph.nodes, graph.edges) ??
    detectTimelineNote(graph.nodes, graph.edges)
  );
}

/**
 * 层级框架视图渲染器。
 *
 * 这里先识别少量高频语义模式，再把 root/branch 等角色透传给
 * Extension stable layout。自由图谱仍然可用；这些 hint 只是在常见结构
 * 出现时给布局一个明确的图形语法。
 */
export function toHierarchyRendererGraph(graph: MergedGraph): RendererGraph {
  const pattern = detectHierarchyLayoutPattern(graph);
  const rankedIds = Array.from(
    new Set(
      [
        pattern?.rootNodeId,
        ...(pattern?.chainNodeIds ?? []),
        ...(pattern?.branchNodeIds ?? []),
      ].filter((id): id is string => Boolean(id)),
    ),
  );
  const rankById = new Map(rankedIds.map((id, index) => [id, index]));

  const sortedNodes = [...graph.nodes].sort((a, b) => {
    const rankA = rankById.get(a.id);
    const rankB = rankById.get(b.id);
    if (rankA !== undefined || rankB !== undefined) {
      return (rankA ?? Number.MAX_SAFE_INTEGER) - (rankB ?? Number.MAX_SAFE_INTEGER);
    }

    const orderA = typeOrder[a.type] ?? 5;
    const orderB = typeOrder[b.type] ?? 5;
    if (orderA !== orderB) return orderA - orderB;
    return a.timestampMs - b.timestampMs;
  });

  return {
    viewType: 'hierarchy',
    nodes: sortedNodes.map((node) => ({
      id: node.id,
      label: node.text,
      type: node.type,
      speaker: node.speaker,
      timestampMs: node.timestampMs,
      status: node.status,
      layoutRole: pattern?.roles[node.id],
    })),
    edges: graph.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      relation: edge.type,
    })),
    layoutHints: pattern
      ? {
          semanticPattern: pattern.pattern,
          rootNodeId: pattern.rootNodeId,
          branchNodeIds: pattern.branchNodeIds,
          chainNodeIds: pattern.chainNodeIds,
        }
      : undefined,
  };
}
