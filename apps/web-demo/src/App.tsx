import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  type Node,
  type Edge,
} from 'reactflow';
import type { NodeProps } from 'reactflow';
import 'reactflow/dist/style.css';
import '@listen-graphic/ui/styles/theme.css';

import type {
  MergedGraph,
  GraphNode,
  GraphEdge,
  EdgeType,
  NodeType,
} from '@listen-graphic/schema';
import { pickDefaultView, scoreViews } from '@listen-graphic/domain';
import {
  GraphNodeCard,
  formatGraphNodeTime,
  EmptyState,
  useTheme,
  type GraphNodeCardData,
} from '@listen-graphic/ui';
import { useGraphFixtureSequence } from './useGraphFixtureSequence';
import {
  toCausalRendererGraph,
  toTimelineRendererGraph,
  toComparisonRendererGraph,
  toHierarchyRendererGraph,
} from '@listen-graphic/graph-renderers';

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

function WebDemoGraphNodeCard(props: NodeProps<GraphNodeCardData>) {
  return <GraphNodeCard {...props} handleMode="simple" />;
}

const nodeTypes = { graphNode: WebDemoGraphNodeCard };

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
          ? 'var(--lg-success)'
          : e.relation === 'opposes'
            ? 'var(--lg-danger)'
            : e.relation === 'causes'
              ? 'var(--lg-insight)'
              : 'var(--lg-muted)',
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
  const fixtureSeq = useGraphFixtureSequence();
  const [sessionState, setSessionState] = useState<SessionState>('idle');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [currentView, setCurrentView] = useState<string>('causal');
  const [currentTimeMs, setCurrentTimeMs] = useState(0);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [graph, setGraph] = useState<MergedGraph>(createEmptyGraph);
  const [logs, setLogs] = useState<string[]>([]);

  const { theme, toggleTheme } = useTheme();

  const displayGraph =
    fixtureSeq.active && fixtureSeq.graph ? fixtureSeq.graph : graph;
  const isFixturePreview = fixtureSeq.active;

  // 用于生成唯一 ID 和随机选择
  const transcriptIndexRef = useRef(0);
  const sessionStartTimeRef = useRef(0);

  const addLog = useCallback((msg: string) => {
    const time = new Date().toLocaleTimeString();
    setLogs((prev) => [`[${time}] ${msg}`, ...prev.slice(0, 49)]);
  }, []);

  useEffect(() => {
    if (!fixtureSeq.active || !fixtureSeq.graph) return;
    setCurrentView(pickDefaultView(fixtureSeq.graph));
  }, [fixtureSeq.active, fixtureSeq.graph, fixtureSeq.stepIndex]);

  useEffect(() => {
    if (!fixtureSeq.active || !fixtureSeq.graph || !fixtureSeq.sequenceId) return;
    const stepGraph = fixtureSeq.graph;
    addLog(
      `[fixture] ${fixtureSeq.sequenceId} ${fixtureSeq.stepIndex + 1}/${fixtureSeq.total} | rev=${stepGraph.revision} | nodes=${stepGraph.nodes.length}`,
    );
  }, [
    fixtureSeq.active,
    fixtureSeq.sequenceId,
    fixtureSeq.stepIndex,
    fixtureSeq.total,
    fixtureSeq.graph,
    addLog,
  ]);

  // 计算视图分数
  const viewScores = useMemo(() => scoreViews(displayGraph), [displayGraph]);

  // 处理节点点击
  const handleNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    setCurrentTimeMs(node.data.timestampMs as number);
    setSelectedNodeId(node.id);
  }, []);

  // 处理时间按钮点击
  const handleTimeClick = useCallback(
    (ms: number) => {
      setCurrentTimeMs(ms);
      const nearestNode = displayGraph.nodes.reduce((prev, curr) =>
        Math.abs(curr.timestampMs - ms) < Math.abs(prev.timestampMs - ms)
          ? curr
          : prev,
      );
      setSelectedNodeId(nearestNode.id);
    },
    [displayGraph.nodes],
  );

  // 生成布局节点
  const { nodes: layoutNodes, edges: layoutEdges } = useMemo(() => {
    return getLayoutedElements(
      currentView,
      displayGraph,
      currentTimeMs,
      selectedNodeId,
      handleTimeClick,
    );
  }, [currentView, displayGraph, currentTimeMs, selectedNodeId, handleTimeClick]);

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
    if (isFixturePreview || sessionState !== 'capturing') return;

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
  }, [isFixturePreview, sessionState, addLog]);

  const isRunning = sessionState === 'capturing' && !isFixturePreview;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }} data-theme={theme}>
      {/* 顶部工具栏 */}
      <div className="lg-toolbar" style={{ gap: 16, backgroundColor: 'var(--lg-calm)' }}>
        <div className="lg-toolbar__brand">
          <h2 style={{ margin: 0, fontSize: 'var(--text-xl)', fontWeight: 600 }}>
            Listen Graphic
          </h2>
        </div>

        {fixtureSeq.sequenceId && (
          <span
            style={{
              fontSize: 'var(--text-sm)',
              color: fixtureSeq.error ? 'var(--lg-danger)' : 'var(--lg-muted)',
            }}
          >
            {fixtureSeq.error ??
              (fixtureSeq.active
                ? `sequence step ${fixtureSeq.stepIndex + 1}/${fixtureSeq.total}`
                : `sequence: ${fixtureSeq.sequenceId}`)}
          </span>
        )}

        {/* 状态指示器 */}
        <div className="lg-signal-indicator">
          <div
            className={`lg-signal-dot ${isRunning ? 'lg-signal-dot--active' : 'lg-signal-dot--idle'}`}
          />
          <span>{isRunning ? '运行中' : '空闲'}</span>
        </div>

        {/* 主题切换 */}
        <button
          className="lg-btn lg-btn-ghost lg-btn-sm"
          onClick={toggleTheme}
          title="切换主题"
        >
          {theme === 'dark' ? '☀️' : '🌙'}
        </button>

        {/* 开始/停止按钮 */}
        <button
          className={isRunning ? 'lg-btn lg-btn-danger' : 'lg-btn lg-btn-primary'}
          onClick={isRunning ? handleStop : handleStart}
          disabled={isFixturePreview}
        >
          {isRunning ? '停止' : '开始'}
        </button>

        {/* 视图切换 */}
        <div style={{ display: 'flex', gap: 8, marginLeft: 24 }}>
          {VIEW_TYPES.map((view) => (
            <button
              key={view}
              className={currentView === view ? 'lg-btn lg-btn-primary lg-btn-sm' : 'lg-btn lg-btn-ghost lg-btn-sm'}
              onClick={() => setCurrentView(view)}
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
            fontSize: 'var(--text-base)',
            color: 'var(--lg-ink)',
          }}
        >
          当前时间: {formatGraphNodeTime(currentTimeMs)}
        </div>
      </div>

      {/* 主内容区 */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* 图表区域 */}
        <div style={{ flex: 1 }}>
          {displayGraph.nodes.length === 0 && !isRunning && sessionState === 'idle' ? (
            <EmptyState />
          ) : (
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
          )}
        </div>

        {/* 右侧日志面板 */}
        <div
          style={{
            width: 300,
            borderLeft: '1px solid var(--lg-rim)',
            display: 'flex',
            flexDirection: 'column',
            backgroundColor: 'var(--lg-ink)',
          }}
        >
          <div
            style={{
              padding: '8px 12px',
              borderBottom: '1px solid var(--lg-rim)',
              color: 'var(--lg-success)',
              fontSize: 'var(--text-sm)',
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
              fontSize: 'var(--text-xs)',
              color: 'var(--lg-success)',
            }}
          >
            {logs.length === 0 ? (
              <div style={{ color: 'var(--lg-muted)' }}>点击"开始"启动会话...</div>
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
          borderTop: '1px solid var(--lg-rim)',
          backgroundColor: 'var(--lg-calm)',
          fontSize: 'var(--text-sm)',
          color: 'var(--lg-muted)',
          display: 'flex',
          justifyContent: 'space-between',
        }}
      >
        <span>会话: {sessionId || '无'}</span>
        <span>
          节点: {displayGraph.nodes.length} | 边: {displayGraph.edges.length}
        </span>
      </div>
    </div>
  );
}
