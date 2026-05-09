import type { ViewType } from '@listen-graphic/schema';
import type { RendererGraph } from '@listen-graphic/graph-renderers';

// ===== React Flow 调试节点 =====

export type ReactFlowDebugNodeData = {
  label: string;
  nodeType: string;
  speaker?: string;
  timestampMs: number;
  status: 'draft' | 'confirmed';
  isActive: boolean;
};

export type ReactFlowDebugNode = {
  id: string;
  type: 'graphNode';
  position: { x: number; y: number };
  data: ReactFlowDebugNodeData;
};

export type ReactFlowDebugEdge = {
  id: string;
  source: string;
  target: string;
  label: string;
  type: 'default';
  sourceHandle: SourceHandleId;
  targetHandle: TargetHandleId;
  style: { stroke: string };
  animated: boolean;
};

// ===== 调试视图 =====

export type DebugViewArtifact = {
  rendererGraph: RendererGraph;
  layoutDiagnostics: {
    reusedPositions: number;
    newPositions: number;
    movedPositions: number;
  };
  reactFlow: {
    nodes: ReactFlowDebugNode[];
    edges: ReactFlowDebugEdge[];
  };
};

export type DebugExportMode = 'slim' | 'full';

// ===== 时间轴 =====

export type TimelineStage = 'system' | 'asr' | 'structurer' | 'graph';
export type TimelineTone = 'neutral' | 'success' | 'warning' | 'error';
export type TimelineEvent = {
  id: string;
  timestamp: number;
  stage: TimelineStage;
  message: string;
  detail?: string;
  tone: TimelineTone;
  transientKey?: string;
  aggregationKey?: string;
  repeatCount?: number;
};

// ===== 状态卡片 =====

export type StatusCardTone = 'neutral' | 'waiting' | 'active' | 'success' | 'warning' | 'congested' | 'error';
export type StatusCardData = {
  label: string;
  status: string;
  detail: string;
  tone: StatusCardTone;
};

// ===== 图布局稳定性 =====

export type StableNodePosition = {
  x: number;
  y: number;
};

export type EdgeHandleId = 'top' | 'bottom' | 'left' | 'right';
export type SourceHandleId = `source-${EdgeHandleId}`;
export type TargetHandleId = `target-${EdgeHandleId}`;

export type StableViewLayoutState = {
  positions: Record<string, StableNodePosition>;
};

export type StableLayoutCache = Record<ViewType, StableViewLayoutState>;

export type ViewBounds = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

// ===== 自动导览 =====

export type AutoTourSeed = {
  sessionId: string;
  revision: number;
  nodeIds: string[];
  anchorNodeIds: string[];
};

export type AutoTourBatch = {
  nodeIds: string[];
  anchorNodeIds: string[];
  dwellMs: number;
};

export type AutoTourStatus = 'idle' | 'touring' | 'paused';

// ===== 自定义节点 =====

export interface GraphNodeData {
  label: string;
  nodeType: string;
  speaker?: string;
  timestampMs: number;
  status: 'draft' | 'confirmed';
  isActive: boolean;
  onClickTime: (ms: number) => void;
}
