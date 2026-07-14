import { describe, expect, it } from 'vitest';
import type { MergedGraph } from '@listen-graphic/schema';
import { redactMergedGraph } from './redact-graph';

function sample(): MergedGraph {
  return {
    sessionId: 'session_secret_1',
    revision: 3,
    topics: [{ topicId: 't1', title: '真实话题名', startMs: 0, endMs: 1000 }],
    nodes: [
      {
        id: 'n1',
        type: 'claim',
        text: 'AI来了之后，短剧和慢剧最先受到冲击',
        timestampMs: 1000,
        status: 'confirmed',
        evidenceChunkIds: ['chunk_secret'],
      },
      {
        id: 'n2',
        type: 'reason',
        text: '短',
        timestampMs: 2000,
        status: 'confirmed',
      },
    ],
    edges: [
      {
        id: 'e1',
        source: 'n1',
        target: 'n2',
        type: 'supports',
        evidenceChunkIds: ['chunk_secret'],
      },
    ],
    updatedAt: 1,
  };
}

describe('redactMergedGraph', () => {
  it('替换文本且保留长度量级，清除 evidence', () => {
    const out = redactMergedGraph(sample(), { caseId: 'reg-r3b-018' });
    expect(out.sessionId).toBe('regression_reg-r3b-018');
    expect(out.nodes[0].text).not.toContain('短剧');
    expect(out.nodes[0].text.length).toBeGreaterThanOrEqual(10);
    expect(out.nodes[0].evidenceChunkIds).toEqual([]);
    expect(out.edges[0].evidenceChunkIds).toEqual([]);
    expect(out.topics?.[0]?.title).toMatch(/^Topic/);
  });

  it('保持节点/边拓扑不变', () => {
    const src = sample();
    const out = redactMergedGraph(src, { caseId: 'x' });
    expect(out.nodes.map((n) => n.id)).toEqual(src.nodes.map((n) => n.id));
    expect(out.edges.map((e) => [e.source, e.target, e.type])).toEqual(
      src.edges.map((e) => [e.source, e.target, e.type]),
    );
  });
});
