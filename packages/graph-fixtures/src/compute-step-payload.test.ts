import { describe, expect, it } from 'vitest';
import type { MergedGraph } from '@listen-graphic/schema';

import { computeStepPayload } from './compute-step-payload';

const base = (nodes: MergedGraph['nodes'], edges: MergedGraph['edges'] = []): MergedGraph => ({
  sessionId: 'fixture-s',
  revision: 1,
  topics: [],
  nodes,
  edges,
  updatedAt: 0,
});

describe('computeStepPayload', () => {
  it('detects added nodes and preserveView for same session', () => {
    const prev = base([
      { id: 'n1', type: 'claim', text: 'a', timestampMs: 0, status: 'confirmed' },
    ]);
    const next: MergedGraph = {
      ...prev,
      revision: 2,
      nodes: [
        ...prev.nodes,
        { id: 'n2', type: 'reason', text: 'b', timestampMs: 1000, status: 'confirmed' },
      ],
      edges: [{ id: 'e1', source: 'n1', target: 'n2', type: 'supports' }],
    };

    const payload = computeStepPayload(prev, next);
    expect(payload.addedNodeIds).toEqual(['n2']);
    expect(payload.shouldPreserveView).toBe(true);
    expect(payload.anchorNodeIds).toContain('n1');
  });
});
