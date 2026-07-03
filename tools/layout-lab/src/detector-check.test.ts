import { describe, expect, it } from 'vitest';
import { whatDetectorSays } from './detector-check';
import type { MergedGraph } from '@listen-graphic/schema';

describe('whatDetectorSays', () => {
  it('有 opposes 边时命中 opposition 模式', () => {
    const g: MergedGraph = {
      sessionId: 's1', revision: 1, topics: [], updatedAt: 0,
      nodes: [
        { id: 'a', type: 'claim', text: 'a', timestampMs: 0, status: 'confirmed' },
        { id: 'b', type: 'claim', text: 'b', timestampMs: 0, status: 'confirmed' },
      ],
      edges: [{ id: 'e1', source: 'a', target: 'b', type: 'opposes' }],
    };
    const d = whatDetectorSays(g);
    expect(d.pattern).toBe('opposition');
    expect(d.rootNodeId).toBe('a');
  });

  it('空图未匹配', () => {
    const g: MergedGraph = { sessionId: 's1', revision: 1, topics: [], nodes: [], edges: [], updatedAt: 0 };
    expect(whatDetectorSays(g).pattern).toBe('(未匹配)');
  });
});
