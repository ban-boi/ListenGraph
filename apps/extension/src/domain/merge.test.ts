import { describe, expect, it } from 'vitest';
import { mergeSegmentGraph } from '@listen-graphic/domain';
import type { MergedGraph, SegmentGraph } from '@listen-graphic/schema';

function createBaseGraph(): MergedGraph {
  return {
    sessionId: 'session_merge',
    revision: 1,
    topics: [],
    nodes: [],
    edges: [],
    updatedAt: 1,
  };
}

describe('domain mergeSegmentGraph', () => {
  it('节点折叠后会把新边重写到保留节点，避免悬空边', () => {
    const prev: MergedGraph = {
      ...createBaseGraph(),
      nodes: [
        {
          id: 'kept_claim',
          type: 'claim',
          text: '很多同学觉得杨贵妃是红颜祸水',
          timestampMs: 0,
          status: 'confirmed',
          evidenceChunkIds: ['chunk_prev'],
        },
      ],
    };
    const next: SegmentGraph = {
      segmentId: 'segment_next',
      sessionId: 'session_merge',
      startMs: 10_000,
      endMs: 20_000,
      provider: 'mock-structurer',
      nodes: [
        {
          id: 'segment_next:n1',
          type: 'claim',
          text: '很多同学认为杨贵妃是红颜祸水',
          timestampMs: 10_000,
          status: 'draft',
          evidenceChunkIds: ['chunk_next'],
        },
        {
          id: 'segment_next:n2',
          type: 'reason',
          text: '这种看法把复杂责任归给单一人物',
          timestampMs: 10_000,
          status: 'draft',
          evidenceChunkIds: ['chunk_next'],
        },
      ],
      edges: [
        {
          id: 'edge_next',
          source: 'segment_next:n1',
          target: 'segment_next:n2',
          type: 'supports',
          evidenceChunkIds: ['chunk_next'],
        },
      ],
    };

    const merged = mergeSegmentGraph(prev, next);

    expect(merged.nodes).toHaveLength(2);
    expect(merged.nodes.map((node) => node.id)).toEqual(
      expect.arrayContaining(['kept_claim', 'segment_next:n2']),
    );
    expect(merged.edges).toEqual([
      expect.objectContaining({
        source: 'kept_claim',
        target: 'segment_next:n2',
        type: 'supports',
      }),
    ]);
    expect(
      merged.edges.every(
        (edge) =>
          merged.nodes.some((node) => node.id === edge.source) &&
          merged.nodes.some((node) => node.id === edge.target),
      ),
    ).toBe(true);
  });

  it('节点被折叠后产生的自环边会被丢弃', () => {
    const prev: MergedGraph = {
      ...createBaseGraph(),
      nodes: [
        {
          id: 'kept_claim',
          type: 'claim',
          text: '很多同学觉得杨贵妃是红颜祸水',
          timestampMs: 0,
          status: 'confirmed',
        },
      ],
    };
    const next: SegmentGraph = {
      segmentId: 'segment_self_loop',
      sessionId: 'session_merge',
      startMs: 10_000,
      endMs: 20_000,
      provider: 'mock-structurer',
      nodes: [
        {
          id: 'segment_self_loop:n1',
          type: 'claim',
          text: '很多同学认为杨贵妃是红颜祸水',
          timestampMs: 10_000,
          status: 'draft',
        },
      ],
      edges: [
        {
          id: 'edge_self_loop',
          source: 'segment_self_loop:n1',
          target: 'segment_self_loop:n1',
          type: 'follows',
        },
      ],
    };

    const merged = mergeSegmentGraph(prev, next);

    expect(merged.nodes).toHaveLength(1);
    expect(merged.edges).toHaveLength(0);
  });

  it('保守近重复折叠不会误并远时间或 question 节点', () => {
    const prev: MergedGraph = {
      ...createBaseGraph(),
      nodes: [
        {
          id: 'old_claim',
          type: 'claim',
          text: '很多同学觉得杨贵妃是红颜祸水',
          timestampMs: 0,
          status: 'confirmed',
        },
        {
          id: 'old_question',
          type: 'question',
          text: '你还记得当时用的论点吗',
          timestampMs: 0,
          status: 'confirmed',
        },
      ],
    };
    const next: SegmentGraph = {
      segmentId: 'segment_far',
      sessionId: 'session_merge',
      startMs: 60_000,
      endMs: 70_000,
      provider: 'mock-structurer',
      nodes: [
        {
          id: 'segment_far:n1',
          type: 'claim',
          text: '很多同学认为杨贵妃是红颜祸水',
          timestampMs: 60_000,
          status: 'draft',
        },
        {
          id: 'segment_far:n2',
          type: 'question',
          text: '你还记得当时的论点是什么吗',
          timestampMs: 60_000,
          status: 'draft',
        },
      ],
      edges: [],
    };

    const merged = mergeSegmentGraph(prev, next);

    expect(merged.nodes.map((node) => node.id)).toEqual(
      expect.arrayContaining(['old_claim', 'old_question', 'segment_far:n1', 'segment_far:n2']),
    );
    expect(merged.nodes).toHaveLength(4);
  });
});
