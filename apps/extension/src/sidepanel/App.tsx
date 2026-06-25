import {
  useState,
  useEffect,
  useLayoutEffect,
  useCallback,
  useMemo,
  useRef,
  useReducer,
} from 'react';
import {
  type Node,
  type Edge,
  type ReactFlowInstance,
} from 'reactflow';
import 'reactflow/dist/style.css';
import '@listen-graphic/ui/styles/theme.css';

import type { ViewType, MergedGraph, GraphNode, GraphEdge } from '@listen-graphic/schema';
import { scoreViews } from '@listen-graphic/domain';
import type {
  AppMessage,
  DebugSessionData,
  ExportFormat,
  RuntimeSnapshot,
} from '../shared/messages';
import { BUILD_INFO } from '../shared/build-info';
import type { DebugExportMode, StableLayoutCache } from './types';
import {
  formatErrorStageLabel,
  timelineEventsToExportLines,
} from './timeline-utils';
import { createEmptyStableLayoutCache, buildDebugViewArtifacts } from './graph-utils';
import {
  createEmptyGraph,
  MOCK_TRANSCRIPTS,
  NODE_TYPES,
  EDGE_TYPES,
  SPEAKERS,
  isDevMode,
} from './constants';
import { formatGraphDeltaLog, downloadTextFile, buildDebugExportPayload, buildAssemblerLogPayload } from './debug-export-utils';
import { getAutoTourTrace } from './auto-tour-trace';
import { getAutoTourStageKindLabel } from './auto-tour-utils';
import {
  GraphNodeCard,
  GRAPH_NODE_BODY_FONT_PX,
  useTheme,
  GraphToolbar,
  ViewSwitcher,
  GraphArea,
  StatusBar,
  ResizeHandle,
  ErrorBanner,
  DropdownMenu,
  TimelineLogPanel,
  PipelineLayout,
  formatTime,
  formatRelativeAge,
} from '@listen-graphic/ui';
import type { WaveDividerStatus } from '@listen-graphic/ui';
import { DebugPanel } from './DebugPanel';
import { ReplayPanel } from './ReplayPanel';
import { SettingsPanel } from './SettingsPanel';
import { pinProviderConfigToDirectMode } from './provider-helpers';
import { normalizeProviderConfig } from '@listen-graphic/providers';

import { panelReducer, initialPanelState } from './panel-reducer';
import { useTimeline } from './hooks/useTimeline';
import { useAutoTour } from './hooks/useAutoTour';
import { useProviderSettings } from './hooks/useProviderSettings';
import { useGraphDisplaySettings } from './hooks/useGraphDisplaySettings';
import { useChromeMessages } from './hooks/useChromeMessages';
import { useReplay } from './hooks/useReplay';
import { useLogResize } from './hooks/useLogResize';
import { useSessionControl } from './hooks/useSessionControl';
import {
  computeAsrStatusCard,
  computeStructurerStatusCard,
} from './status-cards';

const nodeTypes = { graphNode: GraphNodeCard };

const AUTO_FIT_PADDING = 0.16;
const AUTO_FIT_DURATION_MS = 240;

function getReadableAutoFitMinZoom(readableFontPx: number) {
  return readableFontPx / GRAPH_NODE_BODY_FONT_PX;
}

// ============ 主组件 ============

