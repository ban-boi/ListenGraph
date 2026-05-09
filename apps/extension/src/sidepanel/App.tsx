import {
  useState,
  useEffect,
  useLayoutEffect,
  useCallback,
  useMemo,
  useRef,
} from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  type Node,
  type Edge,
  type ReactFlowInstance,
  getViewportForBounds,
} from 'reactflow';
import 'reactflow/dist/style.css';

import type {
  ViewType,
  MergedGraph,
  GraphNode,
  GraphEdge,
  ProviderConfig,
  ProviderRuntimeSummary,
} from '@listen-graphic/schema';
import { pickDefaultView, scoreViews } from '@listen-graphic/domain';
import {
  normalizeProviderConfig,
  redactProviderConfig,
} from '@listen-graphic/providers';
import type {
  AppMessage,
  DebugSessionData,
  ExportFormat,
  ReplaySessionData,
  RuntimeSnapshot,
  SessionState,
} from '../shared/messages';
import { BUILD_INFO } from '../shared/build-info';
import type {
  DebugExportMode,
  TimelineEvent,
  StatusCardData,
  StableLayoutCache,
  AutoTourSeed,
  AutoTourBatch,
  AutoTourStatus,
  GraphNodeData,
} from './types';
import {
  clampLogPanelHeight,
  formatErrorStageLabel,
  formatRelativeAge,
  createTimelineEvent,
  upsertTimelineEvent,
  stripTimelineTransientEvents,
  finalizeTransientEvent,
  classifyProgressTone,
  bridgeHealthToTone,
  getStatusCardStyles,
  timelineEventsToExportLines,
  formatTime,
} from './timeline-utils';
import {
  createEmptyStableLayoutCache,
  buildDebugViewArtifacts,
} from './graph-utils';
import {
  createEmptyGraph,
  MOCK_TRANSCRIPTS,
  NODE_TYPES,
  EDGE_TYPES,
  SPEAKERS,
  ZHIPU_ENDPOINT_CODING_PLAN,
  VIEW_TYPES,
  VIEW_LABELS,
  isDevMode,
  DEFAULT_LOG_PANEL_HEIGHT,
  MIN_LOG_PANEL_HEIGHT,
  MAX_LOG_PANEL_HEIGHT,
  MAX_TIMELINE_EVENTS,
  STRUCTURER_DELAYED_MS,
  GRAPH_JUST_UPDATED_MS,
  AUTO_REVEAL_PADDING,
  AUTO_REVEAL_DURATION_MS,
  USER_VIEWPORT_COOLDOWN_MS,
  AUTO_TOUR_RESUME_DELAY_MS,
} from './constants';
import {
  getAddedNodeIds,
  getAutoRevealAnchorNodeIds,
  getNodeBounds,
  mergeViewBounds,
  expandViewBounds,
  ensureMinimumBoundsSize,
  getAutoRevealMinimumBoundsSize,
  isViewportCloseToTarget,
  estimateAutoTourDwellMs,
  buildAutoTourBatches,
} from './auto-tour-utils';
import {
  pinProviderConfigToDirectMode,
  createExtensionDefaultProviderConfigForUi,
  resetProviderEntryForTypeChange,
} from './provider-helpers';
import {
  summarizeTranscriptUnit,
  summarizeSegment,
  summarizeStructurerRun,
  summarizeDebugData,
  buildDebugExportPayload,
  readStructurerRunDebug,
  downloadTextFile,
  formatGraphDeltaLog,
} from './debug-export-utils';
import { GraphNodeCard } from './GraphNodeCard';
import { StatusCards } from './StatusCards';
import { LogPanel } from './LogPanel';
import { DebugPanel } from './DebugPanel';
import { ReplayPanel } from './ReplayPanel';
import { SettingsPanel } from './SettingsPanel';

const nodeTypes = { graphNode: GraphNodeCard };

// ============ 主组件 ============

