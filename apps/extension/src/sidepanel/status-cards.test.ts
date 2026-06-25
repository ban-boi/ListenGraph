import { describe, expect, it } from 'vitest';
import type { MergedGraph } from '@listen-graphic/schema';
import { initialPanelState } from './panel-reducer';
import {
  computeAsrStatusCard,
  computeGraphStatusCard,
  computeStructurerStatusCard,
} from './status-cards';

const nowMs = 10_000;

const graph: MergedGraph = {
  sessionId: 's1',
  revision: 1,
  topics: [],
  nodes: [
    { id: 'n1', type: 'claim', text: '观点', timestampMs: 0, status: 'confirmed' },
    { id: 'n2', type: 'reason', text: '理由', timestampMs: 1, status: 'confirmed' },
  ],
  edges: [{ id: 'e1', source: 'n1', target: 'n2', type: 'supports' }],
  updatedAt: nowMs,
};

describe('pipeline status composers', () => {
  it('uses stable transcript tail for ASR detail', () => {
    const card = computeAsrStatusCard({
      panel: {
        ...initialPanelState,
        sessionState: 'capturing',
        lastTranscriptTail: { text: '最后一句稳定转写', stable: true, at: nowMs - 500 },
      },
      providerAsrType: 'mock',
      statusNowMs: nowMs,
    });
    expect(card).toMatchObject({
      label: 'ASR',
      detail: '最后一句稳定转写',
      tone: 'success',
    });
  });

  it('summarizes structurer pressure without lastStructurerRun', () => {
    const card = computeStructurerStatusCard({
      panel: {
        ...initialPanelState,
        sessionState: 'structuring',
        structuringSince: nowMs - 2400,
        pendingTranscriptCount: 3,
        pendingWorkCount: 1,
        lastStructurerRun: { status: 'success', durationMs: 10, mode: 'window' } as any,
      },
      providerAsrType: 'mock',
      statusNowMs: nowMs,
    });
    expect(card.detail).toBe('2.4s · 排队 3');
    expect(card.tone).toBe('congested');
  });

  it('prioritizes graph error over delta and tour', () => {
    const card = computeGraphStatusCard({
      graph,
      pendingWorkCount: 2,
      recentStructurerError: { stage: 'structurer', message: 'fail' } as any,
      lastGraphDelta: { addedNodeCount: 1, addedEdgeCount: 1, at: nowMs },
      lastGraphUpdatedAt: nowMs,
      statusNowMs: nowMs,
      tourStatus: 'touring',
      tourProgress: { current: 1, total: 2 },
    });
    expect(card.detail).toBe('保留旧图 · 待处理 2');
    expect(card.tone).toBe('error');
  });

  it('uses fresh graph delta within 1000ms', () => {
    const card = computeGraphStatusCard({
      graph,
      pendingWorkCount: 0,
      recentStructurerError: null,
      lastGraphDelta: { addedNodeCount: 2, addedEdgeCount: 1, at: nowMs - 1000 },
      lastGraphUpdatedAt: nowMs - 1000,
      statusNowMs: nowMs,
      tourStatus: 'idle',
      tourProgress: { current: 0, total: 0 },
    });
    expect(card.detail).toBe('新增 2 节点 · 1 关系');
  });

  it('uses tour detail after fresh delta window', () => {
    const card = computeGraphStatusCard({
      graph,
      pendingWorkCount: 0,
      recentStructurerError: null,
      lastGraphDelta: { addedNodeCount: 2, addedEdgeCount: 1, at: nowMs - 1001 },
      lastGraphUpdatedAt: nowMs - 1001,
      statusNowMs: nowMs,
      tourStatus: 'touring',
      tourProgress: { current: 1, total: 2 },
    });
    expect(card.detail).toBe('导览 1/2');
  });

  it('uses recent replay within 5000ms and stable text after that', () => {
    const recent = computeGraphStatusCard({
      graph,
      pendingWorkCount: 0,
      recentStructurerError: null,
      lastGraphDelta: null,
      lastGraphUpdatedAt: nowMs - 5000,
      statusNowMs: nowMs,
      tourStatus: 'idle',
      tourProgress: { current: 0, total: 0 },
    });
    expect(recent.detail).toBe('回显 2 节点 · 1 关系');

    const stable = computeGraphStatusCard({
      graph,
      pendingWorkCount: 0,
      recentStructurerError: null,
      lastGraphDelta: null,
      lastGraphUpdatedAt: nowMs - 5001,
      statusNowMs: nowMs,
      tourStatus: 'idle',
      tourProgress: { current: 0, total: 0 },
    });
    expect(stable.detail).toBe('图谱已稳定 · 2 节点 · 1 关系');
  });
});
