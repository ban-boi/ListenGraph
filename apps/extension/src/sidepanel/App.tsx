import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  type Node,
  type Edge,
  type NodeProps,
  Handle,
  Position,
} from 'reactflow';
import 'reactflow/dist/style.css';

import type {
  ViewType,
  MergedGraph,
  GraphNode,
  GraphEdge,
  EdgeType,
  NodeType,
  ProviderConfig,
} from '@listen-graphic/schema';
import { pickDefaultView, scoreViews } from '@listen-graphic/domain';
import {
  toCausalRendererGraph,
  toTimelineRendererGraph,
  toComparisonRendererGraph,
  toHierarchyRendererGraph,
  toFlowRendererGraph,
} from '@listen-graphic/graph-renderers';
import {
  createDefaultProviderConfig,
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

// ============ 初始空 Graph ============

function createEmptyGraph(): MergedGraph {
  return {
    sessionId: '',
    revision: 0,
    topics: [],
    nodes: [],
    edges: [],
    updatedAt: Date.now(),
  };
}

// ============ Mock 数据模板 (用于开发测试) ============

const MOCK_TRANSCRIPTS = [
  '今天我们来聊聊 AI 创业的挑战。',
  '大模型公司很难靠 API 获得稳定利润。',
  '推理成本高，而且价格竞争非常激烈。',
  '开源模型的追赶速度比预期快很多。',
  '纯 API 模式可能是一条死路。',
  '那什么样的 AI 公司才能真正赚钱呢？',
  '关键是要做垂直场景的深度整合。',
  '通用能力很难形成真正的壁垒。',
];

const NODE_TYPES: NodeType[] = [
  'claim',
  'reason',
  'example',
  'question',
  'conclusion',
];
const EDGE_TYPES: EdgeType[] = [
  'supports',
  'opposes',
  'causes',
  'follows',
  'example_of',
];
const SPEAKERS = ['主持人', '嘉宾A', '嘉宾B'];

// ============ 工具函数 ============

function formatTime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}

function getTypeColor(type: string): string {
  const colors: Record<string, string> = {
    claim: '#3b82f6',
    reason: '#10b981',
    example: '#f59e0b',
    question: '#8b5cf6',
    conclusion: '#ef4444',
  };
  return colors[type] || '#6b7280';
}

function getTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    claim: '观点',
    reason: '论据',
    example: '例子',
    question: '问题',
    conclusion: '结论',
  };
  return labels[type] || type;
}

function downloadTextFile(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ============ 自定义节点组件 ============

interface GraphNodeData {
  label: string;
  nodeType: string;
  speaker?: string;
  timestampMs: number;
  status: 'draft' | 'confirmed';
  isActive: boolean;
  onClickTime: (ms: number) => void;
}

function GraphNodeCard({ data }: NodeProps<GraphNodeData>) {
  const {
    label,
    nodeType,
    speaker,
    timestampMs,
    status,
    isActive,
    onClickTime,
  } = data;
  const color = getTypeColor(nodeType);

  return (
    <div
      style={{
        padding: '10px 12px',
        borderRadius: 6,
        border: `2px solid ${isActive ? '#f59e0b' : color}`,
        backgroundColor: isActive ? '#fffbeb' : '#ffffff',
        boxShadow: isActive
          ? '0 0 8px rgba(245, 158, 11, 0.4)'
          : '0 1px 4px rgba(0,0,0,0.1)',
        minWidth: 140,
        maxWidth: 200,
        opacity: status === 'draft' ? 0.6 : 1,
        transition: 'all 0.2s ease',
      }}
    >
      <Handle
        type="target"
        position={Position.Top}
        style={{ width: 6, height: 6 }}
      />

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          marginBottom: 4,
        }}
      >
        <span
          style={{
            fontSize: 9,
            padding: '1px 4px',
            borderRadius: 3,
            backgroundColor: color,
            color: 'white',
            fontWeight: 600,
          }}
        >
          {getTypeLabel(nodeType)}
        </span>
        {status === 'draft' && (
          <span style={{ fontSize: 9, color: '#9ca3af' }}>草稿</span>
        )}
      </div>

      <div style={{ fontSize: 12, lineHeight: 1.3, marginBottom: 6 }}>
        {label}
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontSize: 10,
          color: '#6b7280',
        }}
      >
        {speaker && <span>{speaker}</span>}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onClickTime(timestampMs);
          }}
          style={{
            background: 'none',
            border: 'none',
            color: '#3b82f6',
            cursor: 'pointer',
            fontFamily: 'monospace',
            padding: 0,
            fontSize: 10,
          }}
        >
          {formatTime(timestampMs)}
        </button>
      </div>

      <Handle
        type="source"
        position={Position.Bottom}
        style={{ width: 6, height: 6 }}
      />
    </div>
  );
}

