import type { GraphNodeStatus, NodeType, ViewType, EdgeType } from '@listen-graphic/schema';

export interface RendererNode {
  id: string;
  label: string;
  type: NodeType;
  speaker?: string;
  timestampMs: number;
  status: GraphNodeStatus;
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
}
