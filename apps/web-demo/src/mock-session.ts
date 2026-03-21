import type { MergedGraph } from '@listen-graphic/schema';

// 更丰富的 mock 数据：展示因果、对比、时间线等多种关系
export const mockMergedGraph: MergedGraph = {
  sessionId: 'demo-session',
  revision: 3,
  topics: [
    {
      topicId: 't1',
      title: 'AI 创业的挑战',
      startMs: 0,
      endMs: 180000,
    },
    {
      topicId: 't2',
      title: '如何找到差异化',
      startMs: 180000,
      endMs: 300000,
    },
  ],
  nodes: [
    // 话题1: AI 创业的挑战
    {
      id: 'n1',
      type: 'claim',
      text: '大模型公司很难靠 API 获得稳定利润',
      speaker: '主持人',
      timestampMs: 5000,
      status: 'confirmed',
      confidence: 0.92,
    },
    {
      id: 'n2',
      type: 'reason',
      text: '推理成本高，价格竞争激烈',
      speaker: '嘉宾A',
      timestampMs: 15000,
      status: 'confirmed',
      confidence: 0.88,
    },
    {
      id: 'n3',
      type: 'reason',
      text: '开源模型追赶速度快',
      speaker: '嘉宾A',
      timestampMs: 28000,
      status: 'confirmed',
      confidence: 0.85,
    },
    {
      id: 'n4',
      type: 'example',
      text: '某头部公司毛利率不到 30%',
      speaker: '嘉宾B',
      timestampMs: 45000,
      status: 'confirmed',
      confidence: 0.82,
    },
    {
      id: 'n5',
      type: 'claim',
      text: '纯 API 模式是死路',
      speaker: '嘉宾B',
      timestampMs: 60000,
      status: 'draft',
      confidence: 0.75,
    },
    {
      id: 'n6',
      type: 'question',
      text: '那什么样的 AI 公司能赚钱？',
      speaker: '主持人',
      timestampMs: 80000,
      status: 'confirmed',
      confidence: 0.9,
    },
    // 话题2: 如何找到差异化
    {
      id: 'n7',
      type: 'claim',
      text: '需要做垂直场景深度整合',
      speaker: '嘉宾A',
      timestampMs: 185000,
      status: 'confirmed',
      confidence: 0.87,
    },
    {
      id: 'n8',
      type: 'reason',
      text: '通用能力无法形成壁垒',
      speaker: '嘉宾A',
      timestampMs: 195000,
      status: 'confirmed',
      confidence: 0.86,
    },
    {
      id: 'n9',
      type: 'example',
      text: '法律 AI 比通用对话更赚钱',
      speaker: '嘉宾B',
      timestampMs: 210000,
      status: 'confirmed',
      confidence: 0.84,
    },
    {
      id: 'n10',
      type: 'conclusion',
      text: 'AI 创业必须找场景，不能只做模型',
      speaker: '主持人',
      timestampMs: 250000,
      status: 'confirmed',
      confidence: 0.91,
    },
  ],
  edges: [
    // 因果/支持关系
    { id: 'e1', source: 'n2', target: 'n1', type: 'supports', confidence: 0.88 },
    { id: 'e2', source: 'n3', target: 'n1', type: 'supports', confidence: 0.85 },
    { id: 'e3', source: 'n4', target: 'n2', type: 'example_of', confidence: 0.82 },
    { id: 'e4', source: 'n1', target: 'n5', type: 'causes', confidence: 0.78 },
    { id: 'e5', source: 'n5', target: 'n6', type: 'follows', confidence: 0.8 },
    
    // 时间线关系
    { id: 'e6', source: 'n6', target: 'n7', type: 'follows', confidence: 0.85 },
    { id: 'e7', source: 'n7', target: 'n8', type: 'supports', confidence: 0.86 },
    { id: 'e8', source: 'n9', target: 'n7', type: 'supports', confidence: 0.84 },
    { id: 'e9', source: 'n7', target: 'n10', type: 'causes', confidence: 0.87 },
    
    // 对比关系
    { id: 'e10', source: 'n5', target: 'n7', type: 'opposes', confidence: 0.72 },
  ],
  updatedAt: Date.now(),
};
