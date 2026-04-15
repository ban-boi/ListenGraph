import { describe, expect, it } from 'vitest';
import type { MergedGraph, SegmentGraph } from '@listen-graphic/schema';
import { mergeSegmentGraph } from '@listen-graphic/domain';

function createBaseGraph(): MergedGraph {
  return {
    sessionId: 'session_1',
    revision: 1,
    topics: [],
    nodes: [
      {
        id: 'existing_claim',
        type: 'claim',
        text: '做 AI API 很难盈利',
        timestampMs: 10_000,
        status: 'confirmed',
        confidence: 0.9,
      },
    ],
    edges: [],
    updatedAt: 100,
  };
}

function createSegment(params: {
  nodes: SegmentGraph['nodes'];
  edges?: SegmentGraph['edges'];
}): SegmentGraph {
  return {
    segmentId: 'segment_2',
    sessionId: 'session_1',
    startMs: 20_000,
    endMs: 30_000,
    provider: 'test-structurer',
    topic: 'topic',
    nodes: params.nodes,
    edges: params.edges ?? [],
  };
}

describe('mergeSegmentGraph', () => {
  it('会精确去重，但不会改写已有节点文本或类型', () => {
    const prev = createBaseGraph();
    const next = createSegment({
      nodes: [
        {
          id: 'incoming_claim',
          type: 'claim',
          text: '做 AI API 很难盈利',
          timestampMs: 21_000,
          status: 'draft',
          confidence: 0.7,
          evidenceChunkIds: ['chunk_2'],
        },
      ],
    });

    const merged = mergeSegmentGraph(prev, next);

    expect(merged.nodes).toHaveLength(1);
    expect(merged.nodes[0]).toMatchObject({
      id: 'existing_claim',
      type: 'claim',
      text: '做 AI API 很难盈利',
      status: 'confirmed',
    });
    expect(merged.nodes[0]?.evidenceChunkIds).toContain('chunk_2');
  });

  it('不会把更完整的新说法吞并到旧节点里', () => {
    const prev = createBaseGraph();
    const next = createSegment({
      nodes: [
        {
          id: 'incoming_claim',
          type: 'claim',
          text: '做 AI API 很难盈利，因为推理成本高而且价格竞争激烈',
          timestampMs: 22_000,
          status: 'draft',
          confidence: 0.8,
        },
      ],
    });

    const merged = mergeSegmentGraph(prev, next);

    expect(merged.nodes).toHaveLength(2);
    expect(merged.nodes[0]).toMatchObject({
      id: 'existing_claim',
      text: '做 AI API 很难盈利',
      type: 'claim',
    });
    expect(merged.nodes[1]).toMatchObject({
      id: 'incoming_claim',
      text: '做 AI API 很难盈利，因为推理成本高而且价格竞争激烈',
      type: 'claim',
    });
  });

  it('会合并高相似度的近重复转写噪声，但只更新 metadata', () => {
    const prev = createBaseGraph();
    const next = createSegment({
      nodes: [
        {
          id: 'incoming_claim',
          type: 'claim',
          text: '做AI API很难盈利',
          timestampMs: 22_000,
          status: 'draft',
          confidence: 0.95,
          evidenceChunkIds: ['chunk_2'],
        },
      ],
    });

    const merged = mergeSegmentGraph(prev, next);

    expect(merged.nodes).toHaveLength(1);
    expect(merged.nodes[0]).toMatchObject({
      id: 'existing_claim',
      text: '做 AI API 很难盈利',
      type: 'claim',
      status: 'confirmed',
      confidence: 0.95,
    });
    expect(merged.nodes[0]?.evidenceChunkIds).toContain('chunk_2');
  });
});
