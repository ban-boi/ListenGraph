import type { MergedGraph, EdgeType } from '@listen-graphic/schema';

// 坐标（与产品 StableNodePosition 一致）
export type Position = { x: number; y: number };

// 三种渲染项类型（spec 2.2 RenderModel）
export type RenderItem =
  | { kind: 'fullNode'; nodeId: string; position: Position }
  | { kind: 'looseNoteItem'; nodeId: string; position: Position }
  | {
      kind: 'clusterSummary';
      clusterId: string;
      position: Position;
      nodeCount: number;
      edgeCount: number;
    };

// 边（只含 fullNode 之间的边）
export type RenderEdge = {
  source: string;
  target: string;
  type: EdgeType;
};

// 簇元信息
export type ClusterInfo = {
  id: string;
  type: 'major' | 'minor';
  nodeIds: string[];
  bounds: { x: number; y: number; width: number; height: number };
};

// 三候选共用的渲染模型
export type RenderModel = {
  items: RenderItem[];
  edges: RenderEdge[];
  clusters: ClusterInfo[];
  meta: {
    candidate: 'baseline' | 'A' | 'B' | 'R3a' | 'R3b';
    graphIndex: number;
    nodeCount: number;
    edgeCount: number;
    clusterCount: number;
    majorCount: number;
    minorCount: number;
  };
};

// 簇分区结果（Task 3 产出，Task 4/5 消费）
export type ClusterPartition = {
  clusters: Array<{
    id: string;
    nodeIds: string[];
    edges: Array<{ source: string; target: string; type: EdgeType }>;
    type: 'major' | 'minor';
  }>;
  danglingEdges: Array<{ source: string; target: string; type: EdgeType }>;
  selfLoopNodes: string[];
};

// 布局常量（与产品 graph-utils.ts 一致）
export const CARD_WIDTH = 220;
export const CARD_HEIGHT = 132;
export const CLUSTER_GAP = 60; // cluster 间 packing gap
export const LOOSE_NOTE_ITEM_HEIGHT = 32;
export const LOOSE_NOTE_ITEM_WIDTH = 200;
