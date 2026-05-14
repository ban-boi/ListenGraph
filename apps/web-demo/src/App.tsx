import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
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
  MergedGraph,
  GraphNode,
  GraphEdge,
  EdgeType,
  NodeType,
} from '@listen-graphic/schema';
import { scoreViews, pickDefaultView } from '@listen-graphic/domain';
import {
  toCausalRendererGraph,
  toTimelineRendererGraph,
  toComparisonRendererGraph,
  toHierarchyRendererGraph,
} from '@listen-graphic/graph-renderers';

// ============ 工具函数 ============

function formatTime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}:${String(remainingSeconds).padStart(2, '0')}`;
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

// ============ Mock 数据模板 ============

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

const NODE_TYPES = ['claim', 'reason', 'example', 'question', 'conclusion'];
const EDGE_TYPES = ['supports', 'opposes', 'causes', 'follows', 'example_of'];
const SPEAKERS = ['主持人', '嘉宾A', '嘉宾B'];

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
        padding: '12px 16px',
        borderRadius: 8,
        border: `2px solid ${isActive ? '#f59e0b' : color}`,
        backgroundColor: isActive ? '#fffbeb' : '#ffffff',
        boxShadow: isActive
          ? '0 0 12px rgba(245, 158, 11, 0.5)'
          : '0 2px 8px rgba(0,0,0,0.1)',
        minWidth: 180,
        maxWidth: 240,
        opacity: status === 'draft' ? 0.6 : 1,
        transition: 'all 0.2s ease',
      }}
    >
      <Handle type="target" position={Position.Top} />

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: 6,
        }}
      >
        <span
          style={{
            fontSize: 10,
            padding: '2px 6px',
            borderRadius: 4,
            backgroundColor: color,
            color: 'white',
            fontWeight: 600,
          }}
        >
          {getTypeLabel(nodeType)}
        </span>
        {status === 'draft' && (
          <span style={{ fontSize: 10, color: '#9ca3af' }}>草稿</span>
        )}
      </div>

      <div style={{ fontSize: 13, lineHeight: 1.4, marginBottom: 8 }}>
        {label}
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontSize: 11,
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
          }}
        >
          {formatTime(timestampMs)}
        </button>
      </div>

      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

const nodeTypes = { graphNode: GraphNodeCard };

// ============ 空 Graph ============

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

// ============ 视图布局函数 ============

function getRendererGraph(viewType: string, graph: MergedGraph) {
  switch (viewType) {
    case 'timeline':
      return toTimelineRendererGraph(graph);
    case 'comparison':
      return toComparisonRendererGraph(graph);
    case 'hierarchy':
      return toHierarchyRendererGraph(graph);
    case 'causal':
    default:
      return toCausalRendererGraph(graph);
  }
}

function getLayoutedElements(
  viewType: string,
  graph: MergedGraph,
  currentTimeMs: number,
  selectedNodeId: string | null,
  handleTimeClick: (ms: number) => void,
): { nodes: Node[]; edges: Edge[] } {
  const rendererGraph = getRendererGraph(viewType, graph);

  const layoutNodes: Node[] = rendererGraph.nodes.map((n, i) => {
    let x = 0;
    let y = 0;

    switch (viewType) {
      case 'timeline':
        x = (i % 5) * 220;
        y = Math.floor(i / 5) * 150;
        break;
      case 'comparison':
        x = n.speaker === '嘉宾B' ? 400 : 100;
        y = i * 100;
        break;
      case 'hierarchy':
        x = 100 + (i % 4) * 200;
        y = Math.floor(i / 4) * 160;
        break;
      case 'causal':
      default:
        x = 100 + (i % 3) * 250;
        y = i * 120;
    }

    const isActive =
      (Math.abs(n.timestampMs - currentTimeMs) < 30000 && currentTimeMs > 0) ||
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

  const layoutEdges: Edge[] = rendererGraph.edges.map((e) => ({
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

  return { nodes: layoutNodes, edges: layoutEdges };
}

// ============ 主组件 ============

type SessionState =
  | 'idle'
  | 'capturing'
  | 'transcribing'
  | 'structuring'
  | 'stopped';

const VIEW_TYPES = ['causal', 'timeline', 'comparison', 'hierarchy'];
const VIEW_LABELS: Record<string, string> = {
  causal: '因果图',
  timeline: '时间线',
  comparison: '对比图',
  hierarchy: '层级图',
};

export default function App() {
  const [sessionState, setSessionState] = useState<SessionState>('idle');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [currentView, setCurrentView] = useState<string>('causal');
  const [currentTimeMs, setCurrentTimeMs] = useState(0);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [graph, setGraph] = useState<MergedGraph>(createEmptyGraph);
  const [logs, setLogs] = useState<string[]>([]);

  // 用于生成唯一 ID 和随机选择
  const transcriptIndexRef = useRef(0);
  const sessionStartTimeRef = useRef(0);

  const addLog = useCallback((msg: string) => {
    const time = new Date().toLocaleTimeString();
    setLogs((prev) => [`[${time}] ${msg}`, ...prev.slice(0, 49)]);
  }, []);

  // 计算视图分数
  const viewScores = useMemo(() => scoreViews(graph), [graph]);

  // 处理节点点击
  const handleNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    setCurrentTimeMs(node.data.timestampMs as number);
    setSelectedNodeId(node.id);
  }, []);

  // 处理时间按钮点击
  const handleTimeClick = useCallback(
    (ms: number) => {
      setCurrentTimeMs(ms);
      const nearestNode = graph.nodes.reduce((prev, curr) =>
        Math.abs(curr.timestampMs - ms) < Math.abs(prev.timestampMs - ms)
          ? curr
          : prev,
      );
      setSelectedNodeId(nearestNode.id);
    },
    [graph.nodes],
  );

  // 生成布局节点
  const { nodes: layoutNodes, edges: layoutEdges } = useMemo(() => {
    return getLayoutedElements(
      currentView,
      graph,
      currentTimeMs,
      selectedNodeId,
      handleTimeClick,
    );
  }, [currentView, graph, currentTimeMs, selectedNodeId, handleTimeClick]);

  // ============ 会话控制 ============

  const handleStart = useCallback(() => {
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
    addLog('状态: capturing');
  }, [addLog]);

  const handleStop = useCallback(() => {
    setSessionState('stopped');
    setSessionId(null);
    addLog('状态: stopped');
    addLog('会话已停止');
  }, [addLog]);

  // ============ 模拟音频捕获（每30秒生成一个节点）============

  useEffect(() => {
    if (sessionState !== 'capturing') return;

    const generateNode = () => {
      const elapsedMs = Date.now() - sessionStartTimeRef.current;
      const text =
        MOCK_TRANSCRIPTS[transcriptIndexRef.current % MOCK_TRANSCRIPTS.length];
      transcriptIndexRef.current++;

      const nodeType = NODE_TYPES[
        Math.floor(Math.random() * NODE_TYPES.length)
      ] as NodeType;
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
                  ] as EdgeType,
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

  const isRunning = sessionState === 'capturing';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      {/* 顶部工具栏 */}
      <div
        style={{
          padding: '12px 20px',
          borderBottom: '1px solid #e5e7eb',
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          backgroundColor: '#f9fafb',
        }}
      >
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>
          Listen Graphic
        </h2>

        {/* 状态指示器 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              backgroundColor: isRunning ? '#10b981' : '#d1d5db',
            }}
          />
          <span style={{ fontSize: 12, color: '#6b7280' }}>
            {isRunning ? '运行中' : '空闲'}
          </span>
        </div>

        {/* 开始/停止按钮 */}
        <button
          onClick={isRunning ? handleStop : handleStart}
          style={{
            padding: '6px 16px',
            borderRadius: 6,
            border: 'none',
            backgroundColor: isRunning ? '#ef4444' : '#3b82f6',
            color: 'white',
            cursor: 'pointer',
            fontWeight: 600,
            fontSize: 13,
          }}
        >
          {isRunning ? '停止' : '开始'}
        </button>

        {/* 视图切换 */}
        <div style={{ display: 'flex', gap: 8, marginLeft: 24 }}>
          {VIEW_TYPES.map((view) => (
            <button
              key={view}
              onClick={() => setCurrentView(view)}
              style={{
                padding: '4px 10px',
                borderRadius: 4,
                border:
                  currentView === view
                    ? '2px solid #3b82f6'
                    : '1px solid #d1d5db',
                backgroundColor: currentView === view ? '#eff6ff' : 'white',
                color: currentView === view ? '#1d4ed8' : '#374151',
                cursor: 'pointer',
                fontSize: 12,
              }}
            >
              {VIEW_LABELS[view]}
            </button>
          ))}
        </div>

        {/* 时间显示 */}
        <div
          style={{
            marginLeft: 'auto',
            fontFamily: 'monospace',
            fontSize: 14,
            color: '#374151',
          }}
        >
          当前时间: {formatTime(currentTimeMs)}
        </div>
      </div>

      {/* 主内容区 */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* 图表区域 */}
        <div style={{ flex: 1 }}>
          <ReactFlow
            nodes={layoutNodes}
            edges={layoutEdges}
            nodeTypes={nodeTypes}
            onNodeClick={handleNodeClick}
            fitView
            minZoom={0.3}
            maxZoom={2}
          >
            <Background />
            <Controls />
          </ReactFlow>
        </div>

        {/* 右侧日志面板 */}
        <div
          style={{
            width: 300,
            borderLeft: '1px solid #e5e7eb',
            display: 'flex',
            flexDirection: 'column',
            backgroundColor: '#1e1e1e',
          }}
        >
          <div
            style={{
              padding: '8px 12px',
              borderBottom: '1px solid #333',
              color: '#10b981',
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            日志 ({logs.length})
          </div>
          <div
            style={{
              flex: 1,
              overflowY: 'auto',
              padding: '8px 12px',
              fontFamily: 'monospace',
              fontSize: 11,
              color: '#10b981',
            }}
          >
            {logs.length === 0 ? (
              <div style={{ color: '#666' }}>点击"开始"启动会话...</div>
            ) : (
              logs.map((log, i) => (
                <div
                  key={i}
                  style={{ marginBottom: 4, wordBreak: 'break-all' }}
                >
                  {log}
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* 底部状态栏 */}
      <div
        style={{
          padding: '8px 20px',
          borderTop: '1px solid #e5e7eb',
          backgroundColor: '#f9fafb',
          fontSize: 12,
          color: '#6b7280',
          display: 'flex',
          justifyContent: 'space-between',
        }}
      >
        <span>会话: {sessionId || '无'}</span>
        <span>
          节点: {graph.nodes.length} | 边: {graph.edges.length}
        </span>
      </div>
    </div>
  );
}
