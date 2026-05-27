import { describe, expect, it } from 'vitest';
import { panelReducer, initialPanelState } from './panel-reducer';
import type { MergedGraph } from '@listen-graphic/schema';

const graph: MergedGraph = {
  sessionId: 'fixture-seq-x',
  revision: 1,
  topics: [],
  nodes: [{ id: 'n1', type: 'claim', text: 't', timestampMs: 0, status: 'confirmed' }],
  edges: [],
  updatedAt: 0,
};

describe('FIXTURE_SEQUENCE_ARM', () => {
  it('sets sessionId and initial graph', () => {
    const next = panelReducer(initialPanelState, {
      type: 'FIXTURE_SEQUENCE_ARM',
      payload: { sessionId: 'fixture-seq-x', initialGraph: graph },
    });
    expect(next.sessionId).toBe('fixture-seq-x');
    expect(next.graph).toEqual(graph);
    expect(next.sessionState).toBe('stopped');
  });
});
