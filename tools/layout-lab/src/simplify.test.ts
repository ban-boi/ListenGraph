import { describe, expect, it } from 'vitest';
import { simplifyGraph } from './simplify';
import type { MergedGraph } from '@listen-graphic/schema';

describe('simplifyGraph', () => {
  it('精简后只保留 id/type/text/speaker 和边 source/target/type', () => {
    const g: MergedGraph = {
      sessionId: 's1', revision: 1, topics: [], updatedAt: 0,
      nodes: [{ id: 'n1', type: 'claim', text: 'hello', speaker: 'A', timestampMs: 0, status: 'confirmed', confidence: 0.9 }],
      edges: [{ id: 'e1', source: 'n1', target: 'n2', type: 'supports', confidence: 0.8 }],
    };
    const s = simplifyGraph(g);
    expect(s.nodes[0]).toEqual({ id: 'n1', type: 'claim', text: 'hello', speaker: 'A' });
    expect(s.edges[0]).toEqual({ source: 'n1', target: 'n2', type: 'supports' });
  });

  it('无 speaker 的节点不包含 speaker 字段', () => {
    const g: MergedGraph = {
      sessionId: 's1', revision: 1, topics: [], updatedAt: 0,
      nodes: [{ id: 'n1', type: 'claim', text: 'x', timestampMs: 0, status: 'confirmed' }],
      edges: [],
    };
    expect(simplifyGraph(g).nodes[0]).not.toHaveProperty('speaker');
  });
});
