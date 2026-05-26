import { describe, it, expect } from 'vitest';
import { panelReducer, initialPanelState } from './panel-reducer';
import { createEmptyGraph } from './constants';
import type { PanelAction } from './panel-reducer';
import type { MergedGraph } from '@listen-graphic/schema';

/** 构建 viewHints.defaultView = view 的最小 MergedGraph */
function makeGraph(defaultView: string): MergedGraph {
  return {
    ...createEmptyGraph(),
    viewHints: { defaultView: defaultView as MergedGraph['viewHints'] extends undefined ? never : NonNullable<MergedGraph['viewHints']>['defaultView'] },
  };
}

const MINIMAL_PROVIDER_SUMMARY = {
  asr: { type: 'mock', mode: 'direct' as const, apiKeyConfigured: false, sessionTokenConfigured: false },
  structurer: { type: 'mock', mode: 'direct' as const, apiKeyConfigured: false, sessionTokenConfigured: false },
};

describe('timeline 视图保持为独立视图（reducer 路径）', () => {
  it('MERGED_GRAPH_UPDATED: defaultView=timeline 保持 timeline', () => {
    const graph = makeGraph('timeline');
    const action: PanelAction = {
      type: 'MERGED_GRAPH_UPDATED',
      payload: {
        graph,
        shouldPreserveView: false,
        previousGraph: createEmptyGraph(),
        addedNodeIds: [],
        anchorNodeIds: [],
      },
    };
    const next = panelReducer(initialPanelState, action);
    expect(next.currentView).toBe('timeline');
  });

  it('HYDRATE_SNAPSHOT: preferredView=timeline 保持 timeline', () => {
    const action: PanelAction = {
      type: 'HYDRATE_SNAPSHOT',
      payload: {
        sessionId: 'test',
        state: 'idle',
        graph: makeGraph('timeline'),
        currentTimeMs: 0,
        preferredView: 'timeline',
        providerSummary: MINIMAL_PROVIDER_SUMMARY,
      },
    };
    const next = panelReducer(initialPanelState, action);
    expect(next.currentView).toBe('timeline');
  });

  it('非 timeline 视图通过 MERGED_GRAPH_UPDATED 保持不变', () => {
    for (const view of ['causal', 'comparison', 'hierarchy'] as const) {
      const graph = makeGraph(view);
      const action: PanelAction = {
        type: 'MERGED_GRAPH_UPDATED',
        payload: {
          graph,
          shouldPreserveView: false,
          previousGraph: createEmptyGraph(),
          addedNodeIds: [],
          anchorNodeIds: [],
        },
      };
      const next = panelReducer(initialPanelState, action);
      expect(next.currentView).toBe(view);
    }
  });

  it('非 timeline 视图通过 HYDRATE_SNAPSHOT 保持不变', () => {
    for (const view of ['causal', 'comparison', 'hierarchy'] as const) {
      const action: PanelAction = {
        type: 'HYDRATE_SNAPSHOT',
        payload: {
          sessionId: 'test',
          state: 'idle',
          graph: makeGraph(view),
          currentTimeMs: 0,
          preferredView: view,
          providerSummary: MINIMAL_PROVIDER_SUMMARY,
        },
      };
      const next = panelReducer(initialPanelState, action);
      expect(next.currentView).toBe(view);
    }
  });
});
