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

describe('pipeline detail facts', () => {
  it('stores the latest stable transcript tail', () => {
    const next = panelReducer(initialPanelState, {
      type: 'TRANSCRIPT_READY',
      payload: {
        utteranceKey: 'asr-utterance-1',
        transcript: {
          text: '这是最新一句稳定转写',
          startMs: 1000,
          endMs: 2000,
          provider: 'mock',
        },
      },
    });
    expect(next.lastTranscriptTail).toEqual({
      text: '这是最新一句稳定转写',
      stable: true,
      at: 2000,
    });
  });

  it('stores graph delta counts from merged graph updates', () => {
    const previousGraph: MergedGraph = {
      ...graph,
      revision: 1,
      updatedAt: 1000,
      nodes: [{ id: 'n1', type: 'claim', text: 't', timestampMs: 0, status: 'confirmed' }],
      edges: [],
    };
    const nextGraph: MergedGraph = {
      ...previousGraph,
      revision: 2,
      updatedAt: 5678,
      nodes: [
        ...previousGraph.nodes,
        { id: 'n2', type: 'reason', text: 'r', timestampMs: 1000, status: 'confirmed' },
      ],
      edges: [{ id: 'e1', source: 'n1', target: 'n2', type: 'supports' }],
    };
    const next = panelReducer(initialPanelState, {
      type: 'MERGED_GRAPH_UPDATED',
      payload: {
        graph: nextGraph,
        shouldPreserveView: false,
        previousGraph,
        addedNodeIds: ['n2'],
        anchorNodeIds: ['n1'],
      },
    });
    expect(next.lastGraphDelta).toEqual({
      addedNodeCount: 1,
      addedEdgeCount: 1,
      at: 5678,
    });
  });

  it('clears graph delta and transcript tail on runtime UI reset', () => {
    const withFacts = {
      ...initialPanelState,
      lastTranscriptTail: { text: '旧转写', stable: true, at: 1 },
      lastGraphDelta: { addedNodeCount: 1, addedEdgeCount: 1, at: 2 },
    };
    const next = panelReducer(withFacts, { type: 'RESET_RUNTIME_UI' });
    expect(next.lastTranscriptTail).toBeNull();
    expect(next.lastGraphDelta).toBeNull();
  });

  it('clears graph delta on fixture sequence arm', () => {
    const withDelta = {
      ...initialPanelState,
      lastGraphDelta: { addedNodeCount: 1, addedEdgeCount: 1, at: 2 },
    };
    const next = panelReducer(withDelta, {
      type: 'FIXTURE_SEQUENCE_ARM',
      payload: { sessionId: 'fixture-seq-x', initialGraph: graph },
    });
    expect(next.lastGraphDelta).toBeNull();
  });
});
