import type { MergedGraph, NodeType, GraphEdge } from '@listen-graphic/schema';

export const LONG_LABEL_THRESHOLD = 40;

export type StructureMetrics = {
  nodeCount: number;
  edgeCount: number;
  isLargeGraph: boolean;
  nodeTypeCounts: Partial<Record<NodeType, number>>;
  edgeTypeCounts: Partial<Record<GraphEdge['type'], number>>;
  opposesCount: number;
  opposesRatio: number | null;
  connectedComponents: number;
  largestComponentRatio: number | null;
  maxOutDegree: number;
  maxOutDegreeNodeId: string | null;
  maxInDegree: number;
  maxInDegreeNodeId: string | null;
  avgDegree: number | null;
  spanMs: number;
  speakerCounts: Record<string, number>;
  crossSpeakerEdgeRatio: number | null;
  opposesCrossSpeakerRatio: number | null;
  longLabelNodeCount: number;
};

export type SimplifiedGraphJSON = {
  nodes: Array<{ id: string; type: NodeType; text: string; speaker?: string }>;
  edges: Array<{ source: string; target: string; type: GraphEdge['type'] }>;
};

export type DetectorCheck = {
  pattern: string;
  rootNodeId?: string;
};

export type Annotation = {
  graphIndex: number;
  semanticReading: string;
  layoutFailures: string[];
  detectorMismatch: boolean;
  detectorHitNote?: string;
  visualTreatment: string;
  confidence: 'high' | 'medium' | 'low';
};

export type GraphSnapshot = {
  graphIndex: number;
  source: MergedGraph;
  simplified: SimplifiedGraphJSON;
  metrics: StructureMetrics;
  detector: DetectorCheck;
};
