import { describe, expect, it } from 'vitest';
import { computeMetrics } from './metrics';
import type { MergedGraph } from '@listen-graphic/schema';
import { LONG_LABEL_THRESHOLD } from './types';

function makeGraph(overrides: Partial<MergedGraph> = {}): MergedGraph {
  return {
    sessionId: 's1',
    revision: 1,
    topics: [],
    nodes: [],
    edges: [],
    updatedAt: 0,
    ...overrides,
  };
}

describe('computeMetrics', () => {
  it('空图：ratio 字段为 null，度字段为 0', () => {
    const m = computeMetrics(makeGraph());
    expect(m.nodeCount).toBe(0);
    expect(m.edgeCount).toBe(0);
    expect(m.opposesRatio).toBeNull();
    expect(m.avgDegree).toBeNull();
    expect(m.largestComponentRatio).toBeNull();
    expect(m.crossSpeakerEdgeRatio).toBeNull();
    expect(m.opposesCrossSpeakerRatio).toBeNull();
    expect(m.maxOutDegree).toBe(0);
    expect(m.maxOutDegreeNodeId).toBeNull();
  });

  it('isLargeGraph 在 nodeCount>=10 时为 true', () => {
    const nodes = Array.from({ length: 10 }, (_, i) => ({
      id: `n${i}`, type: 'claim' as const, text: 'x', timestampMs: 0, status: 'confirmed' as const,
    }));
    expect(computeMetrics(makeGraph({ nodes })).isLargeGraph).toBe(true);
  });

  it('opposesRatio = opposesCount / edgeCount', () => {
    const g = makeGraph({
      nodes: [
        { id: 'a', type: 'claim', text: 'a', timestampMs: 0, status: 'confirmed' },
        { id: 'b', type: 'claim', text: 'b', timestampMs: 0, status: 'confirmed' },
        { id: 'c', type: 'claim', text: 'c', timestampMs: 0, status: 'confirmed' },
      ],
      edges: [
        { id: 'e1', source: 'a', target: 'b', type: 'opposes' },
        { id: 'e2', source: 'a', target: 'c', type: 'supports' },
      ],
    });
    const m = computeMetrics(g);
    expect(m.opposesCount).toBe(1);
    expect(m.opposesRatio).toBeCloseTo(0.5);
  });

  it('crossSpeakerEdgeRatio：跨 speaker 边占比', () => {
    const g = makeGraph({
      nodes: [
        { id: 'a', type: 'claim', text: 'a', speaker: 'A', timestampMs: 0, status: 'confirmed' },
        { id: 'b', type: 'claim', text: 'b', speaker: 'B', timestampMs: 0, status: 'confirmed' },
        { id: 'c', type: 'claim', text: 'c', speaker: 'A', timestampMs: 0, status: 'confirmed' },
      ],
      edges: [
        { id: 'e1', source: 'a', target: 'b', type: 'supports' },
        { id: 'e2', source: 'a', target: 'c', type: 'supports' },
      ],
    });
    const m = computeMetrics(g);
    expect(m.crossSpeakerEdgeRatio).toBeCloseTo(0.5);
  });

  it('opposesCrossSpeakerRatio：opposesCount=0 时为 null', () => {
    const g = makeGraph({
      nodes: [{ id: 'a', type: 'claim', text: 'a', timestampMs: 0, status: 'confirmed' }],
      edges: [{ id: 'e1', source: 'a', target: 'a', type: 'supports' }],
    });
    expect(computeMetrics(g).opposesCrossSpeakerRatio).toBeNull();
  });

  it('opposesCrossSpeakerRatio：跨 speaker opposes 占比', () => {
    const g = makeGraph({
      nodes: [
        { id: 'a', type: 'claim', text: 'a', speaker: 'A', timestampMs: 0, status: 'confirmed' },
        { id: 'b', type: 'claim', text: 'b', speaker: 'B', timestampMs: 0, status: 'confirmed' },
        { id: 'c', type: 'claim', text: 'c', speaker: 'A', timestampMs: 0, status: 'confirmed' },
      ],
      edges: [
        { id: 'e1', source: 'a', target: 'b', type: 'opposes' },
        { id: 'e2', source: 'a', target: 'c', type: 'opposes' },
      ],
    });
    expect(computeMetrics(g).opposesCrossSpeakerRatio).toBeCloseTo(0.5);
  });

  it('longLabelNodeCount：text 长度超阈值计数', () => {
    const long = 'x'.repeat(LONG_LABEL_THRESHOLD + 1);
    const short = 'x';
    const g = makeGraph({
      nodes: [
        { id: 'a', type: 'claim', text: long, timestampMs: 0, status: 'confirmed' },
        { id: 'b', type: 'claim', text: short, timestampMs: 0, status: 'confirmed' },
      ],
    });
    expect(computeMetrics(g).longLabelNodeCount).toBe(1);
  });

  it('连通分量：两个孤立子图', () => {
    const g = makeGraph({
      nodes: [
        { id: 'a', type: 'claim', text: 'a', timestampMs: 0, status: 'confirmed' },
        { id: 'b', type: 'claim', text: 'b', timestampMs: 0, status: 'confirmed' },
        { id: 'c', type: 'claim', text: 'c', timestampMs: 0, status: 'confirmed' },
        { id: 'd', type: 'claim', text: 'd', timestampMs: 0, status: 'confirmed' },
      ],
      edges: [
        { id: 'e1', source: 'a', target: 'b', type: 'supports' },
        { id: 'e2', source: 'c', target: 'd', type: 'supports' },
      ],
    });
    const m = computeMetrics(g);
    expect(m.connectedComponents).toBe(2);
    expect(m.largestComponentRatio).toBeCloseTo(0.5);
  });

  it('maxOutDegree 与对应节点 id', () => {
    const g = makeGraph({
      nodes: [
        { id: 'a', type: 'claim', text: 'a', timestampMs: 0, status: 'confirmed' },
        { id: 'b', type: 'claim', text: 'b', timestampMs: 0, status: 'confirmed' },
        { id: 'c', type: 'claim', text: 'c', timestampMs: 0, status: 'confirmed' },
      ],
      edges: [
        { id: 'e1', source: 'a', target: 'b', type: 'supports' },
        { id: 'e2', source: 'a', target: 'c', type: 'supports' },
      ],
    });
    const m = computeMetrics(g);
    expect(m.maxOutDegree).toBe(2);
    expect(m.maxOutDegreeNodeId).toBe('a');
  });
});
