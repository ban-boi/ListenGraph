import { act } from 'react';
import type { MergedGraph } from '@listen-graphic/schema';
import { computeStepPayload } from '@listen-graphic/graph-fixtures/compute-step-payload';
import { loadSequence } from '@listen-graphic/graph-fixtures/load';

import { createEmptyGraph } from './constants';
import {
  renderApp,
  triggerDeferredReactFlowInit,
  reactFlowFitViewSpy,
  setReactFlowInitMode,
} from './__test-helpers__/app-test-helpers';

export type FixtureSequenceAssertion = {
  afterStep: number;
  expectFitViewCalls: number;
};

export type PlaySequenceAndAssertOptions = {
  fixtureId: string;
  assertions: FixtureSequenceAssertion[];
};

type ChromeMessageListener = (
  message: { type?: string; target?: string; payload?: Record<string, unknown> },
) => void;

function registerChromeMessageListener(): ChromeMessageListener[] {
  const listeners: ChromeMessageListener[] = [];
  (globalThis as any).chrome.runtime.onMessage.addListener.mockImplementation(
    (listener: ChromeMessageListener) => {
      listeners.push(listener);
    },
  );
  return listeners;
}

function setupIdleSnapshot() {
  (globalThis as any).chrome.runtime.sendMessage.mockImplementation(
    (message: { type?: string }) => {
      if (message?.type === 'GET_RUNTIME_SNAPSHOT') {
        return Promise.resolve({
          success: true,
          snapshot: {
            sessionId: null,
            state: 'idle',
            graph: null,
            currentTimeMs: 0,
          },
        });
      }
      if (message?.type === 'GET_GRAPH_DISPLAY_SETTINGS') {
        return Promise.resolve({
          success: true,
          graphDisplaySettings: {
            autoFitMinReadableFontPx: 12,
          },
        });
      }
      return Promise.resolve({ success: true });
    },
  );
}

async function deliverMergedGraphUpdate(
  listeners: ChromeMessageListener[],
  params: {
    previousGraph: MergedGraph;
    nextGraph: MergedGraph;
  },
) {
  const { addedNodeIds, anchorNodeIds, shouldPreserveView } = computeStepPayload(
    params.previousGraph,
    params.nextGraph,
  );

  await act(async () => {
    listeners[0]?.({
      type: 'MERGED_GRAPH_UPDATED',
      target: 'sidepanel',
      payload: {
        graph: params.nextGraph,
        shouldPreserveView,
        previousGraph: params.previousGraph,
        addedNodeIds,
        anchorNodeIds,
      },
    });
    await Promise.resolve();
  });
}

export async function playSequenceAndAssert(options: PlaySequenceAndAssertOptions) {
  const sequence = loadSequence(options.fixtureId);
  const maxStep = Math.max(
    0,
    ...options.assertions.map((assertion) => assertion.afterStep),
  );

  setReactFlowInitMode('deferred');
  const listeners = registerChromeMessageListener();
  setupIdleSnapshot();

  await renderApp();

  await act(async () => {
    triggerDeferredReactFlowInit();
    await Promise.resolve();
  });

  let previousGraph = createEmptyGraph();

  for (let stepIndex = 0; stepIndex <= maxStep; stepIndex += 1) {
    const step = sequence.steps[stepIndex];
    if (!step) {
      throw new Error(`Sequence ${options.fixtureId} has no step at index ${stepIndex}`);
    }

    const nextGraph = step.graph;
    await deliverMergedGraphUpdate(listeners, { previousGraph, nextGraph });
    previousGraph = nextGraph;

    const stepAssertions = options.assertions.filter(
      (assertion) => assertion.afterStep === stepIndex,
    );
    for (const assertion of stepAssertions) {
      expect(reactFlowFitViewSpy.mock.calls.length).toBe(assertion.expectFitViewCalls);
    }
  }
}
