import { describe, it, expect } from 'vitest';
import type { EdgeType, MergedGraph, ViewType } from '@listen-graphic/schema';
import {
  toHierarchyRendererGraph,
  type RendererGraph,
} from '@listen-graphic/graph-renderers';
import {
  buildStableReactFlowDebugGraph,
  resolveEdgeHandles,
  STABLE_LAYOUT_CARD_HEIGHT,
  STABLE_LAYOUT_CARD_WIDTH,
} from './graph-utils';
import type { StableViewLayoutState } from './types';

describe('resolveEdgeHandles', () => {
  it('正上→正下：bottom→top', () => {
    expect(
      resolveEdgeHandles({ x: 60, y: 0 }, { x: 60, y: 200 }),
    ).toEqual({
      sourceHandle: 'source-bottom',
      targetHandle: 'target-top',
    });
  });

  it('正下→正上：选择最顺的可见组合', () => {
    const result = resolveEdgeHandles({ x: 60, y: 240 }, { x: 60, y: 0 });
    expect(result.sourceHandle).not.toBe('source-top');
    expect(result.sourceHandle).not.toBe('source-left');
    expect(result.targetHandle).not.toBe('target-bottom');
    expect(result.targetHandle).not.toBe('target-right');
  });

  it('正左→正右：right→left', () => {
    expect(
      resolveEdgeHandles({ x: 60, y: 0 }, { x: 420, y: 10 }),
    ).toEqual({
      sourceHandle: 'source-right',
      targetHandle: 'target-left',
    });
  });

  it('正右→正左：选择最顺的可见组合', () => {
    const result = resolveEdgeHandles({ x: 420, y: 0 }, { x: 60, y: 10 });
    expect(result.sourceHandle).not.toBe('source-top');
    expect(result.sourceHandle).not.toBe('source-left');
    expect(result.targetHandle).not.toBe('target-bottom');
    expect(result.targetHandle).not.toBe('target-right');
  });

  it('右下→左上（反向 edge）：bottom→top', () => {
    expect(
      resolveEdgeHandles({ x: 340, y: 0 }, { x: 60, y: 200 }),
    ).toEqual({
      sourceHandle: 'source-bottom',
      targetHandle: 'target-top',
    });
  });

  it('左下→右上（反向 edge）：right→left', () => {
    expect(
      resolveEdgeHandles({ x: 60, y: 200 }, { x: 340, y: 0 }),
    ).toEqual({
      sourceHandle: 'source-right',
      targetHandle: 'target-left',
    });
  });

  it('分支→主节点：bottom→top', () => {
    expect(
      resolveEdgeHandles({ x: 340, y: 100 }, { x: 60, y: 300 }),
    ).toEqual({
      sourceHandle: 'source-bottom',
      targetHandle: 'target-top',
    });
  });

  it('对角线死区：选择最顺的组合，不使用隐藏 handle', () => {
    const result = resolveEdgeHandles({ x: 60, y: 0 }, { x: 240, y: 180 });
    expect(
      result.sourceHandle === 'source-bottom' || result.sourceHandle === 'source-right',
    ).toBe(true);
    expect(
      result.targetHandle === 'target-top' || result.targetHandle === 'target-left',
    ).toBe(true);
    expect(result.sourceHandle).not.toBe('source-top');
    expect(result.sourceHandle).not.toBe('source-left');
    expect(result.targetHandle).not.toBe('target-bottom');
    expect(result.targetHandle).not.toBe('target-right');
  });
});

import { VIEW_EDGE_PRIORITIES } from './constants';

describe('VIEW_EDGE_PRIORITIES', () => {
  it('causal 视图隐藏 follows 边', () => {
    expect(VIEW_EDGE_PRIORITIES.causal.follows).toBe('hidden');
  });

  it('causal 视图将 causes 设为 primary', () => {
    expect(VIEW_EDGE_PRIORITIES.causal.causes).toBe('primary');
  });

  it('hierarchy 视图隐藏 opposes 和 follows', () => {
    expect(VIEW_EDGE_PRIORITIES.hierarchy.opposes).toBe('hidden');
    expect(VIEW_EDGE_PRIORITIES.hierarchy.follows).toBe('hidden');
  });

  it('comparison 视图隐藏 follows 和 example_of', () => {
    expect(VIEW_EDGE_PRIORITIES.comparison.follows).toBe('hidden');
    expect(VIEW_EDGE_PRIORITIES.comparison.example_of).toBe('hidden');
  });

  it('每个视图的五种边类型都有定义', () => {
    const edgeTypes: EdgeType[] = ['supports', 'opposes', 'causes', 'follows', 'example_of'];
    const views: ViewType[] = ['causal', 'timeline', 'comparison', 'hierarchy'];
    for (const view of views) {
      for (const et of edgeTypes) {
        expect(VIEW_EDGE_PRIORITIES[view][et]).toBeDefined();
      }
    }
  });
});

