import type { GraphNodeStatus, NodeType, ViewType, EdgeType } from '@listen-graphic/schema';

export type RendererLayoutRole = 'root' | 'branch' | 'support' | 'chain';

export type SemanticLayoutPattern =
  | 'question-branches'
  | 'claim-reason-example'
  | 'opposition'
  | 'causal-chain'
  | 'timeline-note';

export interface RendererNode {
  id: string;
  label: string;
  type: NodeType;
  speaker?: string;
  timestampMs: number;
  status: GraphNodeStatus;
  layoutRole?: RendererLayoutRole;
}

export interface RendererEdge {
  id: string;
  source: string;
  target: string;
  relation: EdgeType;
}

export interface RendererGraph {
  viewType: ViewType;
  nodes: RendererNode[];
  edges: RendererEdge[];
  layoutHints?: {
    semanticPattern?: SemanticLayoutPattern;
    rootNodeId?: string;
    branchNodeIds?: string[];
    chainNodeIds?: string[];
  };
}
