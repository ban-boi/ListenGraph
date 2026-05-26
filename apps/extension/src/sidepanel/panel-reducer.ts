/**
 * panel-reducer.ts
 *
 * 将 App.tsx 中约 20 个消息驱动的 useState 收敛为单一 useReducer。
 * 所有 Chrome 消息处理中的 setState 调用在此映射为 reducer action。
 */

import type {
  ViewType,
  MergedGraph,
} from '@listen-graphic/schema';
import type {
  RuntimeSnapshot,
  SessionState,
} from '../shared/messages';
import { createEmptyGraph, MAX_TIMELINE_EVENTS } from './constants';
import { formatGraphDeltaLog } from './debug-export-utils';
import type { TimelineEvent } from './types';
import {
  upsertTimelineEvent,
  stripTimelineTransientEvents,
  finalizeTransientEvent,
  createTimelineEvent,
  classifyProgressTone,
} from './timeline-utils';

// ===== Bridge Health 类型 =====

export type BridgeHealthStatus =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'listening'
  | 'closing'
  | 'closed'
  | 'error';

export interface BridgeHealth {
  status: BridgeHealthStatus;
  detail?: string;
}

// ===== PanelState =====

export interface PanelState {
  /** 会话状态机当前状态 */
  sessionState: SessionState;
  /** 当前会话 ID */
  sessionId: string | null;
  /** 用户是否正在等待停止 */
  stopPending: boolean;
  /** 当前合并图谱 */
  graph: MergedGraph;
  /** 当前选中的视图类型 */
  currentView: ViewType;
  /** 当前播放时间（毫秒） */
  currentTimeMs: number;
  /** 当前选中的节点 ID */
  selectedNodeId: string | null;
  /** 最近一次 provider 错误 */
  recentProviderError: RuntimeSnapshot['lastProviderError'];
  /** 最近一次 structurer 运行的调试信息 */
  lastStructurerRun: RuntimeSnapshot['lastStructurerRun'];
  /** structurer 进入 structuring 状态的时间戳 */
  structuringSince: number | null;
  /** 最近一次收到 ASR 转写的时间戳 */
  lastTranscriptAt: number | null;
  /** 最近一次图谱更新的时间戳 */
  lastGraphUpdatedAt: number | null;
  /** 待处理的转写块数量 */
  pendingTranscriptCount: number;
  /** 待处理的工作数量 */
  pendingWorkCount: number;
  /** 停止会话后待排空的工作数量 */
  stopDrainPendingCount: number;
  /** 当前 structurer 正在处理的目标转写信息 */
  currentStructurerTarget: RuntimeSnapshot['currentStructurerTarget'];
  /** Service Worker 构建标签 */
  workerBuildLabel: string;
  /** ASR Bridge 健康状态 */
  bridgeHealth: BridgeHealth;
  /** 时间轴事件列表 */
  timelineEvents: TimelineEvent[];
}

// ===== 初始状态 =====

export const initialPanelState: PanelState = {
  sessionState: 'idle',
  sessionId: null,
  stopPending: false,
  graph: createEmptyGraph(),
  currentView: 'causal',
  currentTimeMs: 0,
  selectedNodeId: null,
  recentProviderError: null,
  lastStructurerRun: null,
  structuringSince: null,
  lastTranscriptAt: null,
  lastGraphUpdatedAt: null,
  pendingTranscriptCount: 0,
  pendingWorkCount: 0,
  stopDrainPendingCount: 0,
  currentStructurerTarget: null,
  workerBuildLabel: 'waiting',
  bridgeHealth: { status: 'idle' },
  timelineEvents: [],
};

// ===== 辅助类型：SESSION_STATE_CHANGED payload =====

export interface SessionStateChangedPayload {
  sessionId: string | null;
  state: SessionState;
  mergedGraph?: MergedGraph | null;
  currentTimeMs?: number;
  currentView?: ViewType;
  currentViewPinned?: boolean;
  pendingTranscriptCount?: number;
  pendingWorkCount?: number;
  stopDrainPendingCount?: number;
  currentStructurerTarget?: RuntimeSnapshot['currentStructurerTarget'];
  /** dispatch 时从 ref 读入，reducer 内部使用 */
  shouldPreserveView: boolean;
}

// ===== PanelAction 联合类型 =====