export default function App() {
  // ===== Reducer：消息驱动的状态 =====
  const [panel, dispatch] = useReducer(panelReducer, initialPanelState);

  // ===== UI 本地状态 =====
  const [debugOpen, setDebugOpen] = useState(false);
  const [debugData, setDebugData] = useState<DebugSessionData | null>(null);
  const [statusNowMs, setStatusNowMs] = useState(() => Date.now());
  const [userViewOverride, setUserViewOverride] = useState<ViewType | null>(null);
  const currentView = userViewOverride ?? panel.currentView;

  // ===== Refs =====
  const transcriptIndexRef = useRef(0);
  const asrUtteranceIndexRef = useRef(0);
  const sessionStartTimeRef = useRef(0);
  const userPinnedViewRef = useRef(false);
  const graphRef = useRef<MergedGraph>(createEmptyGraph());
  const layoutCacheRef = useRef<StableLayoutCache>(createEmptyStableLayoutCache());
  const layoutCacheSessionRef = useRef<string | null>(null);
  const activeViewSessionRef = useRef<string | null>(null);
  const fixtureLabIdRef = useRef<string | null>(null);
  const reactFlowInstanceRef = useRef<ReactFlowInstance | null>(null);
  const flowContainerRef = useRef<HTMLDivElement | null>(null);
  const hasAutoFitRef = useRef(false);

  // ===== Hooks =====
  const { addLog, pushTimelineEvent, finalizeTimelineTransient } = useTimeline({
    sessionState: panel.sessionState,
    sessionId: panel.sessionId,
    structuringSince: panel.structuringSince,
    statusNowMs,
    pendingTranscriptCount: panel.pendingTranscriptCount,
    currentStructurerTarget: panel.currentStructurerTarget ?? null,
    dispatch,
  });

  const { logPanelHeight, handleLogResizeStart } = useLogResize();

  const {
    providerConfig,
    providerSummary,
    setProviderSummary,
    settingsOpen,
    settingsSaving,
    localBridgeHealth,
    initialConfigRef,
    updateProviderEntry,
    handleProviderTypeChange,
    handleToggleSettings,
    handleSaveSettings,
    handleClearSecrets,
  } = useProviderSettings({ addLog, dispatch });

  const {
    graphDisplaySettings,
    graphDisplaySettingsSaving,
    loadGraphDisplaySettings,
    updateAutoFitMinReadableFontPx,
    saveGraphDisplaySettings,
    initialDisplayRef,
  } = useGraphDisplaySettings({ addLog });

  const { theme } = useTheme();

  const providerAsrType = providerConfig.asr.type;

  // ===== Layout cache reset =====
  const resetLayoutCacheData = useCallback(() => {
    layoutCacheRef.current = createEmptyStableLayoutCache();
  }, []);

  const resetLayoutCache = useCallback(() => {
    resetLayoutCacheData();
    layoutCacheSessionRef.current = null;
    hasAutoFitRef.current = false;
  }, [resetLayoutCacheData]);

  // ===== Auto-tour refs（通过 ref 传入避免陈旧闭包）=====
  const debugViewArtifactsRef = useRef<Record<ViewType, any>>({} as any);
  const flowEdgesRef = useRef<Edge[]>([]);

  const {
    autoTourStatus,
    autoTourProgress,
    activeAutoTourStage,
    lastUserViewportChangeAtRef,
    userViewportInteractingRef,
    resetAutoTourState,
    pauseAutoTour,
    maybeStartAutoTour,
    setAutoTourSeed,
    withProgrammaticViewportChange,
    handleViewportMoveStart,
    handleViewportMoveEnd,
  } = useAutoTour({
    graph: panel.graph,
    currentView,
    debugViewArtifactsRef,
    flowEdgesRef,
    flowContainerRef,
    reactFlowInstanceRef,
    autoFitMinReadableFontPx: graphDisplaySettings.autoFitMinReadableFontPx,
    graphNodeBodyFontPx: GRAPH_NODE_BODY_FONT_PX,
    onReset: resetLayoutCache,
  });

  const onFixtureLabReset = useCallback(
    (sessionId: string) => {
      fixtureLabIdRef.current = sessionId;
      resetLayoutCache();
      hasAutoFitRef.current = false;
      resetAutoTourState();
      lastUserViewportChangeAtRef.current = 0;
      userPinnedViewRef.current = false;
      activeViewSessionRef.current = sessionId;
    },
    [resetAutoTourState, resetLayoutCache],
  );

  const fixtureLabDepsRef = useRef({
    dispatch,
    graphRef,
    activeViewSessionRef,
    addLog,
    setAutoTourSeed,
    onFixtureLabReset,
    onFixtureLabDisarm: () => {
      fixtureLabIdRef.current = null;
    },
  });
  fixtureLabDepsRef.current = {
    dispatch,
    graphRef,
    activeViewSessionRef,
    addLog,
    setAutoTourSeed,
    onFixtureLabReset,
    onFixtureLabDisarm: () => {
      fixtureLabIdRef.current = null;
    },
  };

  useEffect(() => {
    if (!import.meta.env.DEV && import.meta.env.VITE_FIXTURE_LAB !== 'true') {
      return undefined;
    }

    let disposed = false;

    void (async () => {
      const { installFixtureSequenceDev } = await import('./fixture-sequence-dev');
      if (disposed) return;
      installFixtureSequenceDev(fixtureLabDepsRef);
    })();

    return () => {
      disposed = true;
      delete (globalThis as Record<string, unknown>)['__listenGraphicFixture'];
    };
  }, []);

  const exportSessionId = panel.sessionId ?? (panel.graph.nodes.length > 0 ? panel.graph.sessionId : null);

  const {
    replayOpen,
    replayPlaying,
    replayData,
    handleToggleReplay,
    handleReplayTogglePlay,
    handleReplayScrub,
  } = useReplay({
    sessionId: exportSessionId,
    currentTimeMs: panel.currentTimeMs,
    graph: panel.graph,
    addLog,
    dispatch,
  });

  const { clearHistoricalContext, handleStart, handleStop } = useSessionControl({
    panel,
    dispatch,
    addLog,
    pushTimelineEvent,
    resetAutoTourState,
    resetLayoutCache,
    onClearContext: useCallback(() => {
      setDebugOpen(false);
      setDebugData(null);
    }, []),
    userPinnedViewRef,
    activeViewSessionRef,
    transcriptIndexRef,
    sessionStartTimeRef,
    graphRef,
  });

  // ===== 图谱显示设置挂载加载（dev mode 跳过：使用模拟数据，无持久化）=====
  useEffect(() => {
    if (isDevMode) return;
    void loadGraphDisplaySettings();
  }, [loadGraphDisplaySettings]);

  // ===== 组合设置开关/保存 =====
  const handleToggleAllSettings = useCallback(async () => {
    await handleToggleSettings();
    // 幂等加载：每次打开时刷新设置，关闭时无副作用
    await loadGraphDisplaySettings();
  }, [handleToggleSettings, loadGraphDisplaySettings]);

  // ===== dirty 追踪 =====
  const isDirty = useMemo(() => {
    const providerDirty = (() => {
      if (!initialConfigRef.current) return false;
      return JSON.stringify(pinProviderConfigToDirectMode(normalizeProviderConfig(providerConfig)))
        !== JSON.stringify(initialConfigRef.current);
    })();
    const displayDirty = (() => {
      if (!initialDisplayRef.current) return false;
      return JSON.stringify(graphDisplaySettings) !== JSON.stringify(initialDisplayRef.current);
    })();
    return providerDirty || displayDirty;
  }, [providerConfig, graphDisplaySettings]);

  type SaveResult = { ok: true } | { ok: false; error: string };

  const handleSaveAllSettings = useCallback(async (): Promise<SaveResult> => {
    const providerResult = await handleSaveSettings();
    if (!providerResult.ok) return providerResult;
    const displayResult = await saveGraphDisplaySettings();
    if (!displayResult.ok) return displayResult;
    return { ok: true };
  }, [handleSaveSettings, saveGraphDisplaySettings]);

  // ===== Chrome 消息监听 =====
  useChromeMessages({
    dispatch,
    providerAsrType,
    activeViewSessionRef,
    graphRef,
    asrUtteranceIndexRef,
    userPinnedViewRef,
    finalizeTimelineTransient,
    resetAutoTourState,
    setAutoTourSeed,
  });

  // ===== statusNowMs tick =====
  useEffect(() => {
    if (!['capturing', 'transcribing', 'structuring'].includes(panel.sessionState)) {
      return undefined;
    }
    const timer = window.setInterval(() => setStatusNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [panel.sessionState]);

  // ===== graphRef 同步 =====
  useEffect(() => {
    graphRef.current = panel.graph;
  }, [panel.graph]);

  useEffect(() => {
    fixtureLabIdRef.current = panel.fixtureLabId;
  }, [panel.fixtureLabId]);

  // ===== reducer 更新 currentView 时清除用户覆盖 =====
  const prevReducerViewRef = useRef(panel.currentView);
  useEffect(() => {
    if (panel.currentView !== prevReducerViewRef.current) {
      prevReducerViewRef.current = panel.currentView;
      setUserViewOverride(null);
    }
  }, [panel.currentView]);

  // ===== 开发模式：模拟音频捕获 =====
  useEffect(() => {
    if (!isDevMode || panel.sessionState !== 'capturing') return;

    const generateNode = () => {
      const elapsedMs = Date.now() - sessionStartTimeRef.current;
      const text = MOCK_TRANSCRIPTS[transcriptIndexRef.current % MOCK_TRANSCRIPTS.length];
      transcriptIndexRef.current++;

      const nodeType = NODE_TYPES[Math.floor(Math.random() * NODE_TYPES.length)];
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

      const prev = graphRef.current;
      const newEdges: GraphEdge[] =
        prev.nodes.length > 0
          ? [{
              id: `e_${Date.now()}`,
              source: prev.nodes[prev.nodes.length - 1].id,
              target: nodeId,
              type: EDGE_TYPES[Math.floor(Math.random() * EDGE_TYPES.length)],
              confidence: 0.8 + Math.random() * 0.15,
            }]
          : [];

      const updated: MergedGraph = {
        ...prev,
        revision: prev.revision + 1,
        topics: prev.topics.map((t) => ({ ...t, endMs: elapsedMs })),
        nodes: [...prev.nodes, newNode],
        edges: [...prev.edges, ...newEdges],
        updatedAt: Date.now(),
      };

      addLog(`转写: ${text}`);
      addLog(`节点: +1 (${newNode.type}) | ${formatGraphDeltaLog(prev, updated)}`);

      dispatch({
        type: 'MERGED_GRAPH_UPDATED',
        payload: {
          graph: updated,
          shouldPreserveView: false,
          previousGraph: prev,
          addedNodeIds: [nodeId],
          anchorNodeIds: [],
        },
      });
      graphRef.current = updated;
      dispatch({ type: 'PLAYBACK_TIME_UPDATED', payload: { currentTimeMs: elapsedMs } });
    };

    generateNode();
    const interval = setInterval(generateNode, 30000);
    return () => clearInterval(interval);
  }, [panel.sessionState, addLog, dispatch]);

  // ===== Hydrate snapshot =====
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

      if (disposed || !response?.success) return;
      if (fixtureLabIdRef.current) return;

      const snapshot = response.snapshot;
      const rawPreferredView = snapshot.graph
        ? (snapshot.currentView ?? snapshot.graph.viewHints?.defaultView ?? 'causal')
        : 'causal';
      const preferredView: ViewType = rawPreferredView;

      dispatch({ type: 'HYDRATE_SNAPSHOT', payload: { ...snapshot, preferredView } });

      if (snapshot.providerSummary) {
        setProviderSummary(snapshot.providerSummary);
      }

      userPinnedViewRef.current = snapshot.currentViewPinned ?? false;
      activeViewSessionRef.current = snapshot.graph?.sessionId ?? null;
      resetAutoTourState();
    };

    void hydrateSnapshot();
    return () => { disposed = true; };
  }, []);

  // ===== 获取当前 tab =====
  useEffect(() => {
    if (isDevMode) {
      addLog('开发模式: 已启用模拟数据');
      return;
    }
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) addLog(`标签页 ID: ${tabs[0].id}`);
    });
  }, [addLog]);

  // ===== layout cache reset（useEffect 在 useLayoutEffect 之后运行，不可在此清 auto-tour seed）=====
  useEffect(() => {
    if (!panel.graph.nodes.length) {
      resetLayoutCache();
      resetAutoTourState();
      return;
    }
    if (layoutCacheSessionRef.current !== panel.graph.sessionId) {
      resetLayoutCacheData();
      layoutCacheSessionRef.current = panel.graph.sessionId;
    }
  }, [panel.graph.nodes.length, panel.graph.sessionId, resetAutoTourState, resetLayoutCache, resetLayoutCacheData]);

  // ===== 状态卡片 =====
  const statusCardInputs = useMemo(
    () => ({ panel, providerAsrType, statusNowMs }),
    [panel, providerAsrType, statusNowMs],
  );
  const asrStatusCard = useMemo(() => computeAsrStatusCard(statusCardInputs), [statusCardInputs]);
  const structurerStatusCard = useMemo(() => computeStructurerStatusCard(statusCardInputs), [statusCardInputs]);
  // 已移除 primaryStatusCards，改为单独使用 asrStatusCard / structurerStatusCard

  // ===== 导出 =====
  const isRunning = ['capturing', 'transcribing', 'structuring'].includes(panel.sessionState);

  // ===== 波浪分隔线状态推导 =====
  const asrWaveStatus = useMemo<WaveDividerStatus>(() => {
    if (panel.recentProviderError?.stage === 'asr') return 'error';
    if (['capturing', 'transcribing'].includes(panel.sessionState)) return 'active';
    return 'idle';
  }, [panel.sessionState, panel.recentProviderError]);

  const structurerWaveStatus = useMemo<WaveDividerStatus>(() => {
    if (panel.recentProviderError?.stage === 'structurer') return 'error';
    if (panel.sessionState === 'structuring') return 'active';
    if (panel.stopPending && panel.stopDrainPendingCount > 0) return 'active';
    return 'idle';
  }, [panel.sessionState, panel.recentProviderError, panel.stopPending, panel.stopDrainPendingCount]);

  const graphWaveStatus = useMemo<WaveDividerStatus>(() => {
    if (panel.graph.nodes.length === 0) return 'idle';
    if (isRunning) return 'active';
    return 'complete';
  }, [panel.graph.nodes.length, isRunning]);

  const canExport =
    Boolean(exportSessionId) &&
    panel.graph.nodes.length > 0 &&
    !panel.stopPending &&
    !['transcribing', 'structuring', 'error'].includes(panel.sessionState);
  const canReplay =
    Boolean(exportSessionId) && panel.graph.nodes.length > 0 && !panel.stopPending && !isRunning;

  const handleExport = useCallback(
    async (format: ExportFormat) => {
      if (!exportSessionId || !canExport) return;
      try {
        const response = (await chrome.runtime.sendMessage({
          type: 'EXPORT_SESSION',
          target: 'service-worker',
          payload: { sessionId: exportSessionId, format },
        } as AppMessage)) as
          | { success: true; exportData: { filename: string; mimeType: string; content: string } }
          | { success: false; error?: string };

        if (!response?.success) {
          addLog(`导出失败: ${response?.error || '未知错误'}`);
          return;
        }
        downloadTextFile(response.exportData.filename, response.exportData.content, response.exportData.mimeType);
        addLog(`已导出: ${response.exportData.filename}`);
      } catch (error) {
        addLog(`导出失败: ${error instanceof Error ? error.message : '未知错误'}`);
      }
    },
    [addLog, canExport, exportSessionId],
  );

  // ===== 调试 =====
  const loadDebugSession = useCallback(async () => {
    if (!exportSessionId) { setDebugData(null); return; }
    try {
      const response = (await chrome.runtime.sendMessage({
        type: 'GET_DEBUG_SESSION',
        target: 'service-worker',
        payload: { sessionId: exportSessionId },
      } as AppMessage)) as
        | { success: true; debugData: DebugSessionData }
        | { success: false; error?: string };

      if (!response?.success) { addLog(`调试数据加载失败: ${response?.error || '未知错误'}`); return; }
      setDebugData(response.debugData);
    } catch (error) {
      addLog(`调试数据加载失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  }, [addLog, exportSessionId]);

  useEffect(() => {
    if (!debugOpen || isDevMode) return;
    void loadDebugSession();
  }, [debugOpen, loadDebugSession, panel.sessionState]);

  // ===== 图谱布局 =====
  const viewScores = useMemo(() => scoreViews(panel.graph), [panel.graph]);

  const layoutBuild = useMemo(
    () => buildDebugViewArtifacts({
      graph: panel.graph,
      currentTimeMs: panel.currentTimeMs,
      selectedNodeId: panel.selectedNodeId,
      previousLayoutCache: layoutCacheRef.current,
    }),
    [panel.currentTimeMs, panel.graph, panel.selectedNodeId],
  );
  const debugViewArtifacts = layoutBuild.artifacts;

  useLayoutEffect(() => {
    layoutCacheRef.current = layoutBuild.nextLayoutCache;
  }, [layoutBuild]);

  const flowEdges = useMemo<Edge[]>(
    () => debugViewArtifacts[currentView].reactFlow.edges,
    [currentView, debugViewArtifacts],
  );

  // ===== 同步 auto-tour refs =====
  debugViewArtifactsRef.current = debugViewArtifacts;
  flowEdgesRef.current = flowEdges;

  // ===== Auto fit =====
  const requestAutoFit = useCallback(
    (options?: {
      sizeHint?: { width: number; height: number };
      force?: boolean;
    }) => {
      if (!panel.graph.nodes.length || (!options?.force && hasAutoFitRef.current)) return;
      const inst = reactFlowInstanceRef.current;
      if (!inst?.fitView) return;
      const el = flowContainerRef.current;
      const w = options?.sizeHint?.width ?? el?.clientWidth ?? 0;
      const h = options?.sizeHint?.height ?? el?.clientHeight ?? 0;
      if (w < 2 || h < 2) return;
      withProgrammaticViewportChange(() => {
        inst.fitView({
          padding: AUTO_FIT_PADDING,
          duration: AUTO_FIT_DURATION_MS,
          minZoom: getReadableAutoFitMinZoom(
            graphDisplaySettings.autoFitMinReadableFontPx,
          ),
        });
      });
      hasAutoFitRef.current = true;
      maybeStartAutoTour();
    },
    [
      graphDisplaySettings.autoFitMinReadableFontPx,
      maybeStartAutoTour,
      panel.graph.nodes.length,
      withProgrammaticViewportChange,
    ],
  );

  // ===== Node click / time click =====
  const sendSeekMessage = useCallback(
    async (nodeId: string, timestampMs: number) => {
      if (!panel.sessionId || !isRunning) return;
      const result = await chrome.runtime.sendMessage({
        type: 'NODE_CLICKED',
        target: 'service-worker',
        payload: { sessionId: panel.sessionId, nodeId, timestampMs },
      } as AppMessage);
      if (!result?.success) addLog(`跳转失败: ${result?.error || '未知错误'}`);
    },
    [addLog, isRunning, panel.sessionId],
  );

  const handleNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      lastUserViewportChangeAtRef.current = Date.now();
      pauseAutoTour();
      dispatch({ type: 'PLAYBACK_TIME_UPDATED', payload: { currentTimeMs: node.data.timestampMs as number } });
      dispatch({ type: 'SELECT_NODE', payload: { nodeId: node.id } });
      void sendSeekMessage(node.id, node.data.timestampMs as number);
    },
    [pauseAutoTour, sendSeekMessage],
  );

  const handleTimeClick = useCallback(
    (ms: number) => {
      lastUserViewportChangeAtRef.current = Date.now();
      pauseAutoTour();
      dispatch({ type: 'PLAYBACK_TIME_UPDATED', payload: { currentTimeMs: ms } });
      if (panel.graph.nodes.length === 0) return;
      const nearest = panel.graph.nodes.reduce((a, b) =>
        Math.abs(a.timestampMs - ms) < Math.abs(b.timestampMs - ms) ? a : b,
      );
      dispatch({ type: 'SELECT_NODE', payload: { nodeId: nearest.id } });
      void sendSeekMessage(nearest.id, ms);
    },
    [dispatch, pauseAutoTour, panel.graph, sendSeekMessage],
  );

  const activeTourNodeIds = useMemo(
    () => new Set(activeAutoTourStage?.nodeIds ?? []),
    [activeAutoTourStage],
  );
  const activeTourAnchorIds = useMemo(
    () => new Set(activeAutoTourStage?.anchorNodeIds ?? []),
    [activeAutoTourStage],
  );

  const flowNodes = useMemo<Node[]>(
    () =>
      debugViewArtifacts[currentView].reactFlow.nodes.map((node) => {
        const isTourAdded = activeTourNodeIds.has(node.id);
        const isTourAnchor = activeTourAnchorIds.has(node.id);
        return {
          ...node,
          data: {
            ...node.data,
            onClickTime: handleTimeClick,
            displayMode: isTourAdded || isTourAnchor
              ? activeAutoTourStage?.displayMode ?? 'readable'
              : 'readable',
            isTourAdded,
            isTourAnchor,
          },
        };
      }),
    [activeAutoTourStage, activeTourAnchorIds, activeTourNodeIds, currentView, debugViewArtifacts, handleTimeClick],
  );

  // ===== Layout effects =====
  useLayoutEffect(() => { requestAutoFit(); }, [requestAutoFit]);

  useLayoutEffect(() => {
    maybeStartAutoTour();
  }, [flowNodes, panel.graph.revision, maybeStartAutoTour]);

  useLayoutEffect(() => {
    const el = flowContainerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      requestAutoFit({
        sizeHint: {
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        },
      });
    });
    ro.observe(el);
    return () => { ro.disconnect(); };
  }, [requestAutoFit]);

  // ===== 导出 payload =====
  const exportLogLines = useMemo(() => timelineEventsToExportLines(panel.timelineEvents), [panel.timelineEvents]);

  const handleExportDebug = useCallback(
    (mode: DebugExportMode) => {
      if (!debugData) { addLog('调试数据为空，无法导出'); return; }
      const debugSessionId = debugData.session?.sessionId ?? exportSessionId ?? 'listen-graphic';
      const filename = mode === 'full' ? `${debugSessionId}-debug-full.json` : `${debugSessionId}-debug-summary.json`;
      const payload = buildDebugExportPayload({
        mode,
        sessionId: exportSessionId,
        sessionState: panel.sessionState,
        currentView,
        workerBuildLabel: panel.workerBuildLabel,
        providerSummary,
        logs: exportLogLines,
        autoTourTrace: getAutoTourTrace(),
        debugData,
        derivedViews: debugViewArtifacts,
      });
      downloadTextFile(filename, JSON.stringify(payload, null, 2), 'application/json');
      addLog(`已导出: ${filename}`);
    },
    [
      addLog,
      currentView,
      debugData,
      debugViewArtifacts,
      exportLogLines,
      exportSessionId,
      panel.sessionState,
      panel.workerBuildLabel,
      providerSummary,
    ],
  );

  const handleExportAssemblerLog = useCallback(
    () => {
      const runs = debugData?.assemblerRuns ?? [];
      const units = debugData?.structureUnits ?? [];
      if (!runs.length && !units.length) {
        addLog('assembler 决策数据为空，无法导出');
        return;
      }
      const debugSessionId = debugData?.session?.sessionId ?? exportSessionId ?? 'listen-graphic';
      const traceSource = debugData?.traceSource ?? 'empty';
      const payload = buildAssemblerLogPayload({
        assemblerRuns: runs,
        structureUnits: units,
        sessionId: debugSessionId,
        traceSource,
      });
      const filename = `${debugSessionId}-assembler-log.json`;
      downloadTextFile(filename, JSON.stringify(payload, null, 2), 'application/json');
      addLog(`已导出: ${filename}`);
    },
    [addLog, debugData, exportSessionId],
  );

  // ===== Active replay transcript =====
  const activeReplayTranscript = useMemo(() => {
    if (!replayData) return null;
    return (
      replayData.transcripts.find(
        (chunk) => panel.currentTimeMs >= chunk.startMs && panel.currentTimeMs < chunk.endMs,
      ) ?? replayData.transcripts[replayData.transcripts.length - 1] ?? null
    );
  }, [panel.currentTimeMs, replayData]);

  // ===== Auto-tour indicator =====
  const autoTourIndicatorColor =
    autoTourStatus === 'touring' ? 'var(--lg-success)'
      : autoTourStatus === 'paused' ? 'var(--lg-danger)'
        : isRunning ? 'var(--lg-success)' : 'var(--lg-rim)';
  const autoTourPhaseSuffix =
    activeAutoTourStage?.kind != null
      ? ` (${getAutoTourStageKindLabel(activeAutoTourStage.kind)})`
      : '';
  const autoTourStatusText =
    autoTourStatus === 'touring'
      ? `自动导览 ${autoTourProgress.current}/${autoTourProgress.total}${autoTourPhaseSuffix}`
      : autoTourStatus === 'paused'
        ? `导览暂停 ${autoTourProgress.current}/${autoTourProgress.total}${autoTourPhaseSuffix}`
        : isRunning
          ? '运行中'
          : '空闲';

  const bridgeHealth = panel.bridgeHealth.status !== 'idle' ? panel.bridgeHealth : localBridgeHealth;

  const graphSummaryText =
    panel.graph.nodes.length > 0
      ? `${panel.graph.nodes.length}n · ${panel.graph.edges.length}e · 更新 ${formatRelativeAge(panel.lastGraphUpdatedAt, statusNowMs)}`
      : null;

  // ===== 条件渲染：设置面板全页覆盖 =====
  if (settingsOpen) {
    return (
      <SettingsPanel
        providerConfig={providerConfig}
        providerSummary={providerSummary}
        settingsSaving={settingsSaving || graphDisplaySettingsSaving}
        bridgeHealth={bridgeHealth}
        graphDisplaySettings={graphDisplaySettings}
        isDirty={isDirty}
        onUpdateProviderEntry={updateProviderEntry}
        onProviderTypeChange={handleProviderTypeChange}
        onUpdateAutoFitMinReadableFontPx={updateAutoFitMinReadableFontPx}
        onSaveSettings={handleSaveAllSettings}
        onClearSecrets={handleClearSecrets}
        onClose={() => void handleToggleAllSettings()}
      />
    );
  }

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }} data-theme={theme}>
      <style>{`@keyframes listen-graphic-tour-pulse { 0% { opacity: 1; transform: scale(1); } 50% { opacity: 0.45; transform: scale(0.82); } 100% { opacity: 1; transform: scale(1); } } @keyframes fadeIn { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }`}</style>
      {/* 顶部栏 */}
      <GraphToolbar
        brandName="Listen Graphic"
        primaryAction={{
          label: isRunning ? '停止' : '开始',
          onClick: isRunning ? handleStop : handleStart,
          active: isRunning,
        }}
        actions={
          <>
            <button
              className="lg-btn lg-btn-ghost lg-btn-sm"
              onClick={() => void handleToggleAllSettings()}
              style={{ backgroundColor: settingsOpen ? 'var(--lg-calm)' : undefined, color: settingsOpen ? 'var(--lg-signal)' : undefined }}
            >
              设置
            </button>
            <DropdownMenu
              triggerLabel="更多"
              items={[
                { id: 'export-json', label: '导出 JSON', disabled: !canExport, testId: 'overflow-menu-export-json' },
                { id: 'export-markdown', label: '导出 Markdown', disabled: !canExport, testId: 'overflow-menu-export-markdown' },
                { id: 'export-mermaid', label: '导出 Mermaid', disabled: !canExport, testId: 'overflow-menu-export-mermaid' },
                { id: 'debug', label: '调试', active: debugOpen, testId: 'overflow-menu-debug' },
                { id: 'replay', label: '回放', disabled: !canReplay, active: replayOpen, testId: 'overflow-menu-replay' },
              ]}
              onSelect={(id) => {
                switch (id) {
                  case 'export-json': handleExport('json'); break;
                  case 'export-markdown': handleExport('markdown'); break;
                  case 'export-mermaid': handleExport('mermaid'); break;
                  case 'debug': setDebugOpen((p) => !p); break;
                  case 'replay': void handleToggleReplay(); break;
                }
              }}
              footer={`UI ${BUILD_INFO.label} | Worker ${panel.workerBuildLabel}`}
            />
          </>
        }
      />
      {panel.recentProviderError && (
        <ErrorBanner
          stage={formatErrorStageLabel(panel.recentProviderError.stage)}
          code={panel.recentProviderError.code}
          message={panel.recentProviderError.message}
        />
      )}
      {/* 管线状态 */}
      <PipelineLayout
        asr={{
          module: {
            label: asrStatusCard.label,
            detail: asrStatusCard.detail,
            tone: asrStatusCard.tone,
            testId: `status-card-${asrStatusCard.label.toLowerCase()}`,
          },
          waveStatus: asrWaveStatus,
          waveTone: 'signal',
        }}
        structurer={{
          module: {
            label: structurerStatusCard.label,
            detail: structurerStatusCard.detail,
            tone: structurerStatusCard.tone,
            testId: `status-card-${structurerStatusCard.label.toLowerCase()}`,
          },
          waveStatus: structurerWaveStatus,
          waveTone: 'insight',
        }}
        graph={{
          module: {
            label: 'Graph',
            detail: graphSummaryText ?? '等待图谱数据',
            tone: isRunning ? 'active' : panel.graph.nodes.length > 0 ? 'success' : 'neutral',
          },
          waveStatus: graphWaveStatus,
          waveTone: 'neutral',
        }}
        graphExtra={
          graphSummaryText ? (
            <div
              data-testid="graph-view-summary"
              style={{
                padding: '2px 8px',
                color: 'var(--lg-muted)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                fontSize: '0.55rem',
              }}
            >
              <span
                data-testid="auto-tour-indicator"
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  backgroundColor: autoTourIndicatorColor,
                  animation:
                    autoTourStatus === 'touring'
                      ? 'listen-graphic-tour-pulse 1s ease-in-out infinite'
                      : 'none',
                  display: 'inline-block',
                }}
              />
              <span data-testid="auto-tour-status">{autoTourStatusText}</span>
            </div>
          ) : undefined
        }
      />
      {/* 视图切换 */}
      <ViewSwitcher
        currentView={currentView}
        onViewChange={(v) => {
          lastUserViewportChangeAtRef.current = Date.now();
          pauseAutoTour();
          userPinnedViewRef.current = true;
          setUserViewOverride(v);
          if (panel.sessionId && isRunning) {
            void chrome.runtime.sendMessage({
              type: 'VIEW_SELECTED', target: 'service-worker',
              payload: { sessionId: panel.sessionId, view: v },
            } as AppMessage);
          }
        }}
        onFitView={() => requestAutoFit({ force: true })}
        fitViewDisabled={panel.graph.nodes.length === 0}
      />
      {/* 图表区域 */}
      <div ref={flowContainerRef} style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <GraphArea
          nodes={flowNodes}
          edges={flowEdges}
          nodeTypes={nodeTypes}
          isIdle={panel.graph.nodes.length === 0 && !isRunning && panel.sessionState === 'idle'}
          onNodeClick={handleNodeClick}
          onMoveStart={handleViewportMoveStart}
          onMoveEnd={handleViewportMoveEnd}
          onInit={(instance) => {
            reactFlowInstanceRef.current = instance;
            // 同步调用，便于测试在 act() 内与 deferred trigger 对齐
            requestAutoFit();
          }}
        />
        <ResizeHandle onResizeStart={handleLogResizeStart} />
        <TimelineLogPanel events={panel.timelineEvents} height={logPanelHeight} />
        {debugOpen && (
          <DebugPanel debugData={debugData} sessionId={exportSessionId}
            onExportDebug={handleExportDebug}
            onExportAssemblerLog={handleExportAssemblerLog} />
        )}
        {replayOpen && (
          <ReplayPanel replayData={replayData} replayPlaying={replayPlaying}
            currentTimeMs={panel.currentTimeMs} activeReplayTranscript={activeReplayTranscript}
            onTogglePlay={() => handleReplayTogglePlay(panel.currentTimeMs)}
            onScrub={(e) => handleReplayScrub(Number(e.target.value))} />
        )}
      </div>
      {/* 底部状态 */}
      <StatusBar
        segments={[
          { id: 'session', content: `会话: ${panel.sessionId || '无'}` },
          { id: 'time', content: `当前时间: ${formatTime(panel.currentTimeMs)}` },
        ]}
      />
    </div>
  );
}
