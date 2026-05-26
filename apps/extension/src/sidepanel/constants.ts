import type { EdgeType, NodeType, ViewType, MergedGraph } from '@listen-graphic/schema';
import type { EdgePriority } from './types';

// ===== 初始空 Graph =====

export function createEmptyGraph(): MergedGraph {
  return {
    sessionId: '',
    revision: 0,
    topics: [],
    nodes: [],
    edges: [],
    updatedAt: Date.now(),
  };
}

// ===== Mock 数据模板 =====

export const MOCK_TRANSCRIPTS = [
  '今天我们来聊聊 AI 创业的挑战。',
  '大模型公司很难靠 API 获得稳定利润。',
  '推理成本高，而且价格竞争非常激烈。',
  '开源模型的追赶速度比预期快很多。',
  '纯 API 模式可能是一条死路。',
  '那什么样的 AI 公司才能真正赚钱呢？',
  '关键是要做垂直场景的深度整合。',
  '通用能力很难形成真正的壁垒。',
];

export const NODE_TYPES: NodeType[] = [
  'claim',
  'reason',
  'example',
  'question',
  'conclusion',
];

export const EDGE_TYPES: EdgeType[] = [
  'supports',
  'opposes',
  'causes',
  'follows',
  'example_of',
];

export const SPEAKERS = ['主持人', '嘉宾A', '嘉宾B'];

export const ZHIPU_ENDPOINT_STANDARD = 'https://open.bigmodel.cn/api/paas/v4';
export const ZHIPU_ENDPOINT_CODING_PLAN = 'https://open.bigmodel.cn/api/coding/paas/v4';

// ===== 视图选择器 =====

export const VIEW_TYPES: ViewType[] = [
  'causal',
  'timeline',
  'comparison',
  'hierarchy',
];

// UI 中实际展示的视图。保持单一维度：选择什么视图，就使用该视图的边过滤与节点顺序。
export const VISIBLE_VIEW_TYPES = VIEW_TYPES;

export const VIEW_LABELS: Record<ViewType, string> = {
  causal: '因果',
  timeline: '时间线',
  comparison: '对比',
  hierarchy: '层级',
};

export const VIEW_EDGE_PRIORITIES: Record<ViewType, Record<EdgeType, EdgePriority>> = {
  causal: {
    causes: 'primary',
    supports: 'primary',
    opposes: 'secondary',
    example_of: 'secondary',
    follows: 'hidden',
  },
  comparison: {
    opposes: 'primary',
    supports: 'primary',
    causes: 'secondary',
    example_of: 'hidden',
    follows: 'hidden',
  },
  hierarchy: {
    example_of: 'primary',
    supports: 'primary',
    causes: 'secondary',
    opposes: 'hidden',
    follows: 'hidden',
  },
  timeline: {
    follows: 'primary',
    causes: 'primary',
    supports: 'secondary',
    opposes: 'secondary',
    example_of: 'secondary',
  },
};

// ===== 开发模式与 UI 常量 =====

export const isDevMode = false;
export const DEFAULT_LOG_PANEL_HEIGHT = 120;
export const MIN_LOG_PANEL_HEIGHT = 80;
export const MAX_LOG_PANEL_HEIGHT = 360;
export const MAX_TIMELINE_EVENTS = 60;
export const STRUCTURER_DELAYED_MS = 8000;
export const GRAPH_JUST_UPDATED_MS = 4000;

// ===== 自动揭示 =====

export const AUTO_REVEAL_PADDING = 48;
export const AUTO_REVEAL_DURATION_MS = 320;
export const AUTO_REVEAL_MIN_WIDTH_RATIO = 0.78;
export const AUTO_REVEAL_MIN_HEIGHT_RATIO = 0.68;
export const AUTO_REVEAL_VIEWPORT_EPSILON = 6;
export const AUTO_REVEAL_ZOOM_EPSILON = 0.02;
export const USER_VIEWPORT_COOLDOWN_MS = 1800;

// ===== 自动导览 =====

export const AUTO_TOUR_RESUME_DELAY_MS = 7000;
export const AUTO_TOUR_ABSOLUTE_READABLE_ZOOM = 0.9;
export const AUTO_TOUR_FIRST_BATCH_RELATIVE_RATIO = 0.8;
export const AUTO_TOUR_RELATIVE_READABLE_RATIO = 0.85;
export const AUTO_TOUR_BASE_DWELL_MS = 900;
export const AUTO_TOUR_CHAR_DWELL_MS = 40;
export const AUTO_TOUR_NODE_DWELL_MS = 220;
export const AUTO_TOUR_EDGE_DWELL_MS = 90;
export const AUTO_TOUR_MIN_DWELL_MS = 1800;
export const AUTO_TOUR_MAX_DWELL_MS = 5000;

