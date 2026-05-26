import { describe, expect, it } from 'vitest';
import type { Edge, Node } from 'reactflow';

import {
  buildTwoStageAutoTourStages,
  getValidAutoTourAnchorNodeIds,
  hasVisibleAddedInternalEdge,
} from './auto-tour-utils';
import type { AutoTourSeed } from './types';

function node(id: string, x: number, y: number, label = id): Node {
  return {
    id,
    type: 'graphNode',
    position: { x, y },
    data: {
      label,
      timestampMs: y,
    },
  };
}

function edge(id: string, source: string, target: string): Edge {
  return {
    id,
    source,
    target,
  };
}

function seed(nodeIds: string[], anchorNodeIds: string[] = []): AutoTourSeed {
  return {
    sessionId: 'session_1',
    revision: 2,
    nodeIds,
    anchorNodeIds,
  };
}

describe('auto-tour two-stage utilities', () => {
  it('只保留与新增节点真实相连的锚点', () => {
    expect(
      getValidAutoTourAnchorNodeIds({
        addedNodeIds: ['n2', 'n3'],
        candidateAnchorNodeIds: ['n1', 'n9'],
        flowEdges: [
          edge('e1', 'n1', 'n2'),
          edge('e2', 'n9', 'old_unrelated'),
          edge('e3', 'n2', 'n3'),
        ],
      }),
    ).toEqual(['n1']);
  });

  it('能检测新增节点之间的可见边', () => {
    expect(
      hasVisibleAddedInternalEdge({
        addedNodeIds: ['n2', 'n3'],
        flowEdges: [edge('e1', 'n2', 'n3')],
      }),
    ).toBe(true);

    expect(
      hasVisibleAddedInternalEdge({
        addedNodeIds: ['n2', 'n3'],
        flowEdges: [edge('e1', 'n1', 'n2')],
      }),
    ).toBe(false);
  });

  it('有有效锚点时先生成 compact 结构揭示，再生成 readable 阅读阶段', () => {
    const stages = buildTwoStageAutoTourStages({
      seed: seed(['n2', 'n3'], ['n1', 'n9']),
      flowNodes: [
        node('n1', 0, 0, '旧锚点'),
        node('n2', 260, 0, '新增节点 1'),
        node('n3', 260, 168, '新增节点 2'),
        node('n9', 0, 336, '无关旧节点'),
      ],
      flowEdges: [
        edge('e1', 'n1', 'n2'),
        edge('e2', 'n2', 'n3'),
      ],
      containerWidth: 960,
      containerHeight: 720,
      currentZoom: 1,
      minReadableZoom: 1,
    });

    expect(stages[0]).toMatchObject({
      kind: 'structure',
      displayMode: 'compact',
      nodeIds: ['n2', 'n3'],
      anchorNodeIds: ['n1'],
    });
    expect(stages[1]).toMatchObject({
      kind: 'reading',
      displayMode: 'readable',
      nodeIds: ['n2', 'n3'],
      anchorNodeIds: [],
    });
  });

  it('没有有效锚点且没有新增内部边时跳过结构揭示', () => {
    const stages = buildTwoStageAutoTourStages({
      seed: seed(['n2'], ['n9']),
      flowNodes: [node('n2', 260, 0, '孤立新增'), node('n9', 0, 0, '无关旧节点')],
      flowEdges: [],
      containerWidth: 960,
      containerHeight: 720,
      currentZoom: 1,
      minReadableZoom: 1,
    });

    expect(stages).toHaveLength(1);
    expect(stages[0]).toMatchObject({
      kind: 'reading',
      displayMode: 'readable',
      nodeIds: ['n2'],
      anchorNodeIds: [],
    });
  });

  it('没有旧锚点但新增节点内部有边时仍生成结构揭示', () => {
    const stages = buildTwoStageAutoTourStages({
      seed: seed(['q1', 'p1', 'p2']),
      flowNodes: [
        node('q1', 0, 0, '问题'),
        node('p1', 260, 0, '小点一'),
        node('p2', 260, 168, '小点二'),
      ],
      flowEdges: [edge('e1', 'q1', 'p1'), edge('e2', 'q1', 'p2')],
      containerWidth: 960,
      containerHeight: 720,
      currentZoom: 1,
      minReadableZoom: 1,
    });

    expect(stages[0]).toMatchObject({
      kind: 'structure',
      displayMode: 'compact',
      nodeIds: ['q1', 'p1', 'p2'],
      anchorNodeIds: [],
    });
  });

  it('阅读阶段根据最小可读缩放拆成多个批次', () => {
    const stages = buildTwoStageAutoTourStages({
      seed: seed(['n1', 'n2', 'n3']),
      flowNodes: [
        node('n1', 0, 0, '新增节点 1'),
        node('n2', 0, 168, '新增节点 2'),
        node('n3', 0, 336, '新增节点 3'),
      ],
      flowEdges: [],
      containerWidth: 260,
      containerHeight: 180,
      currentZoom: 1,
      minReadableZoom: 1,
    });

    expect(stages.map((stage) => stage.kind)).toEqual(['reading', 'reading', 'reading']);
    expect(stages.map((stage) => stage.nodeIds)).toEqual([['n1'], ['n2'], ['n3']]);
  });
});