function makeGraph(nodes: MergedGraph['nodes'], edges: MergedGraph['edges']): MergedGraph {
  return {
    sessionId: 'semantic-layout-test',
    revision: 1,
    topics: [],
    nodes,
    edges,
    viewHints: {
      defaultView: 'hierarchy',
      scores: { hierarchy: 5 },
    },
    updatedAt: 1000,
  };
}

function expectNoOverlaps(nodes: ReturnType<typeof buildStableReactFlowDebugGraph>['reactFlow']['nodes']) {
  for (let leftIndex = 0; leftIndex < nodes.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < nodes.length; rightIndex += 1) {
      const left = nodes[leftIndex].position;
      const right = nodes[rightIndex].position;
      const overlaps = !(
        left.x + STABLE_LAYOUT_CARD_WIDTH <= right.x ||
        right.x + STABLE_LAYOUT_CARD_WIDTH <= left.x ||
        left.y + STABLE_LAYOUT_CARD_HEIGHT <= right.y ||
        right.y + STABLE_LAYOUT_CARD_HEIGHT <= left.y
      );
      expect(overlaps).toBe(false);
    }
  }
}

type SemanticLayoutResult = {
  rendererGraph: RendererGraph;
  reactFlow: ReturnType<typeof buildStableReactFlowDebugGraph>['reactFlow'];
  positions: Record<string, { x: number; y: number }>;
};

function layoutHierarchy(graph: MergedGraph): SemanticLayoutResult {
  const rendererGraph = toHierarchyRendererGraph(graph);
  const result = buildStableReactFlowDebugGraph({
    rendererGraph,
    view: 'hierarchy',
    currentTimeMs: 0,
    selectedNodeId: null,
    previousLayoutState: { positions: {} },
  });

  return {
    rendererGraph,
    reactFlow: result.reactFlow,
    positions: Object.fromEntries(
      result.reactFlow.nodes.map((node) => [node.id, node.position]),
    ),
  };
}

function expectVisibleHandles(
  edges: ReturnType<typeof buildStableReactFlowDebugGraph>['reactFlow']['edges'],
) {
  for (const edge of edges) {
    expect(edge.sourceHandle).toBeTruthy();
    expect(edge.targetHandle).toBeTruthy();
    expect(edge.sourceHandle).not.toMatch(/top|left/);
    expect(edge.targetHandle).not.toMatch(/bottom|right/);
  }
}

function expectSameLane(positions: Record<string, { x: number; y: number }>, ids: string[]) {
  const [firstId, ...restIds] = ids;
  for (const id of restIds) {
    expect(positions[id].x).toBe(positions[firstId].x);
  }
}

function expectYOrder(positions: Record<string, { x: number; y: number }>, ids: string[]) {
  for (let index = 1; index < ids.length; index += 1) {
    expect(positions[ids[index - 1]].y).toBeLessThan(positions[ids[index]].y);
  }
}

