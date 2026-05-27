import type { MergedGraph } from '@listen-graphic/schema';

import { getAddedNodeIds, getAutoRevealAnchorNodeIds } from './graph-diff';

export function computeStepPayload(previousGraph: MergedGraph, nextGraph: MergedGraph) {
  const addedNodeIds = getAddedNodeIds(previousGraph, nextGraph);
  const anchorNodeIds = getAutoRevealAnchorNodeIds({
    addedNodeIds,
    previousGraph,
    nextGraph,
  });

  return {
    addedNodeIds,
    anchorNodeIds,
    shouldPreserveView: previousGraph.sessionId === nextGraph.sessionId,
  };
}
