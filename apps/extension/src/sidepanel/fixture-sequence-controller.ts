import type { MergedGraph } from '@listen-graphic/schema';
import { computeStepPayload } from '@listen-graphic/graph-fixtures/compute-step-payload';
import type { SequenceFixture } from '@listen-graphic/graph-fixtures/types';

import type { PanelAction } from './panel-reducer';
import type { AutoTourSeed } from './types';

export type FixtureLabDeps = {
  dispatch: React.Dispatch<PanelAction>;
  graphRef: React.MutableRefObject<MergedGraph>;
  activeViewSessionRef: React.MutableRefObject<string | null>;
  addLog: (msg: string) => void;
  setAutoTourSeed: (seed: AutoTourSeed | null) => void;
  onFixtureLabReset: (sessionId: string) => void;
  onFixtureLabDisarm?: () => void;
};

export type FixtureSequenceRegistry = {
  list: () => string[];
  load: (id: string) => SequenceFixture | null;
};

export type ListenGraphicFixtureAPI = {
  list: () => string[];
  arm: (id: string) => void;
  disarm: () => void;
  next: () => boolean;
  prev: () => boolean;
  reset: () => void;
  status: () => {
    isArmed: boolean;
    id: string | null;
    step: number;
    total: number;
    revision: number;
    nodeCount: number;
    edgeCount: number;
  };
};

type ControllerState = {
  armed: boolean;
  fixtureId: string | null;
  stepIndex: number;
  sequence: SequenceFixture | null;
};

function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

export function createFixtureSequenceController(
  getDeps: () => FixtureLabDeps,
  registry: FixtureSequenceRegistry,
): ListenGraphicFixtureAPI {
  const state: ControllerState = {
    armed: false,
    fixtureId: null,
    stepIndex: 0,
    sequence: null,
  };

  let keydownHandler: ((event: KeyboardEvent) => void) | null = null;

  const currentGraph = (): MergedGraph | null =>
    state.sequence?.steps[state.stepIndex]?.graph ?? null;

  const formatStepLog = (graph: MergedGraph): string => {
    const total = state.sequence?.steps.length ?? 0;
    const id = state.fixtureId ?? 'unknown';
    const step = state.stepIndex + 1;
    return `[fixture] ${id} ${step}/${total} | rev=${graph.revision} | nodes=${graph.nodes.length}`;
  };

  const deliverStep = (nextGraph: MergedGraph) => {
    const deps = getDeps();
    const previousGraph = deps.graphRef.current;
    const shouldPreserveView =
      deps.activeViewSessionRef.current === nextGraph.sessionId;
    const { addedNodeIds, anchorNodeIds } = computeStepPayload(previousGraph, nextGraph);

    deps.dispatch({
      type: 'MERGED_GRAPH_UPDATED',
      payload: {
        graph: nextGraph,
        shouldPreserveView,
        previousGraph,
        addedNodeIds,
        anchorNodeIds,
      },
    });

    deps.graphRef.current = nextGraph;
    deps.activeViewSessionRef.current = nextGraph.sessionId;

    if (addedNodeIds.length > 0) {
      deps.setAutoTourSeed({
        sessionId: nextGraph.sessionId,
        revision: nextGraph.revision,
        nodeIds: addedNodeIds,
        anchorNodeIds,
      });
    }

    deps.addLog(formatStepLog(nextGraph));
  };

  const removeKeyboardListener = () => {
    if (keydownHandler) {
      window.removeEventListener('keydown', keydownHandler);
      keydownHandler = null;
    }
  };

  const registerKeyboardListener = () => {
    removeKeyboardListener();
    keydownHandler = (event: KeyboardEvent) => {
      if (!state.armed) return;
      if (isEditableTarget(event.target)) return;

      if (event.key === ']') {
        event.preventDefault();
        api.next();
      } else if (event.key === '[') {
        event.preventDefault();
        api.prev();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        api.reset();
      }
    };
    window.addEventListener('keydown', keydownHandler);
  };

  const api: ListenGraphicFixtureAPI = {
    list: () => registry.list(),

    arm: (id: string) => {
      const deps = getDeps();
      const sequence = registry.load(id);
      if (!sequence) {
        deps.addLog(`[fixture] unknown sequence: ${id}`);
        return;
      }

      if (state.armed) {
        removeKeyboardListener();
      }

      deps.onFixtureLabReset(sequence.sessionId);

      const initialGraph = sequence.steps[0]?.graph;
      if (!initialGraph) {
        deps.addLog(`[fixture] sequence has no steps: ${id}`);
        return;
      }

      deps.dispatch({
        type: 'FIXTURE_SEQUENCE_ARM',
        payload: {
          sessionId: sequence.sessionId,
          initialGraph,
        },
      });

      deps.graphRef.current = initialGraph;
      state.armed = true;
      state.fixtureId = id;
      state.stepIndex = 0;
      state.sequence = sequence;

      registerKeyboardListener();
      deps.addLog(
        `[fixture] armed ${id} 1/${sequence.steps.length} | rev=${initialGraph.revision} | nodes=${initialGraph.nodes.length}`,
      );
    },

    disarm: () => {
      if (!state.armed) return;
      const deps = getDeps();
      removeKeyboardListener();
      state.armed = false;
      state.fixtureId = null;
      state.stepIndex = 0;
      state.sequence = null;
      deps.onFixtureLabDisarm?.();
      deps.dispatch({ type: 'FIXTURE_SEQUENCE_DISARM' });
      deps.addLog('[fixture] disarmed');
    },

    next: () => {
      if (!state.armed || !state.sequence) return false;
      const nextIndex = state.stepIndex + 1;
      if (nextIndex >= state.sequence.steps.length) return false;

      state.stepIndex = nextIndex;
      deliverStep(state.sequence.steps[nextIndex].graph);
      return true;
    },

    prev: () => {
      if (!state.armed || !state.sequence) return false;
      const prevIndex = state.stepIndex - 1;
      if (prevIndex < 0) return false;

      state.stepIndex = prevIndex;
      deliverStep(state.sequence.steps[prevIndex].graph);
      return true;
    },

    reset: () => {
      const id = state.fixtureId;
      if (!id) return;
      api.arm(id);
    },

    status: () => {
      const graph = state.armed
        ? getDeps().graphRef.current
        : currentGraph();
      return {
        isArmed: state.armed,
        id: state.fixtureId,
        step: state.stepIndex,
        total: state.sequence?.steps.length ?? 0,
        revision: graph?.revision ?? 0,
        nodeCount: graph?.nodes?.length ?? 0,
        edgeCount: graph?.edges?.length ?? 0,
      };
    },
  };

  return api;
}