export type PanelAction =
  | { type: 'SESSION_STATE_CHANGED'; payload: SessionStateChangedPayload }
  | {
      type: 'TRANSCRIPT_READY';
      payload: {
        transcript: {
          text: string;
          startMs: number;
          endMs: number;
          provider: string;
        };
        /** dispatch 时从 ref 读入 */
        utteranceKey: string;
      };
    }
  | {
      type: 'PROVIDER_PROGRESS';
      payload: {
        stage: 'asr' | 'structurer';
        message: string;
        asrSliceType?: 0 | 1;
        /** dispatch 时从 ref 读入 */
        asrUtteranceIndex: number;
        /** 是否为 external ASR 类型 */
        isExternalAsr: boolean;
      };
    }
  | {
      type: 'MERGED_GRAPH_UPDATED';
      payload: {
        graph: MergedGraph;
        /** dispatch 时从 ref 读入 */
        shouldPreserveView: boolean;
        /** dispatch 时从 ref 读入 */
        previousGraph: MergedGraph;
        /** auto-tour seed 相关 */
        addedNodeIds: string[];
        anchorNodeIds: string[];
      };
    }
  | { type: 'PLAYBACK_TIME_UPDATED'; payload: { currentTimeMs: number } }
  | { type: 'ERROR'; payload: { code: string; message: string } }
  | { type: 'HYDRATE_SNAPSHOT'; payload: RuntimeSnapshot & { preferredView: ViewType } }
  | { type: 'RESET_CONTEXT' }
  | { type: 'RESET_RUNTIME_UI' }
  | { type: 'PUSH_TIMELINE_EVENT'; payload: { event: TimelineEvent } }
  | { type: 'CLEAR_TIMELINE_TRANSIENT'; payload: { transientKey: string } }
  | {
      type: 'FINALIZE_TIMELINE_TRANSIENT';
      payload: { transientKey: string; updates: Partial<TimelineEvent> };
    }
  | { type: 'SET_STOP_PENDING'; payload: { stopPending: boolean } }
  | { type: 'SELECT_NODE'; payload: { nodeId: string | null } };

// ===== Reducer =====

