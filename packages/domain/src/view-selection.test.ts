import { describe, expect, it } from 'vitest';
import type { MergedGraph, GraphEdge, GraphNode } from '@listen-graphic/schema';
import { scoreViews, pickDefaultView } from './view-selection';

// ---------------------------------------------------------------------------
// 辅助函数：快速构造测试用 MergedGraph
// ---------------------------------------------------------------------------

function makeGraph(
  edges: Array<Pick<GraphEdge, 'id' | 'source' | 'target' | 'type'>>,
  speakers?: Record<string, string>, // nodeId -> speaker
): MergedGraph {
  const nodeIds = new Set<string>();
  for (const e of edges) {
    nodeIds.add(e.source);
    nodeIds.add(e.target);
  }
  const nodes: GraphNode[] = Array.from(nodeIds).map((id, i) => ({
    id,
    type: 'claim' as const,
    text: `node-${id}`,
    speaker: speakers?.[id],
    timestampMs: i * 1000,
    status: 'confirmed' as const,
  }));

  const fullEdges: GraphEdge[] = edges.map((e) => ({
    confidence: 1,
    ...e,
  }));

  return {
    sessionId: 'test-session',
    revision: 1,
    topics: [],
    nodes,
    edges: fullEdges,
    updatedAt: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// scoreViews
// ---------------------------------------------------------------------------

describe('scoreViews', () => {
  it('纯 follows 边：所有视图分数很低（<=1）', () => {
    const graph = makeGraph([
      { id: 'e1', source: 'a', target: 'b', type: 'follows' },
      { id: 'e2', source: 'b', target: 'c', type: 'follows' },
      { id: 'e3', source: 'c', target: 'd', type: 'follows' },
    ]);

    const scores = scoreViews(graph);

    // timeline 固定为 0，其余视图在纯 follows 下应为 0
    expect(scores.timeline).toBe(0);
    expect(scores.causal).toBeLessThanOrEqual(1);
    expect(scores.comparison).toBeLessThanOrEqual(1);
    expect(scores.hierarchy).toBeLessThanOrEqual(1);
  });

  it('有 causes 边：causal 分数 > comparison 和 hierarchy', () => {
    const graph = makeGraph([
      { id: 'e1', source: 'a', target: 'b', type: 'causes' },
      { id: 'e2', source: 'b', target: 'c', type: 'causes' },
      { id: 'e3', source: 'a', target: 'c', type: 'supports' },
    ]);

    const scores = scoreViews(graph);

    expect(scores.causal).toBeGreaterThan(scores.comparison);
    expect(scores.causal).toBeGreaterThan(scores.hierarchy);
  });

  it('有 opposes + 多 speaker：comparison 分数最高', () => {
    const graph = makeGraph(
      [
        { id: 'e1', source: 'a', target: 'b', type: 'opposes' },
        { id: 'e2', source: 'b', target: 'c', type: 'opposes' },
        { id: 'e3', source: 'c', target: 'a', type: 'follows' },
      ],
      { a: 'Alice', b: 'Bob', c: 'Alice' },
    );

    const scores = scoreViews(graph);

    expect(scores.comparison).toBeGreaterThan(scores.causal);
    expect(scores.comparison).toBeGreaterThan(scores.hierarchy);
    expect(scores.comparison).toBeGreaterThan(scores.timeline);
  });

  it('有 example_of：hierarchy 分数 > comparison', () => {
    const graph = makeGraph([
      { id: 'e1', source: 'a', target: 'b', type: 'example_of' },
      { id: 'e2', source: 'b', target: 'c', type: 'example_of' },
      { id: 'e3', source: 'a', target: 'c', type: 'supports' },
    ]);

    const scores = scoreViews(graph);

    expect(scores.hierarchy).toBeGreaterThan(scores.comparison);
  });

  it('多跳因果链：causal 分数 > 5', () => {
    // A → causes → B → causes → C → causes → D（三跳因果链）
    const graph = makeGraph([
      { id: 'e1', source: 'a', target: 'b', type: 'causes' },
      { id: 'e2', source: 'b', target: 'c', type: 'causes' },
      { id: 'e3', source: 'c', target: 'd', type: 'causes' },
    ]);

    const scores = scoreViews(graph);

    expect(scores.causal).toBeGreaterThan(5);
  });

  it('空边图不抛异常且所有分数 >= 0', () => {
    const graph: MergedGraph = {
      sessionId: 'test',
      revision: 1,
      topics: [],
      nodes: [{ id: 'a', type: 'claim', text: 'x', timestampMs: 0, status: 'confirmed' }],
      edges: [],
      updatedAt: Date.now(),
    };

    const scores = scoreViews(graph);

    for (const val of Object.values(scores)) {
      expect(val).toBeGreaterThanOrEqual(0);
    }
  });
});

// ---------------------------------------------------------------------------
// pickDefaultView
// ---------------------------------------------------------------------------

describe('pickDefaultView', () => {
  it('空图（无节点无边）返回 causal', () => {
    const graph: MergedGraph = {
      sessionId: 'test',
      revision: 1,
      topics: [],
      nodes: [],
      edges: [],
      updatedAt: Date.now(),
    };

    expect(pickDefaultView(graph)).toBe('causal');
  });

  it('有因果链返回 causal', () => {
    const graph = makeGraph([
      { id: 'e1', source: 'a', target: 'b', type: 'causes' },
      { id: 'e2', source: 'b', target: 'c', type: 'causes' },
    ]);

    expect(pickDefaultView(graph)).toBe('causal');
  });

  it('多 speaker + opposes 返回 comparison', () => {
    const graph = makeGraph(
      [
        { id: 'e1', source: 'a', target: 'b', type: 'opposes' },
        { id: 'e2', source: 'b', target: 'c', type: 'opposes' },
      ],
      { a: 'Alice', b: 'Bob', c: 'Charlie' },
    );

    expect(pickDefaultView(graph)).toBe('comparison');
  });

  it('纯 follows 返回 causal（兜底）', () => {
    const graph = makeGraph([
      { id: 'e1', source: 'a', target: 'b', type: 'follows' },
      { id: 'e2', source: 'b', target: 'c', type: 'follows' },
    ]);

    // 所有分数都很低，tie-break 应该返回 causal
    expect(pickDefaultView(graph)).toBe('causal');
  });
});
