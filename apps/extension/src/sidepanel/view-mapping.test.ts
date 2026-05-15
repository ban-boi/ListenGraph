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

describe('timeline 视图映射（reducer 路径）', () => {
  it('MERGED_GRAPH_UPDATED: defaultView=timeline 映射为 causal', () => {
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
    expect(next.currentView).toBe('causal');
  });

  it('HYDRATE_SNAPSHOT: preferredView=timeline 映射为 causal', () => {
    const action: PanelAction = {
      type: 'HYDRATE_SNAPSHOT',
      payload: {
        sessionId: 'test',
        state: 'idle',
        graph: makeGraph('timeline'),
        currentTimeMs: 0,
        preferredView: 'timeline',
      },
    };
    const next = panelReducer(initialPanelState, action);
    expect(next.currentView).toBe('causal');
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
        },
      };
      const next = panelReducer(initialPanelState, action);
      expect(next.currentView).toBe(view);
    }
  });
});
