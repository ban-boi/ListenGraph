import type { ViewType } from '@listen-graphic/schema';
import type { RendererGraph } from '@listen-graphic/graph-renderers';
import type { GraphNodeCardData } from '@listen-graphic/ui';

// ===== React Flow 调试节点 =====

export type ReactFlowDebugNodeData = Omit<GraphNodeCardData, 'onClickTime'>;

export type ReactFlowDebugNode = {
  id: string;
  type: 'graphNode';
  position: { x: number; y: number };
  data: ReactFlowDebugNodeData;
  style?: Record<string, unknown>;
};

export type ReactFlowDebugEdge = {
  id: string;
  source: string;
  target: string;
  label: string;
  type: 'default';
  sourceHandle: SourceHandleId;
  targetHandle: TargetHandleId;
  style: { stroke: string; opacity?: number };
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

export type EdgePriority = 'primary' | 'secondary' | 'hidden';

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

export type AutoTourDisplayMode = 'compact' | 'readable';

export type AutoTourStageKind = 'structure' | 'reading';

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

export type AutoTourStage = AutoTourBatch & {
  kind: AutoTourStageKind;
  displayMode: AutoTourDisplayMode;
};

export type AutoTourUnit = {
  sessionId: string;
  revision: number;
  stages: AutoTourStage[];
};

export type AutoTourStatus = 'idle' | 'touring' | 'paused';

// ===== 自定义节点 =====

export type GraphNodeData = GraphNodeCardData;

// ===== Pipeline 详情事实（供 detail composer 消费） =====

/** 最近一次稳定转写尾部，at 取自 transcript.endMs（reducer 纯函数，不用 Date.now） */
export type LastTranscriptTail = {
  text: string;
  stable: boolean;
  at: number;
} | null;

/** 最近一次合并图谱增量，at 取自 mergedGraph.updatedAt（reducer 纯函数，不用 Date.now） */
export type LastGraphDelta = {
  addedNodeCount: number;
  addedEdgeCount: number;
  at: number;
} | null;

/** Pipeline 模块卡片数据（Task 6 detail composer 使用） */
export type PipelineModuleData = {
  label: string;
  detail: string;
  tone: StatusCardTone;
};