const nodeTypes = { graphNode: GraphNodeCard };

// ============ 视图选择器 ============

const VIEW_TYPES: ViewType[] = [
  'causal',
  'timeline',
  'comparison',
  'flow',
  'hierarchy',
];
const VIEW_LABELS: Record<ViewType, string> = {
  causal: '因果',
  timeline: '时间线',
  comparison: '对比',
  hierarchy: '层级',
  flow: '流程',
};

// ============ 主组件 ============

// 是否为开发模式（模拟数据，不依赖 service worker）
const isDevMode = false;

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
  const [logs, setLogs] = useState<string[]>([]);
  const [graph, setGraph] = useState<MergedGraph>(createEmptyGraph);
  const [providerConfig, setProviderConfig] = useState<ProviderConfig>(() =>
    createDefaultProviderConfig(),
  );
  const [providerSummary, setProviderSummary] = useState(() =>
    redactProviderConfig(createDefaultProviderConfig()),
  );

  // 开发模式下的 ref
  const transcriptIndexRef = useRef(0);
  const sessionStartTimeRef = useRef(0);
  const userPinnedViewRef = useRef(false);

  const addLog = useCallback((msg: string) => {
    const time = new Date().toLocaleTimeString();
    setLogs((prev) => [`[${time}] ${msg}`, ...prev.slice(0, 49)]);
  }, []);

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
        addLog(
          `节点: +1 (${newNode.type}) | 图更新: ${updated.nodes.length} 个节点`,
        );

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
          const nextState = p.state === 'stopped' ? 'idle' : p.state;
          setSessionId(p.state === 'stopped' ? p.sessionId : nextState === 'idle' ? null : p.sessionId);
          setSessionState(nextState);
          if (p.state === 'stopped' || p.state === 'error') {
            setStopPending(false);
          }
          if (nextState === 'idle' && p.state !== 'stopped') {
            setGraph(createEmptyGraph());
            setCurrentTimeMs(0);
            setSelectedNodeId(null);
            setCurrentView('causal');
            userPinnedViewRef.current = false;
          }
          addLog(`状态: ${p.state}`);
          break;
        }
        case 'TRANSCRIPT_READY': {
          addLog(`转写: ${message.payload.transcript.text}`);
          break;
        }
        case 'MERGED_GRAPH_UPDATED': {
          const nextGraph = message.payload.graph;
          setGraph(nextGraph);
          setCurrentView((prev) =>
            userPinnedViewRef.current
              ? prev
              : nextGraph.viewHints?.defaultView ?? pickDefaultView(nextGraph),
          );
          addLog(`图更新: ${nextGraph.nodes.length} 个节点`);
          break;
        }
        case 'PLAYBACK_TIME_UPDATED':
          setCurrentTimeMs(message.payload.currentTimeMs);
          break;
        case 'ERROR':
          addLog(`错误(${message.payload.code}): ${message.payload.message}`);
          break;
      }
    };
    chrome.runtime.onMessage.addListener(handleMessage);
    return () => chrome.runtime.onMessage.removeListener(handleMessage);
  }, [addLog]);

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
      setSessionId(snapshot.sessionId);
      setSessionState(snapshot.state === 'stopped' ? 'idle' : snapshot.state);
      setCurrentTimeMs(snapshot.currentTimeMs);
      setProviderSummary(
        snapshot.providerSummary ?? redactProviderConfig(createDefaultProviderConfig()),
      );

      if (snapshot.graph) {
        setGraph(snapshot.graph);
        setCurrentView(
          snapshot.currentView ??
            snapshot.graph.viewHints?.defaultView ??
            pickDefaultView(snapshot.graph),
        );
        userPinnedViewRef.current = snapshot.currentViewPinned ?? false;
      } else {
        setGraph(createEmptyGraph());
        setCurrentView('causal');
        userPinnedViewRef.current = false;
      }
    };

    void hydrateSnapshot();

    return () => {
      disposed = true;
    };
  }, []);

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
    userPinnedViewRef.current = false;
  }, []);

  const updateProviderEntry = useCallback(
    (
      stage: keyof ProviderConfig,
      field: keyof ProviderConfig['asr'],
      value: string,
    ) => {
      setProviderConfig((prev) => ({
        ...prev,
        [stage]: {
          ...prev[stage],
          [field]: value === '' ? undefined : value,
        },
      }));
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

      setProviderConfig(normalizeProviderConfig(response.config));
    } catch (error) {
      const message = error instanceof Error ? error.message : '读取 provider 设置失败';
      addLog(`加载设置失败: ${message}`);
    }
  }, [addLog, settingsOpen]);

  const handleSaveSettings = useCallback(async () => {
    setSettingsSaving(true);
    try {
      const normalized = normalizeProviderConfig(providerConfig);
      const response = await chrome.runtime.sendMessage({
        type: 'SAVE_PROVIDER_SETTINGS',
        target: 'service-worker',
        payload: {
          config: normalized,
        },
      } as AppMessage);

      if (!response?.success) {
        addLog(`保存设置失败: ${response?.error || '未知错误'}`);
        return;
      }

      setProviderConfig(normalized);
      setProviderSummary(redactProviderConfig(normalized));
      addLog('provider 设置已保存');
    } catch (error) {
      const message = error instanceof Error ? error.message : '保存 provider 设置失败';
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

      const fallbackConfig = createDefaultProviderConfig();
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
      setLogs([]);

      addLog(`会话开始: ${newSessionId}`);
      addLog('状态: capturing (开发模式)');
      return;
    }

    // 生产模式：通过 Chrome API
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      if (!tabs[0]?.id) return;
      clearHistoricalContext();
      setSessionState('capturing');
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
    void chrome.runtime.sendMessage({
      type: 'SESSION_STOP',
      target: 'service-worker',
      payload: { sessionId },
    } as AppMessage);
    addLog('停止中...');
  }, [sessionId, addLog]);

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

  const handleToggleDebug = useCallback(async () => {
    if (debugOpen) {
      setDebugOpen(false);
      return;
    }

    setDebugOpen(true);
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
  }, [addLog, debugOpen, sessionId]);

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

  // 处理节点点击
  const handleNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      setCurrentTimeMs(node.data.timestampMs as number);
      setSelectedNodeId(node.id);
      void sendSeekMessage(node.id, node.data.timestampMs as number);
    },
    [sendSeekMessage],
  );

  const handleTimeClick = useCallback(
    (ms: number) => {
      setCurrentTimeMs(ms);
      if (graph.nodes.length === 0) return;
      const nearest = graph.nodes.reduce((a, b) =>
        Math.abs(a.timestampMs - ms) < Math.abs(b.timestampMs - ms) ? a : b,
      );
      setSelectedNodeId(nearest.id);
      void sendSeekMessage(nearest.id, ms);
    },
    [graph, sendSeekMessage],
  );

  // 获取 renderer
  const getRenderer = useCallback(
    (view: ViewType) => {
      switch (view) {
        case 'timeline':
          return toTimelineRendererGraph(graph);
        case 'comparison':
          return toComparisonRendererGraph(graph);
        case 'hierarchy':
          return toHierarchyRendererGraph(graph);
        case 'flow':
          return toFlowRendererGraph(graph);
        default:
          return toCausalRendererGraph(graph);
      }
    },
    [graph],
  );

  // 生成 ReactFlow 节点和边
  const { nodes: flowNodes, edges: flowEdges } = useMemo(() => {
    const rendererGraph = getRenderer(currentView);

    const nodes: Node[] = rendererGraph.nodes.map((n, i) => {
      let x = 0,
        y = 0;
      switch (currentView) {
        case 'timeline':
          x = (i % 3) * 200;
          y = Math.floor(i / 3) * 130;
          break;
        case 'comparison':
          x = n.speaker === '嘉宾B' ? 250 : 50;
          y = i * 90;
          break;
        case 'hierarchy':
          x = 50 + (i % 3) * 180;
          y = Math.floor(i / 3) * 140;
          break;
        default:
          x = 50 + (i % 2) * 220;
          y = i * 110;
      }

      const isActive =
        Math.abs(n.timestampMs - currentTimeMs) < 30000 ||
        n.id === selectedNodeId;

      return {
        id: n.id,
        type: 'graphNode',
        position: { x, y },
        data: {
          label: n.label,
          nodeType: n.type,
          speaker: n.speaker,
          timestampMs: n.timestampMs,
          status: n.status,
          isActive,
          onClickTime: handleTimeClick,
        },
      };
    });

    const edges: Edge[] = rendererGraph.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      label: e.relation,
      style: {
        stroke:
          e.relation === 'supports'
            ? '#10b981'
            : e.relation === 'opposes'
              ? '#ef4444'
              : e.relation === 'causes'
                ? '#f59e0b'
                : '#6b7280',
      },
      animated: e.relation === 'causes',
    }));

    return { nodes, edges };
  }, [
    currentView,
    currentTimeMs,
    selectedNodeId,
    handleTimeClick,
    getRenderer,
  ]);

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
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
        <div
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            backgroundColor: isRunning ? '#10b981' : '#d1d5db',
          }}
        />
        <span style={{ fontSize: 11, color: '#6b7280' }}>
          {isRunning ? '运行中' : '空闲'}
        </span>
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
        <div
          data-testid="settings-panel"
          style={{
            borderBottom: '1px solid #e5e7eb',
            backgroundColor: '#f8fafc',
            padding: '10px 12px',
            display: 'grid',
            gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
            gap: 12,
            fontSize: 11,
          }}
        >
          {(
            [
              ['asr', 'ASR'],
              ['structurer', 'Structurer'],
            ] as const
          ).map(([stageKey, label]) => (
            <div
              key={stageKey}
              style={{
                border: '1px solid #dbe4ee',
                borderRadius: 6,
                padding: 10,
                backgroundColor: 'white',
                display: 'grid',
                gap: 6,
              }}
            >
              <div style={{ fontWeight: 600 }}>{label}</div>
              <label style={{ display: 'grid', gap: 4 }}>
                <span>{label} Provider Type</span>
                <select
                  aria-label={`${label} Provider Type`}
                  value={providerConfig[stageKey].type}
                  onChange={(event) =>
                    updateProviderEntry(stageKey, 'type', event.target.value)
                  }
                >
                  <option value="mock">Mock (测试)</option>
                  <option value="openai">OpenAI</option>
                  {stageKey === 'asr' && <option value="tencent">腾讯云</option>}
                </select>
              </label>
              {providerConfig[stageKey].type === 'tencent' && stageKey === 'asr' && (
                <div style={{ 
                  padding: '8px', 
                  backgroundColor: '#f0f9ff', 
                  borderRadius: 4, 
                  fontSize: 10,
                  color: '#0369a1',
                  lineHeight: 1.5
                }}>
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>💡 腾讯云 ASR 配置</div>
                  <div>• 免费额度：10小时/月</div>
                  <div>• 价格：0.7-1.5元/小时</div>
                  <div>• 推荐区域：华东地区(上海)</div>
                  <div style={{ marginTop: 4, fontSize: 9, color: '#0c4a6e' }}>
                    获取密钥：console.cloud.tencent.com/cam/capi
                  </div>
                </div>
              )}
              <label style={{ display: 'grid', gap: 4 }}>
                <span>{label} Mode</span>
                <select
                  aria-label={`${label} Mode`}
                  value={providerConfig[stageKey].mode}
                  onChange={(event) =>
                    updateProviderEntry(stageKey, 'mode', event.target.value)
                  }
                >
                  <option value="direct">direct</option>
                  <option value="relay">relay</option>
                </select>
              </label>
              <label style={{ display: 'grid', gap: 4 }}>
                <span>{label} Endpoint</span>
                <input
                  aria-label={`${label} Endpoint`}
                  value={providerConfig[stageKey].endpoint ?? ''}
                  onChange={(event) =>
                    updateProviderEntry(stageKey, 'endpoint', event.target.value)
                  }
                />
              </label>
              <label style={{ display: 'grid', gap: 4 }}>
                <span>{label} Model</span>
                <input
                  aria-label={`${label} Model`}
                  value={providerConfig[stageKey].model ?? ''}
                  onChange={(event) =>
                    updateProviderEntry(stageKey, 'model', event.target.value)
                  }
                />
              </label>
              {/* 腾讯云：独立的 Secret ID 和 Secret Key 输入框 */}
              {providerConfig[stageKey].type === 'tencent' && stageKey === 'asr' ? (
                <>
                  <label style={{ display: 'grid', gap: 4 }}>
                    <span>Secret ID</span>
                    <input
                      aria-label="Tencent Secret ID"
                      type="password"
                      value={providerConfig[stageKey].secretId ?? ''}
                      onChange={(event) =>
                        updateProviderEntry(stageKey, 'secretId', event.target.value)
                      }
                      placeholder="AKIDxxxxxxxxxxxx"
                    />
                  </label>
                  <label style={{ display: 'grid', gap: 4 }}>
                    <span>Secret Key</span>
                    <input
                      aria-label="Tencent Secret Key"
                      type="password"
                      value={providerConfig[stageKey].secretKey ?? ''}
                      onChange={(event) =>
                        updateProviderEntry(stageKey, 'secretKey', event.target.value)
                      }
                      placeholder="xxxxxxxxxxxxxxxx"
                    />
                  </label>
                  <label style={{ display: 'grid', gap: 4 }}>
                    <span>Region (区域)</span>
                    <select
                      aria-label="Tencent Region"
                      value={providerConfig[stageKey].region ?? 'ap-shanghai'}
                      onChange={(event) =>
                        updateProviderEntry(stageKey, 'region', event.target.value)
                      }
                    >
                      <option value="ap-shanghai">华东地区(上海) - 推荐</option>
                      <option value="ap-guangzhou">华南地区(广州)</option>
                      <option value="ap-beijing">华北地区(北京)</option>
                      <option value="ap-chengdu">西南地区(成都)</option>
                    </select>
                  </label>
                </>
              ) : (
                /* 其他 provider：通用的 API Key 输入框 */
                <label style={{ display: 'grid', gap: 4 }}>
                  <span>{label} API Key</span>
                  <input
                    aria-label={`${label} API Key`}
                    type="password"
                    value={providerConfig[stageKey].apiKey ?? ''}
                    onChange={(event) =>
                      updateProviderEntry(stageKey, 'apiKey', event.target.value)
                    }
                  />
                </label>
              )}
              <label style={{ display: 'grid', gap: 4 }}>
                <span>{label} Session Token</span>
                <input
                  aria-label={`${label} Session Token`}
                  type="password"
                  value={providerConfig[stageKey].sessionToken ?? ''}
                  onChange={(event) =>
                    updateProviderEntry(stageKey, 'sessionToken', event.target.value)
                  }
                />
              </label>
              <label style={{ display: 'grid', gap: 4 }}>
                <span>{label} Language</span>
                <input
                  aria-label={`${label} Language`}
                  value={providerConfig[stageKey].language ?? ''}
                  onChange={(event) =>
                    updateProviderEntry(stageKey, 'language', event.target.value)
                  }
                />
              </label>
            </div>
          ))}
          <div
            style={{
              gridColumn: '1 / -1',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
            }}
          >
            <div style={{ color: '#64748b' }}>
              当前摘要:
              {` ASR=${providerSummary.asr.type}(${providerSummary.asr.mode}) `}
              {`Structurer=${providerSummary.structurer.type}(${providerSummary.structurer.mode})`}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => void handleClearSecrets()}>清除密钥</button>
              <button onClick={() => void handleSaveSettings()} disabled={settingsSaving}>
                {settingsSaving ? '保存中...' : '保存设置'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 图表区域 */}
      <div
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
          fitView
          minZoom={0.3}
          maxZoom={2}
        >
          <Background />
          <Controls />
        </ReactFlow>

        {/* 日志区域 */}
        <div
          data-testid="log-area"
          style={{
            height: 120,
            overflowY: 'auto',
            backgroundColor: '#1e1e1e',
            color: '#10b981',
            fontFamily: 'monospace',
            fontSize: 11,
            padding: '6px 8px',
            borderTop: '1px solid #333',
          }}
        >
          {logs.length === 0 ? (
            <div style={{ color: '#666' }}>点击"开始"启动会话...</div>
          ) : (
            logs.map((log, i) => (
              <div key={i} style={{ marginBottom: 2, wordBreak: 'break-all' }}>
                {log}
              </div>
            ))
          )}
        </div>
        {debugOpen && (
          <div
            data-testid="debug-panel"
            style={{
              borderTop: '1px solid #d1d5db',
              backgroundColor: '#f8fafc',
              padding: '8px 12px',
              fontSize: 11,
              color: '#334155',
              maxHeight: 220,
              overflowY: 'auto',
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Debug</div>
            <div style={{ marginBottom: 6 }}>
              sessionId: {debugData?.session?.sessionId ?? sessionId ?? 'none'}
            </div>
            <div style={{ marginBottom: 6 }}>
              transcript chunks: {debugData?.transcripts.length ?? 0}
            </div>
            <div style={{ marginBottom: 6 }}>
              merged graph nodes: {debugData?.graph?.nodes.length ?? 0}
            </div>
            <pre
              style={{
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                margin: 0,
                fontFamily: 'monospace',
              }}
            >
              {JSON.stringify(debugData, null, 2)}
            </pre>
          </div>
        )}
        {replayOpen && (
          <div
            data-testid="replay-panel"
            style={{
              borderTop: '1px solid #d1d5db',
              backgroundColor: '#fff7ed',
              padding: '8px 12px',
              fontSize: 11,
              color: '#7c2d12',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                marginBottom: 6,
              }}
            >
              <div style={{ fontWeight: 600 }}>Replay</div>
              <button
                onClick={handleReplayTogglePlay}
                disabled={!replayData}
                style={{
                  padding: '2px 8px',
                  borderRadius: 4,
                  border: '1px solid #fdba74',
                  backgroundColor: replayData ? 'white' : '#fed7aa',
                  color: '#9a3412',
                  fontSize: 11,
                  cursor: replayData ? 'pointer' : 'not-allowed',
                }}
              >
                {replayPlaying ? '暂停' : '播放'}
              </button>
              <span>回放时长: {formatTime(replayData?.durationMs ?? 0)}</span>
            </div>
            <input
              type="range"
              min={0}
              max={replayData?.durationMs ?? 0}
              step={1000}
              value={Math.min(currentTimeMs, replayData?.durationMs ?? 0)}
              onChange={handleReplayScrub}
              style={{ width: '100%', marginBottom: 6 }}
            />
            <div style={{ marginBottom: 4 }}>回放当前时间: {formatTime(currentTimeMs)}</div>
            <div>
              当前片段: {activeReplayTranscript?.text ?? '暂无 transcript'}
            </div>
          </div>
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
        }}
      >
        <span>会话: {sessionId || '无'}</span>
        <span>当前时间: {formatTime(currentTimeMs)}</span>
        <span>
          节点: {graph.nodes.length} | 边: {graph.edges.length}
        </span>
      </div>
    </div>
  );
}