describe('semantic hierarchy layout grammar', () => {
  it('识别五个核心语义图形模式', () => {
    const cases: Array<{
      name: string;
      graph: MergedGraph;
      pattern: NonNullable<
        ReturnType<typeof toHierarchyRendererGraph>['layoutHints']
      >['semanticPattern'];
    }> = [
      {
        name: 'question branches',
        pattern: 'question-branches',
        graph: makeGraph(
          [
            { id: 'q', type: 'question', text: '为什么？', timestampMs: 0, status: 'confirmed' },
            { id: 'a', type: 'claim', text: '原因一', timestampMs: 1, status: 'confirmed' },
            { id: 'b', type: 'claim', text: '原因二', timestampMs: 2, status: 'confirmed' },
          ],
          [
            { id: 'e1', source: 'q', target: 'a', type: 'supports' },
            { id: 'e2', source: 'q', target: 'b', type: 'supports' },
          ],
        ),
      },
      {
        name: 'claim reason example',
        pattern: 'claim-reason-example',
        graph: makeGraph(
          [
            { id: 'c', type: 'claim', text: '观点', timestampMs: 0, status: 'confirmed' },
            { id: 'r', type: 'reason', text: '理由', timestampMs: 1, status: 'confirmed' },
            { id: 'x', type: 'example', text: '例子', timestampMs: 2, status: 'confirmed' },
          ],
          [
            { id: 'e1', source: 'c', target: 'r', type: 'supports' },
            { id: 'e2', source: 'r', target: 'x', type: 'supports' },
          ],
        ),
      },
      {
        name: 'opposition',
        pattern: 'opposition',
        graph: makeGraph(
          [
            { id: 'a', type: 'claim', text: 'A', timestampMs: 0, status: 'confirmed' },
            { id: 'b', type: 'claim', text: 'B', timestampMs: 1, status: 'confirmed' },
          ],
          [{ id: 'e1', source: 'a', target: 'b', type: 'opposes' }],
        ),
      },
      {
        name: 'causal chain',
        pattern: 'causal-chain',
        graph: makeGraph(
          [
            { id: 'a', type: 'claim', text: 'A', timestampMs: 0, status: 'confirmed' },
            { id: 'b', type: 'claim', text: 'B', timestampMs: 1, status: 'confirmed' },
            { id: 'c', type: 'claim', text: 'C', timestampMs: 2, status: 'confirmed' },
          ],
          [
            { id: 'e1', source: 'a', target: 'b', type: 'causes' },
            { id: 'e2', source: 'b', target: 'c', type: 'causes' },
          ],
        ),
      },
      {
        name: 'timeline note',
        pattern: 'timeline-note',
        graph: makeGraph(
          [
            { id: 'a', type: 'claim', text: '先 A', timestampMs: 0, status: 'confirmed' },
            { id: 'b', type: 'claim', text: '再 B', timestampMs: 1, status: 'confirmed' },
            { id: 'n', type: 'example', text: '补充', timestampMs: 2, status: 'confirmed' },
          ],
          [
            { id: 'e1', source: 'a', target: 'b', type: 'follows' },
            { id: 'e2', source: 'b', target: 'n', type: 'supports' },
          ],
        ),
      },
    ];

    for (const item of cases) {
      expect(toHierarchyRendererGraph(item.graph).layoutHints?.semanticPattern, item.name).toBe(
        item.pattern,
      );
    }
  });

  it('问题分三点：question 是主节点，三个 claim 在同一分支车道展开', () => {
    const graph = makeGraph(
      [
        {
          id: 'q1',
          type: 'question',
          text: '这个产品现在有哪些问题？',
          timestampMs: 0,
          status: 'confirmed',
        },
        {
          id: 'p1',
          type: 'claim',
          text: '启动太慢',
          timestampMs: 1000,
          status: 'confirmed',
        },
        {
          id: 'p2',
          type: 'claim',
          text: '图谱太乱',
          timestampMs: 2000,
          status: 'confirmed',
        },
        {
          id: 'p3',
          type: 'claim',
          text: '设置复杂',
          timestampMs: 3000,
          status: 'confirmed',
        },
      ],
      [
        { id: 'e1', source: 'q1', target: 'p1', type: 'supports' },
        { id: 'e2', source: 'q1', target: 'p2', type: 'supports' },
        { id: 'e3', source: 'q1', target: 'p3', type: 'supports' },
      ],
    );

    const { rendererGraph, reactFlow, positions } = layoutHierarchy(graph);
    expect(rendererGraph.layoutHints?.semanticPattern).toBe('question-branches');
    expect(rendererGraph.nodes.map((node) => [node.id, node.layoutRole])).toEqual([
      ['q1', 'root'],
      ['p1', 'branch'],
      ['p2', 'branch'],
      ['p3', 'branch'],
    ]);

    expect(positions.q1.x).toBeLessThan(positions.p1.x);
    expectSameLane(positions, ['p1', 'p2', 'p3']);
    expectYOrder(positions, ['p1', 'p2', 'p3']);
    expectNoOverlaps(reactFlow.nodes);
    expectVisibleHandles(reactFlow.edges);
  });

  it('question-branches：分支从锚点顶部开始垂直分组排列', () => {
    const graph = makeGraph(
      [
        {
          id: 'q1',
          type: 'question',
          text: '三个问题？',
          timestampMs: 0,
          status: 'confirmed',
        },
        {
          id: 'p1',
          type: 'claim',
          text: '问题一',
          timestampMs: 1000,
          status: 'confirmed',
        },
        {
          id: 'p2',
          type: 'claim',
          text: '问题二',
          timestampMs: 2000,
          status: 'confirmed',
        },
        {
          id: 'p3',
          type: 'claim',
          text: '问题三',
          timestampMs: 3000,
          status: 'confirmed',
        },
      ],
      [
        { id: 'e1', source: 'q1', target: 'p1', type: 'supports' },
        { id: 'e2', source: 'q1', target: 'p2', type: 'supports' },
        { id: 'e3', source: 'q1', target: 'p3', type: 'supports' },
      ],
    );

    const { reactFlow, positions } = layoutHierarchy(graph);
    expectNoOverlaps(reactFlow.nodes);

    // 所有分支在同一 x 列
    expectSameLane(positions, ['p1', 'p2', 'p3']);

    // 第一个分支顶部与锚点顶部对齐
    expect(positions.p1.y).toBe(positions.q1.y);

    // 分支按顺序向下排列，间距 = CARD_HEIGHT + COLLISION_GAP = 156
    expect(positions.p2.y).toBe(positions.p1.y + 156);
    expect(positions.p3.y).toBe(positions.p2.y + 156);
  });

  it('观点-理由-例子：claim 是主节点，reason 和 example 形成右侧支撑链', () => {
    const graph = makeGraph(
      [
        {
          id: 'c1',
          type: 'claim',
          text: '定价页应该先讲清楚价值',
          timestampMs: 0,
          status: 'confirmed',
        },
        {
          id: 'r1',
          type: 'reason',
          text: '用户先判断是否值得继续了解',
          timestampMs: 1000,
          status: 'confirmed',
        },
        {
          id: 'x1',
          type: 'example',
          text: '例如把用例收益放在套餐表之前',
          timestampMs: 2000,
          status: 'confirmed',
        },
      ],
      [
        { id: 'e1', source: 'c1', target: 'r1', type: 'supports' },
        { id: 'e2', source: 'r1', target: 'x1', type: 'example_of' },
      ],
    );

    const { rendererGraph, reactFlow, positions } = layoutHierarchy(graph);
    expect(rendererGraph.layoutHints?.semanticPattern).toBe('claim-reason-example');
    expect(rendererGraph.nodes.map((node) => [node.id, node.layoutRole])).toEqual([
      ['c1', 'root'],
      ['r1', 'branch'],
      ['x1', 'support'],
    ]);

    expect(positions.c1.x).toBeLessThan(positions.r1.x);
    expect(positions.r1.x).toBeLessThan(positions.x1.x);
    expectYOrder(positions, ['c1', 'r1', 'x1']);
    expectNoOverlaps(reactFlow.nodes);
    expectVisibleHandles(reactFlow.edges);
  });

  it('A 反对 B：opposes 边在语义 opposition 下可见，反对方作为主节点展开', () => {
    const graph = makeGraph(
      [
        {
          id: 'a1',
          type: 'claim',
          text: '应该继续打磨视觉细节',
          timestampMs: 0,
          status: 'confirmed',
        },
        {
          id: 'b1',
          type: 'claim',
          text: '现在更应该先补图形语法',
          timestampMs: 1000,
          status: 'confirmed',
        },
        {
          id: 'r1',
          type: 'reason',
          text: '没有稳定表达模式时，视觉 polish 不能解决可读性',
          timestampMs: 2000,
          status: 'confirmed',
        },
      ],
      [
        { id: 'e1', source: 'b1', target: 'a1', type: 'opposes' },
        { id: 'e2', source: 'b1', target: 'r1', type: 'supports' },
      ],
    );

    const { rendererGraph, reactFlow, positions } = layoutHierarchy(graph);
    expect(rendererGraph.layoutHints?.semanticPattern).toBe('opposition');
    expect(rendererGraph.nodes.map((node) => [node.id, node.layoutRole])).toEqual([
      ['b1', 'root'],
      ['a1', 'branch'],
      ['r1', undefined],
    ]);

    expect(positions.b1.x).toBeLessThan(positions.a1.x);
    expect(positions.b1.x).toBeLessThan(positions.r1.x);
    expectSameLane(positions, ['a1', 'r1']);
    expectYOrder(positions, ['a1', 'r1']);
    expect(reactFlow.edges.map((edge) => [edge.id, edge.label])).toEqual([
      ['e1', 'opposes'],
      ['e2', 'supports'],
    ]);
    expectNoOverlaps(reactFlow.nodes);
    expectVisibleHandles(reactFlow.edges);
  });

  it('因果链：每个后续节点沿链式方向递进，不退回主干或重叠', () => {
    const graph = makeGraph(
      [
        {
          id: 'c1',
          type: 'claim',
          text: '启动时一次性加载太多模块',
          timestampMs: 0,
          status: 'confirmed',
        },
        {
          id: 'c2',
          type: 'claim',
          text: '首屏渲染被阻塞',
          timestampMs: 1000,
          status: 'confirmed',
        },
        {
          id: 'c3',
          type: 'claim',
          text: '用户觉得应用很慢',
          timestampMs: 2000,
          status: 'confirmed',
        },
        {
          id: 'c4',
          type: 'conclusion',
          text: '需要拆分启动路径',
          timestampMs: 3000,
          status: 'confirmed',
        },
      ],
      [
        { id: 'e1', source: 'c1', target: 'c2', type: 'causes' },
        { id: 'e2', source: 'c2', target: 'c3', type: 'causes' },
        { id: 'e3', source: 'c3', target: 'c4', type: 'causes' },
      ],
    );

    const { rendererGraph, reactFlow, positions } = layoutHierarchy(graph);
    expect(rendererGraph.layoutHints?.semanticPattern).toBe('causal-chain');
    expect(rendererGraph.layoutHints?.chainNodeIds).toEqual(['c1', 'c2', 'c3', 'c4']);
    expect(rendererGraph.nodes.map((node) => [node.id, node.layoutRole])).toEqual([
      ['c1', 'root'],
      ['c2', 'chain'],
      ['c3', 'chain'],
      ['c4', 'chain'],
    ]);

    expect(positions.c1.x).toBeLessThan(positions.c2.x);
    expect(positions.c2.x).toBeLessThan(positions.c3.x);
    expect(positions.c3.x).toBeLessThan(positions.c4.x);
    expectYOrder(positions, ['c1', 'c2', 'c3', 'c4']);
    expectNoOverlaps(reactFlow.nodes);
    expectVisibleHandles(reactFlow.edges);
  });

  it('时间线补充说明：主链按 follows 顺序排列，补充说明挂在最后节点之后', () => {
    const graph = makeGraph(
      [
        {
          id: 't1',
          type: 'claim',
          text: '先完成核心布局规则',
          timestampMs: 0,
          status: 'confirmed',
        },
        {
          id: 't2',
          type: 'claim',
          text: '再补语义 fixture',
          timestampMs: 1000,
          status: 'confirmed',
        },
        {
          id: 't3',
          type: 'conclusion',
          text: '最后做视觉验收',
          timestampMs: 2000,
          status: 'confirmed',
        },
        {
          id: 'n1',
          type: 'example',
          text: '验收时重点看一眼是否读得懂',
          timestampMs: 2500,
          status: 'confirmed',
        },
      ],
      [
        { id: 'e1', source: 't1', target: 't2', type: 'follows' },
        { id: 'e2', source: 't2', target: 't3', type: 'follows' },
        { id: 'e3', source: 't3', target: 'n1', type: 'supports' },
      ],
    );

    const { rendererGraph, reactFlow, positions } = layoutHierarchy(graph);
    expect(rendererGraph.layoutHints?.semanticPattern).toBe('timeline-note');
    expect(rendererGraph.layoutHints?.chainNodeIds).toEqual(['t1', 't2', 't3']);
    expect(rendererGraph.nodes.map((node) => [node.id, node.layoutRole])).toEqual([
      ['t1', 'root'],
      ['t2', 'chain'],
      ['t3', 'chain'],
      ['n1', 'support'],
    ]);

    expect(positions.t1.x).toBeLessThan(positions.t2.x);
    expect(positions.t2.x).toBeLessThan(positions.t3.x);
    expect(positions.t3.x).toBeLessThan(positions.n1.x);
    expectYOrder(positions, ['t1', 't2', 't3', 'n1']);
    expectNoOverlaps(reactFlow.nodes);
    expectVisibleHandles(reactFlow.edges);
  });

  function layoutHierarchyIncremental(
    graphs: MergedGraph[],
  ): Array<SemanticLayoutResult & { layoutState: StableViewLayoutState }> {
    const results: Array<SemanticLayoutResult & { layoutState: StableViewLayoutState }> = [];
    let previousLayoutState: StableViewLayoutState = { positions: {} };

    for (const graph of graphs) {
      const rendererGraph = toHierarchyRendererGraph(graph);
      const result = buildStableReactFlowDebugGraph({
        rendererGraph,
        view: 'hierarchy',
        currentTimeMs: 0,
        selectedNodeId: null,
        previousLayoutState,
      });

      const entry: SemanticLayoutResult & { layoutState: StableViewLayoutState } = {
        rendererGraph,
        reactFlow: result.reactFlow,
        positions: Object.fromEntries(
          result.reactFlow.nodes.map((node) => [node.id, node.position]),
        ),
        layoutState: result.layoutState,
      };
      results.push(entry);
      previousLayoutState = result.layoutState;
    }
    return results;
  }

  it('question-branches：增量到达时整个分支组 reflown 重排', () => {
    // rev1: q1 + p1 + p2
    const rev1 = makeGraph(
      [
        { id: 'q1', type: 'question', text: '问题？', timestampMs: 0, status: 'confirmed' },
        { id: 'p1', type: 'claim', text: '分点一', timestampMs: 1000, status: 'confirmed' },
        { id: 'p2', type: 'claim', text: '分点二', timestampMs: 2000, status: 'confirmed' },
      ],
      [
        { id: 'e1', source: 'q1', target: 'p1', type: 'supports' },
        { id: 'e2', source: 'q1', target: 'p2', type: 'supports' },
      ],
    );

    // rev2: q1 + p1 + p2 + p3（新增 p3）
    const rev2 = makeGraph(
      [
        { id: 'q1', type: 'question', text: '问题？', timestampMs: 0, status: 'confirmed' },
        { id: 'p1', type: 'claim', text: '分点一', timestampMs: 1000, status: 'confirmed' },
        { id: 'p2', type: 'claim', text: '分点二', timestampMs: 2000, status: 'confirmed' },
        { id: 'p3', type: 'claim', text: '分点三', timestampMs: 3000, status: 'confirmed' },
      ],
      [
        { id: 'e1', source: 'q1', target: 'p1', type: 'supports' },
        { id: 'e2', source: 'q1', target: 'p2', type: 'supports' },
        { id: 'e3', source: 'q1', target: 'p3', type: 'supports' },
      ],
    );

    const [step1, step2] = layoutHierarchyIncremental([rev1, rev2]);

    // rev1: 2 分支
    expect(step1.positions.p1.y).toBe(step1.positions.q1.y);
    expect(step1.positions.p2.y).toBe(step1.positions.q1.y + 156);

    // rev2: 3 分支，所有分支 reflown
    expect(step2.positions.p1.y).toBe(step2.positions.q1.y);
    expect(step2.positions.p2.y).toBe(step2.positions.q1.y + 156);
    expect(step2.positions.p3.y).toBe(step2.positions.q1.y + 312);

    // rev2 中 p1/p2 位置与 rev1 一致（顶部对齐策略天然稳定）
    expect(step2.positions.p1.y).toBe(step1.positions.p1.y);
    expect(step2.positions.p2.y).toBe(step1.positions.p2.y);

    // 所有边使用 source-right → target-left
    for (const edge of step2.reactFlow.edges) {
      expect(edge.sourceHandle).toBe('source-right');
      expect(edge.targetHandle).toBe('target-left');
    }

    expectNoOverlaps(step2.reactFlow.nodes);
  });

  it('question-branches：5 个分支全部使用 source-right → target-left', () => {
    const nodes: MergedGraph['nodes'] = [
      {
        id: 'q1',
        type: 'question',
        text: '五个问题？',
        timestampMs: 0,
        status: 'confirmed',
      },
    ];
    const edges: MergedGraph['edges'] = [];
    for (let i = 1; i <= 5; i += 1) {
      nodes.push({
        id: `p${i}`,
        type: 'claim',
        text: `问题 ${i}`,
        timestampMs: i * 1000,
        status: 'confirmed',
      });
      edges.push({ id: `e${i}`, source: 'q1', target: `p${i}`, type: 'supports' });
    }

    const graph = makeGraph(nodes, edges);
    const { reactFlow } = layoutHierarchy(graph);
    expectNoOverlaps(reactFlow.nodes);

    for (const edge of reactFlow.edges) {
      expect(edge.sourceHandle).toBe('source-right');
      expect(edge.targetHandle).toBe('target-left');
    }
  });
});