export default function App() {
  const [sessionState, setSessionState] = useState<SessionState>('idle');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [stopPending, setStopPending] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [debugOpen, setDebugOpen] = useState(false);
  const [debugData, setDebugData] = useState<DebugSessionData | null>(null);
  const [replayOpen, setReplayOpen] = useState(false);
  const [replayPlaying, setReplayPlaying] = useState(false);
  const [replayData, setReplayData] = useState<ReplaySessionData | null>(null);
  const [currentView, setCurrentView] = useState<ViewType>('causal');
  const [currentTimeMs, setCurrentTimeMs] = useState(0);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [timelineEvents, setTimelineEvents] = useState<TimelineEvent[]>([]);
  const [graph, setGraph] = useState<MergedGraph>(createEmptyGraph);
  const [logPanelHeight, setLogPanelHeight] = useState(DEFAULT_LOG_PANEL_HEIGHT);
  const [autoTourStatus, setAutoTourStatus] = useState<AutoTourStatus>('idle');
  const [autoTourProgress, setAutoTourProgress] = useState<{ current: number; total: number }>({
    current: 0,
    total: 0,
  });
  const [providerConfig, setProviderConfig] = useState<ProviderConfig>(() =>
    createExtensionDefaultProviderConfigForUi(),
  );
  const [providerSummary, setProviderSummary] = useState(() =>
    redactProviderConfig(createExtensionDefaultProviderConfigForUi()),
  );
  const [workerBuildLabel, setWorkerBuildLabel] = useState('waiting');
  const [recentProviderError, setRecentProviderError] = useState<RuntimeSnapshot['lastProviderError']>(null);
  const [lastStructurerRun, setLastStructurerRun] = useState<RuntimeSnapshot['lastStructurerRun']>(null);
  const [structuringSince, setStructuringSince] = useState<number | null>(null);
  const [lastTranscriptAt, setLastTranscriptAt] = useState<number | null>(null);
  const [lastGraphUpdatedAt, setLastGraphUpdatedAt] = useState<number | null>(null);
  const [pendingTranscriptCount, setPendingTranscriptCount] = useState(0);
  const [pendingWorkCount, setPendingWorkCount] = useState(0);
  const [stopDrainPendingCount, setStopDrainPendingCount] = useState(0);
  const [currentStructurerTarget, setCurrentStructurerTarget] = useState<RuntimeSnapshot['currentStructurerTarget']>(null);
  const [statusNowMs, setStatusNowMs] = useState(() => Date.now());
  const [bridgeHealth, setBridgeHealth] = useState<{
    status: 'idle' | 'connecting' | 'connected' | 'listening' | 'closing' | 'closed' | 'error';
    detail?: string;
  }>({ status: 'idle' });

  // 开发模式下的 ref
  const transcriptIndexRef = useRef(0);
  const asrUtteranceIndexRef = useRef(0);
  const sessionStartTimeRef = useRef(0);
  const userPinnedViewRef = useRef(false);
  const logResizeStartRef = useRef<{ pointerY: number; height: number } | null>(null);
  const graphRef = useRef<MergedGraph>(createEmptyGraph());
  const layoutCacheRef = useRef<StableLayoutCache>(createEmptyStableLayoutCache());
  const layoutCacheSessionRef = useRef<string | null>(null);
  const activeViewSessionRef = useRef<string | null>(null);
  const reactFlowInstanceRef = useRef<ReactFlowInstance | null>(null);
  const flowContainerRef = useRef<HTMLDivElement | null>(null);
  const hasAutoFitRef = useRef(false);
  const userViewportInteractingRef = useRef(false);
  const lastUserViewportChangeAtRef = useRef(0);
  const pendingAutoTourRef = useRef<AutoTourSeed | null>(null);
  const autoTourBatchesRef = useRef<AutoTourBatch[]>([]);
  const autoTourCurrentIndexRef = useRef(-1);
  const autoTourResumeIndexRef = useRef(0);
  const autoTourAdvanceTimerRef = useRef<number | null>(null);
  const autoTourResumeTimerRef = useRef<number | null>(null);
  const lastAutoTourKeyRef = useRef<string | null>(null);
  const structurerSlowEventKeyRef = useRef<string | null>(null);
  const previousPendingTranscriptCountRef = useRef(0);

  const pushTimelineEvent = useCallback((event: TimelineEvent) => {
    setTimelineEvents((prev) => upsertTimelineEvent(prev, event));
  }, []);

  const clearTimelineTransient = useCallback((transientKey: string) => {
    setTimelineEvents((prev) => stripTimelineTransientEvents(prev, transientKey));
  }, []);

  const finalizeTimelineTransient = useCallback(
    (transientKey: string, updates: Partial<TimelineEvent>) => {
      setTimelineEvents((prev) => finalizeTransientEvent(prev, transientKey, updates));
    },
    [],
  );

  const addLog = useCallback((msg: string) => {
    pushTimelineEvent(createTimelineEvent({ stage: 'system', message: msg }));
  }, [pushTimelineEvent]);

  const clearAutoTourAdvanceTimer = useCallback(() => {
    if (autoTourAdvanceTimerRef.current !== null) {
      window.clearTimeout(autoTourAdvanceTimerRef.current);
      autoTourAdvanceTimerRef.current = null;
    }
  }, []);

  const clearAutoTourResumeTimer = useCallback(() => {
    if (autoTourResumeTimerRef.current !== null) {
      window.clearTimeout(autoTourResumeTimerRef.current);
      autoTourResumeTimerRef.current = null;
    }
  }, []);

  const resetAutoTourState = useCallback((nextStatus: AutoTourStatus = 'idle') => {
    clearAutoTourAdvanceTimer();
    clearAutoTourResumeTimer();
    autoTourBatchesRef.current = [];
    autoTourCurrentIndexRef.current = -1;
    autoTourResumeIndexRef.current = 0;
    pendingAutoTourRef.current = null;
    lastAutoTourKeyRef.current = null;
    setAutoTourStatus(nextStatus);
    setAutoTourProgress({ current: 0, total: 0 });
  }, [clearAutoTourAdvanceTimer, clearAutoTourResumeTimer]);

  useEffect(() => () => {
    clearAutoTourAdvanceTimer();
    clearAutoTourResumeTimer();
  }, [clearAutoTourAdvanceTimer, clearAutoTourResumeTimer]);

  useEffect(() => {
    graphRef.current = graph;
  }, [graph]);

  useEffect(() => {
    if (!['capturing', 'transcribing', 'structuring'].includes(sessionState)) {
      return undefined;
    }

    const timer = window.setInterval(() => {
      setStatusNowMs(Date.now());
    }, 1000);

    return () => window.clearInterval(timer);
  }, [sessionState]);

  useEffect(() => {
    if (sessionState !== 'structuring' || !structuringSince) {
      structurerSlowEventKeyRef.current = null;
      return;
    }

    const slowEventKey = `${sessionId ?? 'unknown'}:${structuringSince}`;
    if (
      statusNowMs - structuringSince >= STRUCTURER_DELAYED_MS &&
      structurerSlowEventKeyRef.current !== slowEventKey
    ) {
      structurerSlowEventKeyRef.current = slowEventKey;
      pushTimelineEvent(createTimelineEvent({
        stage: 'structurer',
        message: 'Structurer slow',
        detail: `${Math.round((statusNowMs - structuringSince) / 100) / 10}s 仍未返回`,
        tone: 'warning',
      }));
    }
  }, [pushTimelineEvent, sessionId, sessionState, statusNowMs, structuringSince]);

  useEffect(() => {
    const previous = previousPendingTranscriptCountRef.current;
    if (
      sessionState === 'structuring' &&
      pendingTranscriptCount > previous &&
      pendingTranscriptCount > 0
    ) {
      pushTimelineEvent(createTimelineEvent({
        stage: 'structurer',
        message: `Transcript queued behind current structurer`,
        detail: `backlog ${pendingTranscriptCount} | target ${currentStructurerTarget?.transcriptId ?? 'unknown'}`,
        tone: pendingTranscriptCount >= 3 ? 'warning' : 'neutral',
        aggregationKey: 'structurer-queue-growth',
      }));
    }
    previousPendingTranscriptCountRef.current = pendingTranscriptCount;
  }, [
    currentStructurerTarget?.transcriptId,
    pendingTranscriptCount,
    pushTimelineEvent,
    sessionState,
  ]);

  const getPreferredView = useCallback(
    (nextGraph: MergedGraph, requestedView?: ViewType | null) =>
      requestedView ?? nextGraph.viewHints?.defaultView ?? pickDefaultView(nextGraph),
    [],
  );

  // 视图分数
  const viewScores = useMemo(() => scoreViews(graph), [graph]);

  // ============ 开发模式：模拟音频捕获（每30秒生成一个节点）============

  useEffect(() => {
    if (!isDevMode || sessionState !== 'capturing') return;

    const generateNode = () => {
      const elapsedMs = Date.now() - sessionStartTimeRef.current;
      const text =
        MOCK_TRANSCRIPTS[transcriptIndexRef.current % MOCK_TRANSCRIPTS.length];
      transcriptIndexRef.current++;

      const nodeType =
        NODE_TYPES[Math.floor(Math.random() * NODE_TYPES.length)];
      const speaker = SPEAKERS[Math.floor(Math.random() * SPEAKERS.length)];
      const nodeId = `n_${Date.now()}`;

      const newNode: GraphNode = {
        id: nodeId,
        type: nodeType,
        text,
        speaker,
        timestampMs: elapsedMs,
        status: 'confirmed',
        confidence: 0.85 + Math.random() * 0.1,
      };

      setGraph((prev) => {
        const newEdges: GraphEdge[] =
          prev.nodes.length > 0
            ? [
                {
                  id: `e_${Date.now()}`,
                  source: prev.nodes[prev.nodes.length - 1].id,
                  target: nodeId,
                  type: EDGE_TYPES[
                    Math.floor(Math.random() * EDGE_TYPES.length)
                  ],
                  confidence: 0.8 + Math.random() * 0.15,
                },
              ]
            : [];

        const updated = {
          ...prev,
          revision: prev.revision + 1,
          topics: prev.topics.map((t) => ({
            ...t,
            endMs: elapsedMs,
          })),
          nodes: [...prev.nodes, newNode],
          edges: [...prev.edges, ...newEdges],
          updatedAt: Date.now(),
        };

        addLog(`转写: ${text}`);
        addLog(`节点: +1 (${newNode.type}) | ${formatGraphDeltaLog(prev, updated)}`);

        return updated;
      });

      setCurrentTimeMs(elapsedMs);
    };

    // 立即生成第一个节点
    generateNode();

    // 每 30 秒生成一个新节点
    const interval = setInterval(generateNode, 30000);

    return () => clearInterval(interval);
  }, [sessionState, addLog]);

  // ============ 生产模式：监听来自 service worker 的消息 ============

  useEffect(() => {
    if (isDevMode) return;

    const handleMessage = (message: AppMessage) => {
      if (message.target && message.target !== 'sidepanel') return;
      switch (message.type) {
        case 'SESSION_STATE_CHANGED': {
          const p = message.payload;
          if (p.state === 'stopped') {
            if (p.mergedGraph) {
              const mergedGraph = p.mergedGraph;
              const shouldPreserveView = activeViewSessionRef.current === mergedGraph.sessionId;
              setGraph(mergedGraph);
              if (typeof p.currentTimeMs === 'number') {
                setCurrentTimeMs(p.currentTimeMs);
              }
              userPinnedViewRef.current = p.currentViewPinned ?? false;
              activeViewSessionRef.current = mergedGraph.sessionId;
              setCurrentView((prev) =>
                shouldPreserveView ? prev : getPreferredView(mergedGraph, p.currentView),
              );
            } else {
              setGraph(createEmptyGraph());
              setCurrentTimeMs(0);
              setCurrentView('causal');
              userPinnedViewRef.current = false;
              activeViewSessionRef.current = null;
              resetAutoTourState();
            }
          }
          const nextState = p.state === 'stopped' ? 'idle' : p.state;
          setSessionId(p.state === 'stopped' ? p.sessionId : nextState === 'idle' ? null : p.sessionId);
          setSessionState(nextState);
          setPendingTranscriptCount(p.pendingTranscriptCount ?? 0);
          setPendingWorkCount(p.pendingWorkCount ?? 0);
          setStopDrainPendingCount(p.stopDrainPendingCount ?? 0);
          setCurrentStructurerTarget(p.currentStructurerTarget ?? null);
          if (nextState === 'structuring') {
            setStructuringSince((prev) => prev ?? Date.now());
          } else if (nextState !== 'error') {
            setStructuringSince(null);
          }
          if (p.state === 'stopped' || p.state === 'error') {
            setStopPending(false);
          }
          if (nextState === 'idle' && p.state !== 'stopped') {
            setGraph(createEmptyGraph());
            setCurrentTimeMs(0);
            setSelectedNodeId(null);
            setCurrentView('causal');
            userPinnedViewRef.current = false;
            activeViewSessionRef.current = null;
            resetAutoTourState();
          }
          pushTimelineEvent(createTimelineEvent({
            stage: 'system',
            message: `状态切换为 ${p.state}`,
            tone: p.state === 'error' ? 'error' : p.state === 'stopped' ? 'warning' : 'neutral',
          }));
          break;
        }
        case 'TRANSCRIPT_READY': {
          setRecentProviderError(null);
          setLastTranscriptAt(Date.now());
          const utteranceKey = `asr-utterance-${asrUtteranceIndexRef.current}`;
          finalizeTimelineTransient(utteranceKey, {
            message: `转写: ${message.payload.transcript.text}`,
            detail: `${formatTime(message.payload.transcript.startMs)}-${formatTime(message.payload.transcript.endMs)} | ${message.payload.transcript.provider}`,
            tone: 'success',
          });
          break;
        }
        case 'PROVIDER_PROGRESS': {
          const { stage, message: progressMessage } = message.payload;
          if (stage === 'asr' && providerConfig.asr.type === 'external') {
            if (progressMessage.includes('连接中')) {
              setBridgeHealth({ status: 'connecting', detail: progressMessage });
            } else if (progressMessage.includes('已连接')) {
              setBridgeHealth({ status: 'connected', detail: progressMessage });
            } else if (progressMessage.includes('握手成功') || progressMessage.includes('ready')) {
              setBridgeHealth({ status: 'listening', detail: progressMessage });
            } else if (progressMessage.includes('已断开')) {
              setBridgeHealth({ status: 'closed', detail: progressMessage });
            }
          }
          const isStructurerStarted =
            stage === 'structurer' && progressMessage.startsWith('Structurer started');
          const isStructurerFinished =
            stage === 'structurer' && progressMessage.startsWith('Structurer finished');
          const isStructurerFailed =
            stage === 'structurer' && progressMessage.startsWith('Structurer failed');
          const isStopDrain =
            stage === 'structurer' && progressMessage.startsWith('Stop requested');
          if (isStructurerStarted) {
            setStructuringSince(Date.now());
            structurerSlowEventKeyRef.current = null;
          }
          if (isStructurerFinished || isStructurerFailed) {
            setStructuringSince(null);
            structurerSlowEventKeyRef.current = null;
          }
          const asrSlice = message.payload.asrSliceType;
          if (asrSlice === 0) {
            asrUtteranceIndexRef.current++;
          }
          pushTimelineEvent(createTimelineEvent({
            stage,
            message: progressMessage,
            tone: classifyProgressTone({
              isStructurerFinished,
              isStructurerFailed,
              isStopDrain,
              progressMessage,
            }),
            transientKey:
              asrSlice !== undefined
                ? `asr-utterance-${asrUtteranceIndexRef.current}`
                : undefined,
          }));
          break;
        }
        case 'MERGED_GRAPH_UPDATED': {
          const nextGraph = message.payload.graph;
          const shouldPreserveView = activeViewSessionRef.current === nextGraph.sessionId;
          const previousGraph = graphRef.current;
          const addedNodeIds = getAddedNodeIds(previousGraph, nextGraph);
          setRecentProviderError(null);
          setGraph(nextGraph);
          graphRef.current = nextGraph;
          activeViewSessionRef.current = nextGraph.sessionId;
          clearAutoTourAdvanceTimer();
          clearAutoTourResumeTimer();
          autoTourBatchesRef.current = [];
          autoTourCurrentIndexRef.current = -1;
          autoTourResumeIndexRef.current = 0;
          pendingAutoTourRef.current = addedNodeIds.length > 0
            ? {
                sessionId: nextGraph.sessionId,
                revision: nextGraph.revision,
                nodeIds: addedNodeIds,
                anchorNodeIds: getAutoRevealAnchorNodeIds({
                  addedNodeIds,
                  previousGraph,
                  nextGraph,
                }),
              }
            : null;
          lastAutoTourKeyRef.current = null;
          setAutoTourStatus('idle');
          setAutoTourProgress({ current: 0, total: 0 });
          setCurrentView((prev) =>
            shouldPreserveView ? prev : getPreferredView(nextGraph),
          );
          setLastGraphUpdatedAt(Date.now());
          setLastStructurerRun(null);
          setStructuringSince(null);
          pushTimelineEvent(createTimelineEvent({
            stage: 'graph',
            message: formatGraphDeltaLog(previousGraph, nextGraph),
            detail: `revision ${nextGraph.revision} | nodes ${nextGraph.nodes.length} | edges ${nextGraph.edges.length}`,
            tone: 'success',
          }));
          break;
        }
        case 'PLAYBACK_TIME_UPDATED':
          setCurrentTimeMs(message.payload.currentTimeMs);
          break;
        case 'ERROR':
          setRecentProviderError({
            code: message.payload.code as NonNullable<RuntimeSnapshot['lastProviderError']>['code'],
            message: message.payload.message,
            provider: 'runtime',
            stage: 'structurer',
            retriable: false,
          });
          pushTimelineEvent(createTimelineEvent({
            stage: 'system',
            message: `错误(${message.payload.code})`,
            detail: message.payload.message,
            tone: 'error',
          }));
          break;
      }
    };
    chrome.runtime.onMessage.addListener(handleMessage);
    return () => chrome.runtime.onMessage.removeListener(handleMessage);
  }, [clearAutoTourAdvanceTimer, clearAutoTourResumeTimer, finalizeTimelineTransient, getPreferredView, providerConfig.asr.type, pushTimelineEvent, resetAutoTourState]);

  useEffect(() => {
    if (isDevMode) return;

    let disposed = false;

    const hydrateSnapshot = async () => {
      const response = (await chrome.runtime.sendMessage({
        type: 'GET_RUNTIME_SNAPSHOT',
        target: 'service-worker',
        payload: {},
      } as AppMessage)) as
        | { success: true; snapshot: RuntimeSnapshot }
        | { success: false; error?: string };

      if (disposed || !response?.success) {
        return;
      }

      const snapshot = response.snapshot;
      setSessionId(snapshot.sessionId ?? snapshot.graph?.sessionId ?? null);
      setSessionState(snapshot.state === 'stopped' ? 'idle' : snapshot.state);
      setCurrentTimeMs(snapshot.currentTimeMs);
      setProviderSummary(
        snapshot.providerSummary ?? redactProviderConfig(createExtensionDefaultProviderConfigForUi()),
      );
      setRecentProviderError(snapshot.lastProviderError ?? null);
      setLastStructurerRun(snapshot.lastStructurerRun ?? null);
      setStructuringSince(snapshot.structuringSince ?? null);
      setLastTranscriptAt(snapshot.lastTranscriptAt ?? null);
      setLastGraphUpdatedAt(snapshot.lastGraphUpdatedAt ?? null);
      setPendingTranscriptCount(snapshot.pendingTranscriptCount ?? 0);
      setPendingWorkCount(snapshot.pendingWorkCount ?? 0);
      setStopDrainPendingCount(snapshot.stopDrainPendingCount ?? 0);
      setCurrentStructurerTarget(snapshot.currentStructurerTarget ?? null);
      setWorkerBuildLabel(snapshot.workerBuild?.label ?? 'unknown');

      if (snapshot.graph) {
        setGraph(snapshot.graph);
        setCurrentView(getPreferredView(snapshot.graph, snapshot.currentView));
        userPinnedViewRef.current = snapshot.currentViewPinned ?? false;
        activeViewSessionRef.current = snapshot.graph.sessionId;
        resetAutoTourState();
      } else {
        setGraph(createEmptyGraph());
        setCurrentView('causal');
        userPinnedViewRef.current = false;
        activeViewSessionRef.current = null;
        resetAutoTourState();
      }
    };

    void hydrateSnapshot();

    return () => {
      disposed = true;
    };
  }, [getPreferredView]);

  useEffect(() => {
    setReplayOpen(false);
    setReplayPlaying(false);
    setReplayData(null);
  }, [sessionId]);

  useEffect(() => {
    if (!replayPlaying || !replayData) {
      return;
    }

    const timer = window.setInterval(() => {
      setCurrentTimeMs((prev) => {
        const next = Math.min(prev + 1000, replayData.durationMs);
        if (next >= replayData.durationMs) {
          setReplayPlaying(false);
        }
        return next;
      });
    }, 1000);

    return () => window.clearInterval(timer);
  }, [replayData, replayPlaying]);

  // 获取当前 tab（仅生产模式）
  useEffect(() => {
    if (isDevMode) {
      addLog('开发模式: 已启用模拟数据');
      return;
    }
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) addLog(`标签页 ID: ${tabs[0].id}`);
    });
  }, [addLog]);

  const clearHistoricalContext = useCallback(() => {
    setSessionId(null);
    setGraph(createEmptyGraph());
    setCurrentTimeMs(0);
    setSelectedNodeId(null);
    setCurrentView('causal');
    setStopPending(false);
    setDebugOpen(false);
    setDebugData(null);
    setReplayOpen(false);
    setReplayPlaying(false);
    setReplayData(null);
    setRecentProviderError(null);
    userPinnedViewRef.current = false;
    activeViewSessionRef.current = null;
    resetAutoTourState();
  }, [resetAutoTourState]);

  const resetRuntimeUiState = useCallback(() => {
    setTimelineEvents([]);
    setLastStructurerRun(null);
    setStructuringSince(null);
    setLastTranscriptAt(null);
    setLastGraphUpdatedAt(null);
    setPendingTranscriptCount(0);
    setPendingWorkCount(0);
    setStopDrainPendingCount(0);
    setCurrentStructurerTarget(null);
  }, []);

  const updateProviderEntry = useCallback(
    (
      stage: keyof ProviderConfig,
      field: keyof ProviderConfig['asr'],
      value: string,
    ) => {
      let normalizedValue: unknown = value === '' ? undefined : value;
      if (field === 'needVad') {
        normalizedValue = value === '' ? undefined : value === 'true';
      } else if (
        field === 'vadSilenceTimeMs' ||
        field === 'maxSpeakTimeMs' ||
        field === 'wordInfo'
      ) {
        normalizedValue =
          value === '' ? undefined : Number.isFinite(Number(value)) ? Number(value) : undefined;
      }

      setProviderConfig((prev) => ({
        ...prev,
        [stage]: {
          ...prev[stage],
          [field]: normalizedValue,
        },
      }));
    },
    [],
  );

  const handleProviderTypeChange = useCallback(
    (
      stage: keyof ProviderConfig,
      nextType: string,
    ) => {
      setProviderConfig((prev) => {
        if (stage === 'structurer' && nextType === 'zhipu-coding-plan') {
          const nextConfig = resetProviderEntryForTypeChange(stage, 'zhipu', prev);
          return {
            ...nextConfig,
            structurer: {
              ...nextConfig.structurer,
              endpoint: ZHIPU_ENDPOINT_CODING_PLAN,
            },
          };
        }

        return resetProviderEntryForTypeChange(
          stage,
          nextType as ProviderConfig[keyof ProviderConfig]['type'],
          prev,
        );
      });
      if (stage === 'asr' && nextType !== 'external') {
        setBridgeHealth({ status: 'idle' });
      }
    },
    [],
  );

  const handleToggleSettings = useCallback(async () => {
    const nextOpen = !settingsOpen;
    setSettingsOpen(nextOpen);

    if (!nextOpen || isDevMode) {
      return;
    }

    try {
      const response = (await chrome.runtime.sendMessage({
        type: 'GET_PROVIDER_SETTINGS',
        target: 'service-worker',
        payload: {},
      } as AppMessage)) as
        | { success: true; config: ProviderConfig }
        | { success: false; error?: string };

      if (!response?.success) {
        addLog(`加载设置失败: ${response?.error || '未知错误'}`);
        return;
      }

      setProviderConfig(
        pinProviderConfigToDirectMode(normalizeProviderConfig(response.config)),
      );
      if (response.config.asr.type !== 'external') {
        setBridgeHealth({ status: 'idle' });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '读取 provider 设置失败';
      addLog(`加载设置失败: ${message}`);
    }
  }, [addLog, settingsOpen]);

  const handleSaveSettings = useCallback(async () => {
    setSettingsSaving(true);
    try {
      const normalized = pinProviderConfigToDirectMode(
        normalizeProviderConfig(providerConfig),
      );
      const response = await chrome.runtime.sendMessage({
        type: 'SAVE_PROVIDER_SETTINGS',
        target: 'service-worker',
        payload: {
          config: normalized,
        },
      } as AppMessage);

      if (!response?.success) {
        addLog(`保存设置失败: ${response?.error || '未知错误'}`);
        if (normalized.asr.type === 'external') {
          setBridgeHealth({
            status: 'error',
            detail: response?.error || '保存 Local ASR Bridge 设置失败',
          });
        }
        return;
      }

      setProviderConfig(normalized);
      setProviderSummary(redactProviderConfig(normalized));
      if (normalized.asr.type === 'external') {
        setBridgeHealth({
          status: 'idle',
          detail: 'Local ASR Bridge 设置已保存，开始会话后可检查连接状态',
        });
      } else {
        setBridgeHealth({ status: 'idle' });
      }
      addLog('provider 设置已保存');
    } catch (error) {
      const message = error instanceof Error ? error.message : '保存 provider 设置失败';
      if (providerConfig.asr.type === 'external') {
        setBridgeHealth({ status: 'error', detail: message });
      }
      addLog(`保存设置失败: ${message}`);
    } finally {
      setSettingsSaving(false);
    }
  }, [addLog, providerConfig]);

  const handleClearSecrets = useCallback(async () => {
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'CLEAR_PROVIDER_SECRETS',
        target: 'service-worker',
        payload: {},
      } as AppMessage);

      if (!response?.success) {
        addLog(`清除密钥失败: ${response?.error || '未知错误'}`);
        return;
      }

      const fallbackConfig = createExtensionDefaultProviderConfigForUi();
      setProviderConfig(fallbackConfig);
      setProviderSummary(redactProviderConfig(fallbackConfig));
      addLog('provider 密钥已清除');
    } catch (error) {
      const message = error instanceof Error ? error.message : '清除 provider 密钥失败';
      addLog(`清除密钥失败: ${message}`);
    }
  }, [addLog]);

  // ============ 会话控制 ============

  const handleStart = useCallback(() => {
    if (isDevMode) {
      // 开发模式：本地模拟
      const newSessionId = `session_${Date.now()}`;
      transcriptIndexRef.current = 0;
      sessionStartTimeRef.current = Date.now();

      setSessionId(newSessionId);
      setSessionState('capturing');
      userPinnedViewRef.current = false;
      setGraph({
        sessionId: newSessionId,
        revision: 0,
        topics: [{ topicId: 't1', title: '当前话题', startMs: 0, endMs: 0 }],
        nodes: [],
        edges: [],
        updatedAt: Date.now(),
      });
      setCurrentTimeMs(0);
      setSelectedNodeId(null);
      resetRuntimeUiState();

      addLog(`会话开始: ${newSessionId}`);
      addLog('状态: capturing (开发模式)');
      return;
    }

    // 生产模式：通过 Chrome API
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      if (!tabs[0]?.id) return;
      clearHistoricalContext();
      setSessionState('capturing');
      resetRuntimeUiState();
      const res = await chrome.runtime.sendMessage({
        type: 'SESSION_START',
        target: 'service-worker',
        payload: { tabId: tabs[0].id, sourceType: 'tab' },
      } as AppMessage);
      if (res?.success) {
        setSessionId(res.sessionId);
        setStopPending(false);
        userPinnedViewRef.current = false;
        addLog(`已启动: ${res.sessionId}`);
      } else {
        setStopPending(false);
        setSessionState('error');
        addLog(`失败: ${res?.error}`);
      }
    });
  }, [addLog, clearHistoricalContext]);

  const handleStop = useCallback(() => {
    if (isDevMode) {
      // 开发模式：本地模拟
      setSessionState('idle');
      setSessionId(null);
      addLog('状态: idle');
      addLog('会话已停止');
      return;
    }

    // 生产模式：通过 Chrome API
    if (!sessionId) return;
    setStopPending(true);
    pushTimelineEvent(createTimelineEvent({
      stage: 'system',
      message: '已请求停止',
      detail: '等待 service worker 清理当前会话',
      tone: 'warning',
    }));
    void chrome.runtime.sendMessage({
      type: 'SESSION_STOP',
      target: 'service-worker',
      payload: { sessionId },
    } as AppMessage);
  }, [pushTimelineEvent, sessionId]);

  const isRunning = ['capturing', 'transcribing', 'structuring'].includes(
    sessionState,
  );
  const canExport =
    Boolean(sessionId) &&
    graph.nodes.length > 0 &&
    !stopPending &&
    !['transcribing', 'structuring', 'error'].includes(sessionState);
  const canReplay =
    Boolean(sessionId) && graph.nodes.length > 0 && !stopPending && !isRunning;
  const structurerElapsedMs =
    sessionState === 'structuring' && structuringSince
      ? Math.max(statusNowMs - structuringSince, 0)
      : 0;
  const asrStatusCard: StatusCardData = (() => {
    if (recentProviderError?.stage === 'asr') {
      return {
        label: 'ASR',
        status: 'error',
        detail: recentProviderError.message,
        tone: 'error',
      };
    }
    if (providerConfig.asr.type === 'external' && bridgeHealth.status !== 'idle') {
      return {
        label: 'ASR',
        status: bridgeHealth.status,
        detail:
          bridgeHealth.detail ??
          `最近稳定句子 ${formatRelativeAge(lastTranscriptAt, statusNowMs)}`,
        tone: bridgeHealthToTone(bridgeHealth.status),
      };
    }
    if (sessionState === 'transcribing') {
      return {
        label: 'ASR',
        status: 'processing',
        detail: `最近稳定句子 ${formatRelativeAge(lastTranscriptAt, statusNowMs)}`,
        tone: 'active',
      };
    }
    if (sessionState === 'capturing') {
      return {
        label: 'ASR',
        status: lastTranscriptAt ? 'stable ready' : 'listening',
        detail: `最近稳定句子 ${formatRelativeAge(lastTranscriptAt, statusNowMs)}`,
        tone: lastTranscriptAt ? 'success' : 'waiting',
      };
    }
    return {
      label: 'ASR',
      status: 'idle',
      detail: `最近稳定句子 ${formatRelativeAge(lastTranscriptAt, statusNowMs)}`,
      tone: 'neutral',
    };
  })();
  const structurerStatusCard: StatusCardData = (() => {
    if (recentProviderError?.stage === 'structurer') {
      return {
        label: 'Structurer',
        status: 'error',
        detail: recentProviderError.message,
        tone: 'error',
      };
    }
    if (sessionState === 'structuring') {
      const isCongested = pendingTranscriptCount >= 3 || pendingWorkCount >= 4;
      const status = isCongested
        ? 'congested'
        : structurerElapsedMs >= STRUCTURER_DELAYED_MS
          ? 'delayed'
          : 'processing';
      const targetDetail = currentStructurerTarget
        ? `target ${formatTime(currentStructurerTarget.transcriptEndMs)} / ${currentStructurerTarget.transcriptCharCount}字`
        : 'target unknown';
      const queueDetail =
        pendingTranscriptCount > 0 ? ` | backlog ${pendingTranscriptCount}` : '';
      const previewDetail = currentStructurerTarget?.transcriptPreview
        ? ` | "${currentStructurerTarget.transcriptPreview}"`
        : '';
      return {
        label: 'Structurer',
        status,
        detail:
          `${Math.max(Math.round(structurerElapsedMs / 100) / 10, 0)}s | ${targetDetail}${queueDetail}${previewDetail}` +
          (lastStructurerRun?.mode ? ` | ${lastStructurerRun.mode}` : ''),
        tone:
          status === 'processing'
            ? 'active'
            : status === 'congested'
              ? 'congested'
              : 'warning',
      };
    }
    if (stopPending && stopDrainPendingCount > 0) {
      return {
        label: 'Structurer',
        status: 'draining',
        detail: `stop 后剩余 ${stopDrainPendingCount} 个 work 未清空`,
        tone: 'warning',
      };
    }
    if (sessionState === 'capturing' && graph.nodes.length === 0) {
      return {
        label: 'Structurer',
        status: 'waiting bootstrap',
        detail:
          `图谱尚未建立 | 最近转写 ${formatRelativeAge(lastTranscriptAt, statusNowMs)}` +
          (pendingTranscriptCount > 0 ? ` | backlog ${pendingTranscriptCount}` : ''),
        tone: 'waiting',
      };
    }
    if (lastStructurerRun) {
      return {
        label: 'Structurer',
        status: lastStructurerRun.status,
        detail:
          `${lastStructurerRun.durationMs}ms` +
          (lastStructurerRun.errorCode ? ` | ${lastStructurerRun.errorCode}` : ''),
        tone: lastStructurerRun.status === 'success' ? 'success' : 'warning',
      };
    }
    return {
      label: 'Structurer',
      status: graph.nodes.length > 0 ? 'idle' : 'waiting',
      detail: graph.nodes.length > 0 ? '等待下一轮增量' : '等待可结构化上下文',
      tone: graph.nodes.length > 0 ? 'neutral' : 'waiting',
    };
  })();
  const graphStatusCard: StatusCardData = (() => {
    const isFresh =
      typeof lastGraphUpdatedAt === 'number' &&
      statusNowMs - lastGraphUpdatedAt <= GRAPH_JUST_UPDATED_MS;
    return {
      label: 'Graph',
      status: isFresh ? 'updated just now' : graph.nodes.length > 0 ? 'stable' : 'empty',
      detail: `${graph.nodes.length} nodes | ${graph.edges.length} edges | 上次更新 ${formatRelativeAge(lastGraphUpdatedAt, statusNowMs)}`,
      tone: isFresh ? 'success' : 'neutral',
    };
  })();
  const primaryStatusCards = [asrStatusCard, structurerStatusCard];
  const graphViewStatus = graphStatusCard;

  const handleExport = useCallback(
    async (format: ExportFormat) => {
      if (!sessionId || !canExport) return;

      try {
        const response = (await chrome.runtime.sendMessage({
          type: 'EXPORT_SESSION',
          target: 'service-worker',
          payload: { sessionId, format },
        } as AppMessage)) as
          | {
              success: true;
              exportData: { filename: string; mimeType: string; content: string };
            }
          | { success: false; error?: string };

        if (!response?.success) {
          addLog(`导出失败: ${response?.error || '未知错误'}`);
          return;
        }

        downloadTextFile(
          response.exportData.filename,
          response.exportData.content,
          response.exportData.mimeType,
        );
        addLog(`已导出: ${response.exportData.filename}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : '未知错误';
        addLog(`导出失败: ${message}`);
      }
    },
    [addLog, canExport, sessionId],
  );

  const handleToggleReplay = useCallback(async () => {
    if (replayOpen) {
      setReplayOpen(false);
      setReplayPlaying(false);
      return;
    }

    setReplayOpen(true);
    setReplayPlaying(false);

    if (!sessionId) {
      setReplayData(null);
      return;
    }

    try {
      const response = (await chrome.runtime.sendMessage({
        type: 'GET_REPLAY_SESSION',
        target: 'service-worker',
        payload: { sessionId },
      } as AppMessage)) as
        | { success: true; replayData: ReplaySessionData }
        | { success: false; error?: string };

      if (!response?.success) {
        addLog(`回放数据加载失败: ${response?.error || '未知错误'}`);
        return;
      }

      setReplayData(response.replayData);
      setCurrentTimeMs(0);
      setSelectedNodeId(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : '未知错误';
      addLog(`回放数据加载失败: ${message}`);
    }
  }, [addLog, replayOpen, sessionId]);

  const handleReplayTogglePlay = useCallback(() => {
    if (!replayData) return;
    if (currentTimeMs >= replayData.durationMs) {
      setCurrentTimeMs(0);
      setSelectedNodeId(null);
    }
    setReplayPlaying((prev) => !prev);
  }, [currentTimeMs, replayData]);

  const handleReplayScrub = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const nextTimeMs = Number(event.target.value);
      setReplayPlaying(false);
      setCurrentTimeMs(nextTimeMs);
      if (graph.nodes.length === 0) {
        setSelectedNodeId(null);
        return;
      }
      const nearest = graph.nodes.reduce((a, b) =>
        Math.abs(a.timestampMs - nextTimeMs) < Math.abs(b.timestampMs - nextTimeMs) ? a : b,
      );
      setSelectedNodeId(nearest.id);
    },
    [graph.nodes],
  );

  const activeReplayTranscript = useMemo(() => {
    if (!replayData) {
      return null;
    }

    return (
      replayData.transcripts.find(
        (chunk) => currentTimeMs >= chunk.startMs && currentTimeMs < chunk.endMs,
      ) ?? replayData.transcripts[replayData.transcripts.length - 1] ?? null
    );
  }, [currentTimeMs, replayData]);

  const loadDebugSession = useCallback(async () => {
    if (!sessionId) {
      setDebugData(null);
      return;
    }

    try {
      const response = (await chrome.runtime.sendMessage({
        type: 'GET_DEBUG_SESSION',
        target: 'service-worker',
        payload: { sessionId },
      } as AppMessage)) as
        | { success: true; debugData: DebugSessionData }
        | { success: false; error?: string };

      if (!response?.success) {
        addLog(`调试数据加载失败: ${response?.error || '未知错误'}`);
        return;
      }

      setDebugData(response.debugData);
    } catch (error) {
      const message = error instanceof Error ? error.message : '未知错误';
      addLog(`调试数据加载失败: ${message}`);
    }
  }, [addLog, sessionId]);

  useEffect(() => {
    if (!debugOpen || isDevMode) {
      return;
    }

    void loadDebugSession();
  }, [debugOpen, graph.revision, loadDebugSession, sessionState]);

  const handleToggleDebug = useCallback(() => {
    setDebugOpen((prev) => !prev);
  }, []);

  const sendSeekMessage = useCallback(
    async (nodeId: string, timestampMs: number) => {
      if (!sessionId || !isRunning) return;

      const result = await chrome.runtime.sendMessage({
        type: 'NODE_CLICKED',
        target: 'service-worker',
        payload: {
          sessionId,
          nodeId,
          timestampMs,
        },
      } as AppMessage);

      if (!result?.success) {
        addLog(`跳转失败: ${result?.error || '未知错误'}`);
      }
    },
    [addLog, isRunning, sessionId],
  );

  const stopLogResize = useCallback(() => {
    logResizeStartRef.current = null;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }, []);

  const handleLogResizeMove = useCallback((clientY: number) => {
    const resizeState = logResizeStartRef.current;
    if (!resizeState) {
      return;
    }

    const deltaY = resizeState.pointerY - clientY;
    setLogPanelHeight(clampLogPanelHeight(resizeState.height + deltaY));
  }, []);

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      handleLogResizeMove(event.clientY);
    };
    const handleMouseUp = () => {
      stopLogResize();
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      stopLogResize();
    };
  }, [handleLogResizeMove, stopLogResize]);

  const handleLogResizeStart = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      logResizeStartRef.current = {
        pointerY: event.clientY,
        height: logPanelHeight,
      };
      document.body.style.cursor = 'row-resize';
      document.body.style.userSelect = 'none';
      event.preventDefault();
    },
    [logPanelHeight],
  );

  useEffect(() => {
    if (!graph.nodes.length) {
      layoutCacheRef.current = createEmptyStableLayoutCache();
      layoutCacheSessionRef.current = null;
      hasAutoFitRef.current = false;
      resetAutoTourState();
      return;
    }

    if (layoutCacheSessionRef.current !== graph.sessionId) {
      layoutCacheRef.current = createEmptyStableLayoutCache();
      layoutCacheSessionRef.current = graph.sessionId;
      hasAutoFitRef.current = false;
      resetAutoTourState();
    }
  }, [graph.nodes.length, graph.sessionId, resetAutoTourState]);

  const layoutBuild = useMemo(
    () =>
      buildDebugViewArtifacts({
        graph,
        currentTimeMs,
        selectedNodeId,
        previousLayoutCache: layoutCacheRef.current,
      }),
    [currentTimeMs, graph, selectedNodeId],
  );

  const debugViewArtifacts = layoutBuild.artifacts;

  useLayoutEffect(() => {
    layoutCacheRef.current = layoutBuild.nextLayoutCache;
  }, [layoutBuild]);

  const flowEdges = useMemo<Edge[]>(
    () => debugViewArtifacts[currentView].reactFlow.edges,
    [currentView, debugViewArtifacts],
  );

  /** Chrome 侧栏在首次绘制或不可见时容器常为 0×0，此时 fitView 无效但会锁死 hasAutoFit；用 ResizeObserver 在尺寸就绪后补一次。 */
  const requestAutoFit = useCallback(
    (sizeHint?: { width: number; height: number }) => {
      if (!graph.nodes.length || hasAutoFitRef.current) {
        return;
      }
      const inst = reactFlowInstanceRef.current;
      if (!inst?.fitView) {
        return;
      }
      const el = flowContainerRef.current;
      const w = sizeHint?.width ?? el?.clientWidth ?? 0;
      const h = sizeHint?.height ?? el?.clientHeight ?? 0;
      if (w < 2 || h < 2) {
        return;
      }
      inst.fitView({
        padding: 0.16,
        duration: 240,
      });
      hasAutoFitRef.current = true;
    },
    [graph.nodes.length],
  );

  const buildAutoTourTargetBounds = useCallback((batch: AutoTourBatch) => {
    const inst = reactFlowInstanceRef.current;
    const el = flowContainerRef.current;
    if (!inst?.getViewport || !el) {
      return null;
    }

    const containerWidth = el.clientWidth ?? 0;
    const containerHeight = el.clientHeight ?? 0;
    if (containerWidth < 2 || containerHeight < 2) {
      return null;
    }

    const currentViewport = inst.getViewport();
    const nodeIds = new Set([...batch.nodeIds, ...batch.anchorNodeIds]);
    const targetNodes = debugViewArtifacts[currentView].reactFlow.nodes.filter((node) =>
      nodeIds.has(node.id),
    );
    const mergedBounds = mergeViewBounds(targetNodes.map(getNodeBounds));
    if (!mergedBounds) {
      return null;
    }

    const paddedBounds = expandViewBounds(mergedBounds, AUTO_REVEAL_PADDING);
    const minimumBoundsSize = getAutoRevealMinimumBoundsSize({
      containerWidth,
      containerHeight,
      currentZoom: currentViewport.zoom || 1,
    });
    const targetBounds = ensureMinimumBoundsSize({
      bounds: paddedBounds,
      minimumWidth: minimumBoundsSize.minimumWidth,
      minimumHeight: minimumBoundsSize.minimumHeight,
    });

    const viewportForBounds = getViewportForBounds(
      {
        x: targetBounds.left,
        y: targetBounds.top,
        width: targetBounds.right - targetBounds.left,
        height: targetBounds.bottom - targetBounds.top,
      },
      containerWidth,
      containerHeight,
      0.3,
      2,
      0,
    );

    return {
      currentViewport,
      targetViewport: viewportForBounds,
      targetBounds,
    };
  }, [currentView, debugViewArtifacts]);

  const playAutoTourBatch = useCallback((index: number) => {
    const batch = autoTourBatchesRef.current[index];
    if (!batch) {
      setAutoTourStatus('idle');
      return;
    }

    const inst = reactFlowInstanceRef.current;
    const target = buildAutoTourTargetBounds(batch);
    if (!inst?.fitBounds || !target) {
      setAutoTourStatus('idle');
      return;
    }

    autoTourCurrentIndexRef.current = index;
    autoTourResumeIndexRef.current = index + 1;
    setAutoTourStatus('touring');
    setAutoTourProgress({
      current: index + 1,
      total: autoTourBatchesRef.current.length,
    });

    inst.fitBounds(
      {
        x: target.targetBounds.left,
        y: target.targetBounds.top,
        width: target.targetBounds.right - target.targetBounds.left,
        height: target.targetBounds.bottom - target.targetBounds.top,
      },
      {
        duration: AUTO_REVEAL_DURATION_MS,
        padding: 0,
      },
    );

    clearAutoTourAdvanceTimer();
    autoTourAdvanceTimerRef.current = window.setTimeout(() => {
      const nextIndex = index + 1;
      if (nextIndex >= autoTourBatchesRef.current.length) {
        clearAutoTourAdvanceTimer();
        setAutoTourStatus('idle');
        return;
      }
      playAutoTourBatch(nextIndex);
    }, AUTO_REVEAL_DURATION_MS + batch.dwellMs);
  }, [buildAutoTourTargetBounds, clearAutoTourAdvanceTimer]);

  const scheduleAutoTourResume = useCallback(() => {
    clearAutoTourResumeTimer();
    autoTourResumeTimerRef.current = window.setTimeout(() => {
      const nextIndex = autoTourResumeIndexRef.current;
      if (nextIndex >= autoTourBatchesRef.current.length) {
        setAutoTourStatus('idle');
        return;
      }
      playAutoTourBatch(nextIndex);
    }, AUTO_TOUR_RESUME_DELAY_MS);
  }, [clearAutoTourResumeTimer, playAutoTourBatch]);

  const pauseAutoTour = useCallback(() => {
    if (autoTourBatchesRef.current.length === 0) {
      return;
    }

    clearAutoTourAdvanceTimer();
    const nextReadableIndex = Math.min(
      autoTourResumeIndexRef.current + 1,
      autoTourBatchesRef.current.length,
    );
    setAutoTourStatus('paused');
    setAutoTourProgress({
      current: nextReadableIndex,
      total: autoTourBatchesRef.current.length,
    });
    scheduleAutoTourResume();
  }, [clearAutoTourAdvanceTimer, scheduleAutoTourResume]);

  const maybeStartAutoTour = useCallback(() => {
    const pending = pendingAutoTourRef.current;
    if (!pending || pending.sessionId !== graph.sessionId || pending.revision !== graph.revision) {
      return;
    }

    if (
      userViewportInteractingRef.current ||
      Date.now() - lastUserViewportChangeAtRef.current < USER_VIEWPORT_COOLDOWN_MS
    ) {
      return;
    }

    const inst = reactFlowInstanceRef.current;
    const el = flowContainerRef.current;
    if (!inst?.getViewport || !el) {
      return;
    }

    const autoTourKey = `${pending.sessionId}:${pending.revision}:${currentView}`;
    if (lastAutoTourKeyRef.current === autoTourKey) {
      return;
    }

    const batches = buildAutoTourBatches({
      seed: pending,
      flowNodes: debugViewArtifacts[currentView].reactFlow.nodes,
      flowEdges,
      containerWidth: el.clientWidth ?? 0,
      containerHeight: el.clientHeight ?? 0,
      currentZoom: inst.getViewport().zoom || 1,
    });
    if (batches.length === 0) {
      pendingAutoTourRef.current = null;
      return;
    }

    const firstTarget = buildAutoTourTargetBounds(batches[0]);
    if (
      batches.length === 1 &&
      firstTarget &&
      isViewportCloseToTarget({
        current: firstTarget.currentViewport,
        target: firstTarget.targetViewport,
      })
    ) {
      pendingAutoTourRef.current = null;
      return;
    }

    autoTourBatchesRef.current = batches;
    autoTourCurrentIndexRef.current = -1;
    autoTourResumeIndexRef.current = 0;
    pendingAutoTourRef.current = null;
    lastAutoTourKeyRef.current = autoTourKey;
    playAutoTourBatch(0);
  }, [buildAutoTourTargetBounds, currentView, debugViewArtifacts, flowEdges, graph.revision, graph.sessionId, playAutoTourBatch]);

  const handleNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      lastUserViewportChangeAtRef.current = Date.now();
      pauseAutoTour();
      setCurrentTimeMs(node.data.timestampMs as number);
      setSelectedNodeId(node.id);
      void sendSeekMessage(node.id, node.data.timestampMs as number);
    },
    [pauseAutoTour, sendSeekMessage],
  );

  const handleTimeClick = useCallback(
    (ms: number) => {
      lastUserViewportChangeAtRef.current = Date.now();
      pauseAutoTour();
      setCurrentTimeMs(ms);
      if (graph.nodes.length === 0) return;
      const nearest = graph.nodes.reduce((a, b) =>
        Math.abs(a.timestampMs - ms) < Math.abs(b.timestampMs - ms) ? a : b,
      );
      setSelectedNodeId(nearest.id);
      void sendSeekMessage(nearest.id, ms);
    },
    [graph, pauseAutoTour, sendSeekMessage],
  );

  const flowNodes = useMemo<Node[]>(
    () =>
      debugViewArtifacts[currentView].reactFlow.nodes.map((node) => ({
        ...node,
        data: {
          ...node.data,
          onClickTime: handleTimeClick,
        },
      })),
    [currentView, debugViewArtifacts, handleTimeClick],
  );

  useLayoutEffect(() => {
    requestAutoFit();
  }, [requestAutoFit]);

  useLayoutEffect(() => {
    if (!hasAutoFitRef.current) {
      return;
    }
    maybeStartAutoTour();
  }, [flowNodes, graph.revision, maybeStartAutoTour]);

  useLayoutEffect(() => {
    const el = flowContainerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') {
      return;
    }
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) {
        return;
      }
      const { width, height } = entry.contentRect;
      requestAutoFit({ width, height });
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
    };
  }, [requestAutoFit]);

  const exportLogLines = useMemo(
    () => timelineEventsToExportLines(timelineEvents),
    [timelineEvents],
  );

  const slimDebugExportPayload = useMemo(
    () => buildDebugExportPayload({
      mode: 'slim',
      sessionId,
      sessionState,
      currentView,
      workerBuildLabel,
      providerSummary,
      logs: exportLogLines,
      debugData,
      derivedViews: debugViewArtifacts,
    }),
    [
      currentView,
      debugData,
      debugViewArtifacts,
      exportLogLines,
      providerSummary,
      sessionId,
      sessionState,
      workerBuildLabel,
    ],
  );

  const fullDebugExportPayload = useMemo(
    () => buildDebugExportPayload({
      mode: 'full',
      sessionId,
      sessionState,
      currentView,
      workerBuildLabel,
      providerSummary,
      logs: exportLogLines,
      debugData,
      derivedViews: debugViewArtifacts,
    }),
    [
      currentView,
      debugData,
      debugViewArtifacts,
      exportLogLines,
      providerSummary,
      sessionId,
      sessionState,
      workerBuildLabel,
    ],
  );

  const handleExportDebug = useCallback((mode: DebugExportMode) => {
    if (!debugData) {
      addLog('调试数据为空，无法导出');
      return;
    }

    const debugSessionId = debugData.session?.sessionId ?? sessionId ?? 'listen-graphic';
    const filename =
      mode === 'full'
        ? `${debugSessionId}-debug-full.json`
        : `${debugSessionId}-debug.json`;
    downloadTextFile(
      filename,
      JSON.stringify(mode === 'full' ? fullDebugExportPayload : slimDebugExportPayload, null, 2),
      'application/json',
    );
    addLog(`已导出: ${filename}`);
  }, [addLog, debugData, fullDebugExportPayload, sessionId, slimDebugExportPayload]);

  const autoTourIndicatorColor =
    autoTourStatus === 'touring'
      ? '#10b981'
      : autoTourStatus === 'paused'
        ? '#ef4444'
        : isRunning
          ? '#10b981'
          : '#d1d5db';
  const autoTourStatusText =
    autoTourStatus === 'touring'
      ? `自动导览 ${autoTourProgress.current}/${autoTourProgress.total}`
      : autoTourStatus === 'paused'
        ? `导览暂停 ${autoTourProgress.current}/${autoTourProgress.total}`
        : isRunning
          ? '运行中'
          : '空闲';

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <style>
        {`
          @keyframes listen-graphic-tour-pulse {
            0% { opacity: 1; transform: scale(1); }
            50% { opacity: 0.45; transform: scale(0.82); }
            100% { opacity: 1; transform: scale(1); }
          }
        `}
      </style>
      {/* 顶部栏 */}
      <div
        style={{
          padding: '8px 12px',
          borderBottom: '1px solid #e5e7eb',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          flexShrink: 0,
        }}
      >
        <span style={{ fontWeight: 600, fontSize: 14 }}>Listen Graphic</span>
        <button
          onClick={() => void handleExport('json')}
          disabled={!canExport}
          style={{
            padding: '4px 8px',
            borderRadius: 4,
            border: '1px solid #d1d5db',
            backgroundColor: canExport ? 'white' : '#f3f4f6',
            color: '#374151',
            fontSize: 11,
            cursor: canExport ? 'pointer' : 'not-allowed',
          }}
        >
          导出 JSON
        </button>
        <button
          onClick={() => void handleExport('markdown')}
          disabled={!canExport}
          style={{
            padding: '4px 8px',
            borderRadius: 4,
            border: '1px solid #d1d5db',
            backgroundColor: canExport ? 'white' : '#f3f4f6',
            color: '#374151',
            fontSize: 11,
            cursor: canExport ? 'pointer' : 'not-allowed',
          }}
        >
          导出 Markdown
        </button>
        <button
          onClick={() => void handleExport('mermaid')}
          disabled={!canExport}
          style={{
            padding: '4px 8px',
            borderRadius: 4,
            border: '1px solid #d1d5db',
            backgroundColor: canExport ? 'white' : '#f3f4f6',
            color: '#374151',
            fontSize: 11,
            cursor: canExport ? 'pointer' : 'not-allowed',
          }}
        >
          导出 Mermaid
        </button>
        <button
          onClick={() => void handleToggleSettings()}
          style={{
            padding: '4px 8px',
            borderRadius: 4,
            border: '1px solid #d1d5db',
            backgroundColor: settingsOpen ? '#eff6ff' : 'white',
            color: settingsOpen ? '#1d4ed8' : '#374151',
            fontSize: 11,
            cursor: 'pointer',
          }}
        >
          设置
        </button>
        <button
          onClick={() => void handleToggleDebug()}
          style={{
            padding: '4px 8px',
            borderRadius: 4,
            border: '1px solid #d1d5db',
            backgroundColor: debugOpen ? '#eff6ff' : 'white',
            color: debugOpen ? '#1d4ed8' : '#374151',
            fontSize: 11,
            cursor: 'pointer',
          }}
        >
          调试
        </button>
        <button
          onClick={() => void handleToggleReplay()}
          disabled={!canReplay}
          style={{
            padding: '4px 8px',
            borderRadius: 4,
            border: '1px solid #d1d5db',
            backgroundColor: canReplay ? (replayOpen ? '#eff6ff' : 'white') : '#f3f4f6',
            color: replayOpen ? '#1d4ed8' : '#374151',
            fontSize: 11,
            cursor: canReplay ? 'pointer' : 'not-allowed',
          }}
        >
          回放
        </button>
        <button
          onClick={isRunning ? handleStop : handleStart}
          style={{
            marginLeft: 'auto',
            padding: '4px 12px',
            borderRadius: 4,
            border: 'none',
            backgroundColor: isRunning ? '#ef4444' : '#3b82f6',
            color: 'white',
            fontSize: 12,
            cursor: 'pointer',
            fontWeight: 600,
          }}
        >
          {isRunning ? '停止' : '开始'}
        </button>
      </div>
      {recentProviderError && (
        <div
          data-testid="recent-error-banner"
          style={{
            padding: '8px 12px',
            borderBottom: '1px solid #fecaca',
            backgroundColor: '#fef2f2',
            color: '#991b1b',
            fontSize: 11,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flexShrink: 0,
          }}
        >
          <span style={{ fontWeight: 700 }}>最近错误</span>
          <span style={{ fontFamily: 'monospace' }}>
            {formatErrorStageLabel(recentProviderError.stage)} / {recentProviderError.code}
          </span>
          <span style={{ color: '#7f1d1d' }}>{recentProviderError.message}</span>
        </div>
      )}

      <StatusCards
        primaryStatusCards={primaryStatusCards}
        graphViewStatus={graphViewStatus}
        currentView={currentView}
        autoTourStatus={autoTourStatus}
        autoTourProgress={autoTourProgress}
        isRunning={isRunning}
        autoTourIndicatorColor={autoTourIndicatorColor}
        autoTourStatusText={autoTourStatusText}
      />
      {/* 视图切换 */}
      <div
        style={{
          padding: '6px 12px',
          borderBottom: '1px solid #e5e7eb',
          display: 'flex',
          gap: 6,
          flexShrink: 0,
        }}
      >
        {VIEW_TYPES.map((v) => (
          <button
            key={v}
            onClick={() => {
              lastUserViewportChangeAtRef.current = Date.now();
              pauseAutoTour();
              userPinnedViewRef.current = true;
              setCurrentView(v);
              if (sessionId && isRunning) {
                void chrome.runtime.sendMessage({
                  type: 'VIEW_SELECTED',
                  target: 'service-worker',
                  payload: { sessionId, view: v },
                } as AppMessage);
              }
            }}
            style={{
              padding: '3px 8px',
              borderRadius: 4,
              fontSize: 11,
              border:
                currentView === v ? '2px solid #3b82f6' : '1px solid #d1d5db',
              backgroundColor: currentView === v ? '#eff6ff' : 'white',
              color: currentView === v ? '#1d4ed8' : '#374151',
              cursor: 'pointer',
            }}
          >
            {VIEW_LABELS[v]}
            <span style={{ marginLeft: 3, fontSize: 9, color: '#9ca3af' }}>
              ({viewScores[v]})
            </span>
          </button>
        ))}
      </div>
      {settingsOpen && (
        <SettingsPanel
          providerConfig={providerConfig}
          providerSummary={providerSummary}
          settingsSaving={settingsSaving}
          bridgeHealth={bridgeHealth}
          onUpdateProviderEntry={updateProviderEntry}
          onProviderTypeChange={handleProviderTypeChange}
          onSaveSettings={handleSaveSettings}
          onClearSecrets={handleClearSecrets}
        />
      )}

      {/* 图表区域 */}
      <div
        ref={flowContainerRef}
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <ReactFlow
          nodes={flowNodes}
          edges={flowEdges}
          nodeTypes={nodeTypes}
          onNodeClick={handleNodeClick}
          onMoveStart={() => {
            userViewportInteractingRef.current = true;
            lastUserViewportChangeAtRef.current = Date.now();
            pauseAutoTour();
          }}
          onMoveEnd={() => {
            userViewportInteractingRef.current = false;
            lastUserViewportChangeAtRef.current = Date.now();
            pauseAutoTour();
          }}
          onInit={(instance) => {
            reactFlowInstanceRef.current = instance;
            // 父级 useLayoutEffect 可能早于 onInit 执行；真实环境靠异步 RO 回调补救，这里再补一次避免竞态。
            queueMicrotask(() => {
              requestAutoFit();
            });
          }}
          minZoom={0.3}
          maxZoom={2}
        >
          <Background />
          <Controls />
        </ReactFlow>

        <div
          data-testid="log-resizer"
          onMouseDown={handleLogResizeStart}
          style={{
            height: 8,
            flexShrink: 0,
            cursor: 'row-resize',
            background:
              'linear-gradient(to bottom, #dbe4ee 0, #dbe4ee 1px, #f8fafc 1px, #f8fafc 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          aria-label="调整日志面板高度"
          role="separator"
        >
          <div
            style={{
              width: 48,
              height: 4,
              borderRadius: 999,
              backgroundColor: '#94a3b8',
            }}
          />
        </div>

        <LogPanel
          logPanelHeight={logPanelHeight}
          timelineEvents={timelineEvents}
        />
        {debugOpen && (
          <DebugPanel
            debugData={debugData}
            sessionId={sessionId}
            slimDebugExportPayload={slimDebugExportPayload}
            onExportDebug={handleExportDebug}
          />
        )}
        {replayOpen && (
          <ReplayPanel
            replayData={replayData}
            replayPlaying={replayPlaying}
            currentTimeMs={currentTimeMs}
            activeReplayTranscript={activeReplayTranscript}
            onTogglePlay={handleReplayTogglePlay}
            onScrub={handleReplayScrub}
          />
        )}
      </div>

      {/* 底部状态 */}
      <div
        style={{
          padding: '6px 12px',
          borderTop: '1px solid #e5e7eb',
          fontSize: 11,
          color: '#6b7280',
          flexShrink: 0,
          display: 'flex',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <span>会话: {sessionId || '无'}</span>
        <span>当前时间: {formatTime(currentTimeMs)}</span>
        <span>
          节点: {graph.nodes.length} | 边: {graph.edges.length}
        </span>
        <span data-testid="build-info" style={{ fontFamily: 'monospace' }}>
          {`UI ${BUILD_INFO.label} | Worker ${workerBuildLabel}`}
        </span>
      </div>
    </div>
  );
}
