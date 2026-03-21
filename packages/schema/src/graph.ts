export type NodeType =
  | 'claim'
  | 'reason'
  | 'example'
  | 'question'
  | 'conclusion';

export type EdgeType =
  | 'supports'
  | 'opposes'
  | 'causes'
  | 'follows'
  | 'example_of';

export type GraphNodeStatus = 'draft' | 'confirmed';

export type ViewType =
  | 'timeline'
  | 'causal'
  | 'comparison'
  | 'flow'
  | 'hierarchy';

export interface GraphNode {
  id: string;
  type: NodeType;
  text: string;
  speaker?: string;
  timestampMs: number;
  confidence?: number;
  status: GraphNodeStatus;
  topicId?: string;
  evidenceChunkIds?: string[];
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: EdgeType;
  confidence?: number;
  evidenceChunkIds?: string[];
}

export interface SegmentGraph {
  segmentId: string;
  sessionId: string;
  startMs: number;
  endMs: number;
  topic?: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  provider: string;
  raw?: unknown;
}

export interface MergedGraph {
  sessionId: string;
  revision: number;
  topics: Array<{
    topicId: string;
    title: string;
    startMs: number;
    endMs: number;
  }>;
  nodes: GraphNode[];
  edges: GraphEdge[];
  viewHints?: {
    defaultView?: ViewType;
    scores?: Partial<Record<ViewType, number>>;
  };
  updatedAt: number;
}
