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
  ReactFlow,
  Background,
  Controls,
  type Node,
  type Edge,
  type ReactFlowInstance,
} from 'reactflow';
import 'reactflow/dist/style.css';

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
  formatTime,
  formatRelativeAge,
  getStatusCardStyles,
} from './timeline-utils';
import { createEmptyStableLayoutCache, buildDebugViewArtifacts } from './graph-utils';
import {
  createEmptyGraph,
  MOCK_TRANSCRIPTS,
  NODE_TYPES,
  EDGE_TYPES,
  SPEAKERS,
  VIEW_TYPES,
  VIEW_LABELS,
  VISIBLE_VIEW_TYPES,
  isDevMode,
} from './constants';
import { formatGraphDeltaLog, downloadTextFile, buildDebugExportPayload, buildAssemblerLogPayload } from './debug-export-utils';
import { getAutoTourTrace } from './auto-tour-trace';
import { GraphNodeCard } from './GraphNodeCard';
import { OverflowMenu } from './OverflowMenu';
import { LogPanel } from './LogPanel';
import { DebugPanel } from './DebugPanel';
import { ReplayPanel } from './ReplayPanel';
import { SettingsPanel } from './SettingsPanel';

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

// 节点正文基准字号（与 GraphNodeCard.tsx 的 fontSize 保持同步）
const GRAPH_NODE_BODY_FONT_PX = 12;
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
  } = useGraphDisplaySettings({ addLog });

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

  const handleSaveAllSettings = useCallback(async () => {
    await handleSaveSettings();
    await saveGraphDisplaySettings();
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
  }, [resetAutoTourState]);

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
  const primaryStatusCards = useMemo(() => [asrStatusCard, structurerStatusCard], [asrStatusCard, structurerStatusCard]);

  // ===== 导出 =====
  const isRunning = ['capturing', 'transcribing', 'structuring'].includes(panel.sessionState);
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
    autoTourStatus === 'touring' ? '#10b981'
      : autoTourStatus === 'paused' ? '#ef4444'
        : isRunning ? '#10b981' : '#d1d5db';
  const autoTourStatusText =
    autoTourStatus === 'touring' ? `自动导览 ${autoTourProgress.current}/${autoTourProgress.total}`
      : autoTourStatus === 'paused' ? `导览暂停 ${autoTourProgress.current}/${autoTourProgress.total}`
        : isRunning ? '运行中' : '空闲';

  const bridgeHealth = panel.bridgeHealth.status !== 'idle' ? panel.bridgeHealth : localBridgeHealth;

  const graphSummaryText =
    panel.graph.nodes.length > 0
      ? `${panel.graph.nodes.length}n · ${panel.graph.edges.length}e · 更新 ${formatRelativeAge(panel.lastGraphUpdatedAt, statusNowMs)}`
      : null;

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <style>{`@keyframes listen-graphic-tour-pulse { 0% { opacity: 1; transform: scale(1); } 50% { opacity: 0.45; transform: scale(0.82); } 100% { opacity: 1; transform: scale(1); } }`}</style>
      {/* 顶部栏 */}
      <div style={{ padding: '8px 12px', borderBottom: '1px solid #e5e7eb', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        <span style={{ fontWeight: 600, fontSize: 14 }}>Listen Graphic</span>
        <button onClick={() => void handleToggleAllSettings()}
          style={{ padding: '4px 8px', borderRadius: 4, border: '1px solid #d1d5db', backgroundColor: settingsOpen ? '#eff6ff' : 'white', color: settingsOpen ? '#1d4ed8' : '#374151', fontSize: 11, cursor: 'pointer' }}>
          设置
        </button>
        <OverflowMenu
          canExport={canExport}
          canReplay={canReplay}
          debugOpen={debugOpen}
          replayOpen={replayOpen}
          buildInfo={{ uiLabel: BUILD_INFO.label, workerLabel: panel.workerBuildLabel }}
          onExport={handleExport}
          onToggleDebug={() => setDebugOpen((p) => !p)}
          onToggleReplay={() => void handleToggleReplay()}
        />
        <button onClick={isRunning ? handleStop : handleStart}
          style={{ marginLeft: 'auto', padding: '4px 12px', borderRadius: 4, border: 'none', backgroundColor: isRunning ? '#ef4444' : '#3b82f6', color: 'white', fontSize: 12, cursor: 'pointer', fontWeight: 600 }}>
          {isRunning ? '停止' : '开始'}
        </button>
      </div>
      {panel.recentProviderError && (
        <div data-testid="recent-error-banner"
          style={{ padding: '8px 12px', borderBottom: '1px solid #fecaca', backgroundColor: '#fef2f2', color: '#991b1b', fontSize: 11, display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <span style={{ fontWeight: 700 }}>最近错误</span>
          <span style={{ fontFamily: 'monospace' }}>
            {formatErrorStageLabel(panel.recentProviderError.stage)} / {panel.recentProviderError.code}
          </span>
          <span style={{ color: '#7f1d1d' }}>{panel.recentProviderError.message}</span>
        </div>
      )}
      <div
        data-testid="runtime-status-cards"
        style={{
          padding: '6px 12px',
          display: 'grid',
          gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
          gap: 8,
          flexShrink: 0,
        }}
      >
        {primaryStatusCards.map((card) => {
          const styles = getStatusCardStyles(card.tone);
          const isStructurer = card.label === 'Structurer';
          return (
            <div
              key={card.label}
              data-testid={`status-card-${card.label.toLowerCase()}`}
              style={{
                border: `1px solid ${styles.borderColor}`,
                borderRadius: 8,
                backgroundColor: styles.backgroundColor,
                padding: '4px 8px',
                display: 'grid',
                gap: 2,
                minWidth: 0,
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: styles.statusColor,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  minWidth: 0,
                }}
              >
                <span style={{ color: styles.titleColor, fontSize: 10, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                  {card.label}
                </span>
                <span style={{ color: '#94a3b8' }}>·</span>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{card.status}</span>
              </div>
              <div
                title={card.detail}
                style={{
                  fontSize: 10,
                  color: styles.detailColor,
                  lineHeight: 1.3,
                  overflow: 'hidden',
                  ...(isStructurer
                    ? {
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical' as const,
                      }
                    : {
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }),
                }}
              >
                {card.detail}
              </div>
            </div>
          );
        })}
      </div>
      {graphSummaryText && (
        <div
          data-testid="graph-view-summary"
          style={{
            margin: '0 12px 6px',
            padding: '5px 10px',
            border: '1px solid #dbe4ee',
            borderRadius: 8,
            backgroundColor: '#f8fafc',
            color: '#475569',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 10,
            flexWrap: 'wrap',
            flexShrink: 0,
            fontSize: 11,
          }}
        >
          <span>{graphSummaryText}</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span
              data-testid="auto-tour-indicator"
              style={{
                width: 8,
                height: 8,
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
        </div>
      )}
      {/* 视图切换 */}
      <div style={{ padding: '6px 12px', borderBottom: '1px solid #e5e7eb', display: 'flex', gap: 6, flexShrink: 0, alignItems: 'center' }}>
        {VISIBLE_VIEW_TYPES.map((v) => (
          <button key={v}
            onClick={() => {
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
            style={{
              padding: '3px 8px', borderRadius: 4, fontSize: 11,
              border: currentView === v ? '2px solid #3b82f6' : '1px solid #d1d5db',
              backgroundColor: currentView === v ? '#eff6ff' : 'white',
              color: currentView === v ? '#1d4ed8' : '#374151',
              cursor: 'pointer',
            }}
          >
            {VIEW_LABELS[v]}
            <span style={{ marginLeft: 3, fontSize: 9, color: '#9ca3af' }}>({viewScores[v].toFixed(2)})</span>
          </button>
        ))}
        <button
          onClick={() => requestAutoFit({ force: true })}
          disabled={panel.graph.nodes.length === 0}
          style={{
            padding: '2px 6px',
            borderRadius: 3,
            fontSize: 10,
            border: '1px solid #e5e7eb',
            backgroundColor: panel.graph.nodes.length === 0 ? '#f3f4f6' : 'white',
            color: '#6b7280',
            cursor: panel.graph.nodes.length === 0 ? 'not-allowed' : 'pointer',
          }}
        >
          适配视图
        </button>
      </div>
      {settingsOpen && (
        <SettingsPanel
          providerConfig={providerConfig}
          providerSummary={providerSummary}
          settingsSaving={settingsSaving || graphDisplaySettingsSaving}
          bridgeHealth={bridgeHealth}
          graphDisplaySettings={graphDisplaySettings}
          onUpdateProviderEntry={updateProviderEntry}
          onProviderTypeChange={handleProviderTypeChange}
          onUpdateAutoFitMinReadableFontPx={updateAutoFitMinReadableFontPx}
          onSaveSettings={handleSaveAllSettings}
          onClearSecrets={handleClearSecrets}
        />
      )}
      {/* 图表区域 */}
      <div ref={flowContainerRef} style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <ReactFlow
          nodes={flowNodes}
          edges={flowEdges}
          nodeTypes={nodeTypes}
          onNodeClick={handleNodeClick}
          onMoveStart={handleViewportMoveStart}
          onMoveEnd={handleViewportMoveEnd}
          onInit={(instance) => {
            reactFlowInstanceRef.current = instance;
            queueMicrotask(() => requestAutoFit());
          }}
          minZoom={0.3}
          maxZoom={2}
        >
          <Background />
          <Controls />
        </ReactFlow>
        <div data-testid="log-resizer" onMouseDown={handleLogResizeStart}
          style={{ height: 8, flexShrink: 0, cursor: 'row-resize', background: 'linear-gradient(to bottom, #dbe4ee 0, #dbe4ee 1px, #f8fafc 1px, #f8fafc 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          aria-label="调整日志面板高度" role="separator"
        >
          <div style={{ width: 48, height: 4, borderRadius: 999, backgroundColor: '#94a3b8' }} />
        </div>
        <LogPanel logPanelHeight={logPanelHeight} timelineEvents={panel.timelineEvents} />
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
      <div style={{ padding: '6px 12px', borderTop: '1px solid #e5e7eb', fontSize: 11, color: '#6b7280', flexShrink: 0, display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <span>会话: {panel.sessionId || '无'}</span>
        <span>当前时间: {formatTime(panel.currentTimeMs)}</span>
      </div>
    </div>
  );
}