export function panelReducer(state: PanelState, action: PanelAction): PanelState {
  switch (action.type) {
    // ---- SESSION_STATE_CHANGED ----
    case 'SESSION_STATE_CHANGED': {
      const p = action.payload;
      let nextGraph = state.graph;
      let nextCurrentTimeMs = state.currentTimeMs;
      let nextCurrentView = state.currentView;
      let nextSelectedNodeId = state.selectedNodeId;
      let nextStopPending = state.stopPending;
      let nextStructuringSince = state.structuringSince;

      // --- stopped 分支 ---
      if (p.state === 'stopped') {
        if (p.mergedGraph) {
          const mergedGraph = p.mergedGraph;
          nextGraph = mergedGraph;
          if (typeof p.currentTimeMs === 'number') {
            nextCurrentTimeMs = p.currentTimeMs;
          }
          if (!p.shouldPreserveView) {
            const rawDefault = mergedGraph.viewHints?.defaultView ?? 'causal';
            nextCurrentView = p.currentView ?? rawDefault;
          }
        } else {
          nextGraph = createEmptyGraph();
          nextCurrentTimeMs = 0;
          nextCurrentView = 'causal';
        }
      }

      // --- idle（非 stopped）分支 ---
      const nextState: SessionState = p.state === 'stopped' ? 'idle' : p.state;
      if (nextState === 'idle' && p.state !== 'stopped') {
        nextGraph = createEmptyGraph();
        nextCurrentTimeMs = 0;
        nextSelectedNodeId = null;
        nextCurrentView = 'causal';
      }

      // --- stopPending 清除 ---
      if (p.state === 'stopped' || p.state === 'error') {
        nextStopPending = false;
      }

      // --- structuringSince ---
      if (nextState === 'structuring') {
        nextStructuringSince = state.structuringSince ?? Date.now();
      } else if (nextState !== 'error') {
        nextStructuringSince = null;
      }

      // --- sessionId ---
      const nextSessionId =
        p.state === 'stopped'
          ? p.sessionId
          : nextState === 'idle'
            ? null
            : p.sessionId;

      // --- timeline event ---
      const timelineEvent = createTimelineEvent({
        stage: 'system',
        message: `状态切换为 ${p.state}`,
        tone:
          p.state === 'error'
            ? 'error'
            : p.state === 'stopped'
              ? 'warning'
              : 'neutral',
      });

      return {
        ...state,
        sessionState: nextState,
        sessionId: nextSessionId,
        stopPending: nextStopPending,
        graph: nextGraph,
        currentTimeMs: nextCurrentTimeMs,
        selectedNodeId: nextSelectedNodeId,
        currentView: nextCurrentView,
        structuringSince: nextStructuringSince,
        pendingTranscriptCount: p.pendingTranscriptCount ?? 0,
        pendingWorkCount: p.pendingWorkCount ?? 0,
        stopDrainPendingCount: p.stopDrainPendingCount ?? 0,
        currentStructurerTarget: p.currentStructurerTarget ?? null,
        timelineEvents: upsertTimelineEvent(state.timelineEvents, timelineEvent),
      };
    }

    // ---- TRANSCRIPT_READY ----
    case 'TRANSCRIPT_READY': {
      const { transcript, utteranceKey } = action.payload;
      const finalized = finalizeTransientEvent(
        state.timelineEvents,
        utteranceKey,
        {
          message: `转写: ${transcript.text}`,
          detail: `${formatTime(transcript.startMs)}-${formatTime(transcript.endMs)} | ${transcript.provider}`,
          tone: 'success',
        },
      );
      return {
        ...state,
        recentProviderError: null,
        lastTranscriptAt: Date.now(),
        timelineEvents: finalized,
      };
    }

    // ---- PROVIDER_PROGRESS ----
    case 'PROVIDER_PROGRESS': {
      const { stage, message: progressMessage, asrSliceType, asrUtteranceIndex, isExternalAsr } =
        action.payload;

      let nextBridgeHealth = state.bridgeHealth;
      let nextStructuringSince = state.structuringSince;

      // --- ASR bridge health ---
      if (stage === 'asr' && isExternalAsr) {
        if (progressMessage.includes('连接中')) {
          nextBridgeHealth = { status: 'connecting', detail: progressMessage };
        } else if (progressMessage.includes('已连接')) {
          nextBridgeHealth = { status: 'connected', detail: progressMessage };
        } else if (progressMessage.includes('握手成功') || progressMessage.includes('ready')) {
          nextBridgeHealth = { status: 'listening', detail: progressMessage };
        } else if (progressMessage.includes('已断开')) {
          nextBridgeHealth = { status: 'closed', detail: progressMessage };
        }
      }

      // --- structurer start/finish/fail ---
      const isStructurerStarted =
        stage === 'structurer' && progressMessage.startsWith('Structurer started');
      const isStructurerFinished =
        stage === 'structurer' && progressMessage.startsWith('Structurer finished');
      const isStructurerFailed =
        stage === 'structurer' && progressMessage.startsWith('Structurer failed');
      const isStopDrain =
        stage === 'structurer' && progressMessage.startsWith('Stop requested');

      if (isStructurerStarted) {
        nextStructuringSince = Date.now();
      }
      if (isStructurerFinished || isStructurerFailed) {
        nextStructuringSince = null;
      }

      // --- timeline event ---
      const transientKey =
        asrSliceType !== undefined
          ? `asr-utterance-${asrUtteranceIndex}`
          : undefined;

      const timelineEvent = createTimelineEvent({
        stage,
        message: progressMessage,
        tone: classifyProgressTone({
          isStructurerFinished,
          isStructurerFailed,
          isStopDrain,
          progressMessage,
        }),
        transientKey,
      });

      return {
        ...state,
        bridgeHealth: nextBridgeHealth,
        structuringSince: nextStructuringSince,
        timelineEvents: upsertTimelineEvent(state.timelineEvents, timelineEvent),
      };
    }

    // ---- MERGED_GRAPH_UPDATED ----
    case 'MERGED_GRAPH_UPDATED': {
      const { graph: nextGraph, shouldPreserveView } = action.payload;
      const nextCurrentView = shouldPreserveView
        ? state.currentView
        : (nextGraph.viewHints?.defaultView ?? 'causal');

      const timelineEvent = createTimelineEvent({
        stage: 'graph',
        message: formatGraphDeltaLog(action.payload.previousGraph, nextGraph),
        detail: `revision ${nextGraph.revision} | nodes ${nextGraph.nodes.length} | edges ${nextGraph.edges.length}`,
        tone: 'success',
      });

      return {
        ...state,
        graph: nextGraph,
        currentView: nextCurrentView,
        recentProviderError: null,
        lastGraphUpdatedAt: Date.now(),
        lastStructurerRun: null,
        structuringSince: null,
        timelineEvents: upsertTimelineEvent(state.timelineEvents, timelineEvent),
      };
    }

    // ---- PLAYBACK_TIME_UPDATED ----
    case 'PLAYBACK_TIME_UPDATED': {
      return {
        ...state,
        currentTimeMs: action.payload.currentTimeMs,
      };
    }

    // ---- ERROR ----
    case 'ERROR': {
      const { code, message } = action.payload;
      const timelineEvent = createTimelineEvent({
        stage: 'system',
        message: `错误(${code})`,
        detail: message,
        tone: 'error',
      });
      return {
        ...state,
        recentProviderError: {
          code: code as NonNullable<RuntimeSnapshot['lastProviderError']>['code'],
          message,
          provider: 'runtime',
          stage: 'structurer',
          retriable: false,
        },
        timelineEvents: upsertTimelineEvent(state.timelineEvents, timelineEvent),
      };
    }

    // ---- HYDRATE_SNAPSHOT ----
    case 'HYDRATE_SNAPSHOT': {
      const snapshot = action.payload;
      const nextState: SessionState =
        snapshot.state === 'stopped' ? 'idle' : snapshot.state;

      let nextGraph: MergedGraph;
      let nextCurrentView: ViewType;

      if (snapshot.graph) {
        nextGraph = snapshot.graph;
        nextCurrentView = action.payload.preferredView;
      } else {
        nextGraph = createEmptyGraph();
        nextCurrentView = 'causal';
      }

      return {
        ...state,
        sessionId: snapshot.sessionId ?? snapshot.graph?.sessionId ?? null,
        sessionState: nextState,
        currentTimeMs: snapshot.currentTimeMs,
        recentProviderError: snapshot.lastProviderError ?? null,
        lastStructurerRun: snapshot.lastStructurerRun ?? null,
        structuringSince: snapshot.structuringSince ?? null,
        lastTranscriptAt: snapshot.lastTranscriptAt ?? null,
        lastGraphUpdatedAt: snapshot.lastGraphUpdatedAt ?? null,
        pendingTranscriptCount: snapshot.pendingTranscriptCount ?? 0,
        pendingWorkCount: snapshot.pendingWorkCount ?? 0,
        stopDrainPendingCount: snapshot.stopDrainPendingCount ?? 0,
        currentStructurerTarget: snapshot.currentStructurerTarget ?? null,
        workerBuildLabel: snapshot.workerBuild?.label ?? 'unknown',
        graph: nextGraph,
        currentView: nextCurrentView,
      };
    }

    // ---- RESET_CONTEXT (clearHistoricalContext) ----
    case 'RESET_CONTEXT': {
      return {
        ...state,
        sessionId: null,
        graph: createEmptyGraph(),
        currentTimeMs: 0,
        selectedNodeId: null,
        currentView: 'causal',
        stopPending: false,
        recentProviderError: null,
      };
    }

    // ---- RESET_RUNTIME_UI ----
    case 'RESET_RUNTIME_UI': {
      return {
        ...state,
        timelineEvents: [],
        lastStructurerRun: null,
        structuringSince: null,
        lastTranscriptAt: null,
        lastGraphUpdatedAt: null,
        pendingTranscriptCount: 0,
        pendingWorkCount: 0,
        stopDrainPendingCount: 0,
        currentStructurerTarget: null,
      };
    }

    // ---- PUSH_TIMELINE_EVENT ----
    case 'PUSH_TIMELINE_EVENT': {
      return {
        ...state,
        timelineEvents: upsertTimelineEvent(
          state.timelineEvents,
          action.payload.event,
        ),
      };
    }

    // ---- CLEAR_TIMELINE_TRANSIENT ----
    case 'CLEAR_TIMELINE_TRANSIENT': {
      return {
        ...state,
        timelineEvents: stripTimelineTransientEvents(
          state.timelineEvents,
          action.payload.transientKey,
        ),
      };
    }

    // ---- FINALIZE_TIMELINE_TRANSIENT ----
    case 'FINALIZE_TIMELINE_TRANSIENT': {
      return {
        ...state,
        timelineEvents: finalizeTransientEvent(
          state.timelineEvents,
          action.payload.transientKey,
          action.payload.updates,
        ),
      };
    }

    // ---- SET_STOP_PENDING ----
    case 'SET_STOP_PENDING': {
      return {
        ...state,
        stopPending: action.payload.stopPending,
      };
    }

    // ---- SELECT_NODE ----
    case 'SELECT_NODE': {
      return {
        ...state,
        selectedNodeId: action.payload.nodeId,
      };
    }

    default:
      return state;
  }
}

// ===== 辅助函数 =====

/** 格式化毫秒为 mm:ss */
function formatTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}
