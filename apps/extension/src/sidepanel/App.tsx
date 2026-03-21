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
} from '@listen-graphic/schema';
import { scoreViews } from '@listen-graphic/domain';
import {
  toCausalRendererGraph,
  toTimelineRendererGraph,
  toComparisonRendererGraph,
  toHierarchyRendererGraph,
  toFlowRendererGraph,
} from '@listen-graphic/graph-renderers';

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

type SessionState =
  | 'idle'
  | 'capturing'
  | 'transcribing'
  | 'structuring'
  | 'paused'
  | 'stopped'
  | 'error';

// 是否为开发模式（模拟数据，不依赖 service worker）
const isDevMode = false;

export default function App() {
  const [sessionState, setSessionState] = useState<SessionState>('idle');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [currentView, setCurrentView] = useState<ViewType>('causal');
  const [currentTimeMs, setCurrentTimeMs] = useState(0);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [graph, setGraph] = useState<MergedGraph>(createEmptyGraph);

  // 开发模式下的 ref
  const transcriptIndexRef = useRef(0);
  const sessionStartTimeRef = useRef(0);

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

    const handleMessage = (message: {
      type: string;
      target?: string;
      payload?: unknown;
    }) => {
      if (message.target && message.target !== 'sidepanel') return;
      switch (message.type) {
        case 'SESSION_STATE_CHANGED': {
          const p = message.payload as {
            sessionId: string;
            state: SessionState;
          };
          setSessionId(p.sessionId);
          setSessionState(p.state);
          addLog(`状态: ${p.state}`);
          break;
        }
        case 'TRANSCRIPT_READY': {
          const p = message.payload as { transcript: { text: string } };
          addLog(`转写: ${p.transcript.text}`);
          break;
        }
        case 'MERGED_GRAPH_UPDATED': {
          const p = message.payload as { graph: MergedGraph };
          setGraph(p.graph);
          addLog(`图更新: ${p.graph.nodes.length} 个节点`);
          break;
        }
        case 'AUDIO_CHUNK_READY':
          addLog('收到音频 chunk');
          break;
      }
    };
    chrome.runtime.onMessage.addListener(handleMessage);
    return () => chrome.runtime.onMessage.removeListener(handleMessage);
  }, [addLog]);

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

  // ============ 会话控制 ============

  const handleStart = useCallback(() => {
    if (isDevMode) {
      // 开发模式：本地模拟
      const newSessionId = `session_${Date.now()}`;
      transcriptIndexRef.current = 0;
      sessionStartTimeRef.current = Date.now();

      setSessionId(newSessionId);
      setSessionState('capturing');
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
      setSessionState('capturing');
      const res = await chrome.runtime.sendMessage({
        type: 'SESSION_START',
        target: 'service-worker',
        payload: { tabId: tabs[0].id, sourceType: 'tab' },
      });
      if (res?.success) {
        setSessionId(res.sessionId);
        addLog(`已启动: ${res.sessionId}`);
      } else {
        setSessionState('error');
        addLog(`失败: ${res?.error}`);
      }
    });
  }, [addLog]);

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
    chrome.runtime.sendMessage({
      type: 'SESSION_STOP',
      target: 'service-worker',
      payload: { sessionId },
    });
    setSessionState('idle');
    setSessionId(null);
    addLog('已停止');
  }, [sessionId, addLog]);

  // 处理节点点击
  const handleNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    setCurrentTimeMs(node.data.timestampMs as number);
    setSelectedNodeId(node.id);
  }, []);

  const handleTimeClick = useCallback(
    (ms: number) => {
      setCurrentTimeMs(ms);
      if (graph.nodes.length === 0) return;
      const nearest = graph.nodes.reduce((a, b) =>
        Math.abs(a.timestampMs - ms) < Math.abs(b.timestampMs - ms) ? a : b,
      );
      setSelectedNodeId(nearest.id);
    },
    [graph],
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

  const isRunning = ['capturing', 'transcribing', 'structuring'].includes(
    sessionState,
  );

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
            onClick={() => setCurrentView(v)}
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
