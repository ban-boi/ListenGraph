# Two-Stage Auto Tour Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a two-stage graph auto tour that first reveals the structure of each graph increment, then focuses readable batches of newly added nodes.

**Architecture:** Keep graph layout stable and extend the existing sidepanel auto-tour system. Add pure utilities that build structure and reading stages from `addedNodeIds`, `anchorNodeIds`, React Flow nodes, and edges; then update `useAutoTour` to queue stage playback and update node display mode per active stage. Node rendering gets compact/readable modes without introducing topic logic, dagre/elk, or global relayout.

**Tech Stack:** TypeScript, React 18, React Flow v11, Vitest, Testing Library, Chrome extension runtime messaging.

---

## File Structure

- Modify: `apps/extension/src/sidepanel/types.ts`
  - Add auto-tour stage types and node display mode fields.
- Modify: `apps/extension/src/sidepanel/constants.ts`
  - Add stage timing constants and update manual resume delay to about 7000 ms.
- Modify: `apps/extension/src/sidepanel/auto-tour-utils.ts`
  - Add pure functions for valid anchor filtering, structure-stage creation, readable batch construction, and two-stage plan construction.
- Create: `apps/extension/src/sidepanel/auto-tour-utils.test.ts`
  - Cover data selection and stage construction before changing the hook.
- Modify: `apps/extension/src/sidepanel/hooks/useAutoTour.ts`
  - Replace single pending seed playback with queued stage playback.
  - Expose the active stage so `App.tsx` can mark nodes compact/readable.
- Modify: `apps/extension/src/sidepanel/GraphNodeCard.tsx`
  - Render compact mode for structure reveal and readable mode for reading focus.
- Modify: `apps/extension/src/sidepanel/App.tsx`
  - Pass `autoFitMinReadableFontPx` to `useAutoTour`.
  - Add active stage display fields to React Flow node data.
- Modify: `apps/extension/src/sidepanel/__test-helpers__/app-test-helpers.tsx`
  - Expose display mode in the mocked node button attributes if needed by tests.
- Modify: `apps/extension/src/sidepanel/App.graph-updates.test.tsx`
  - Update existing auto-tour expectations from single-batch reveal to two-stage behavior.

Do not commit unless the user explicitly asks for a commit.

---

### Task 1: Add Pure Two-Stage Auto-Tour Utilities

**Files:**
- Create: `apps/extension/src/sidepanel/auto-tour-utils.test.ts`
- Modify: `apps/extension/src/sidepanel/types.ts`
- Modify: `apps/extension/src/sidepanel/auto-tour-utils.ts`

- [ ] **Step 1: Add stage types**

In `apps/extension/src/sidepanel/types.ts`, replace the current auto-tour batch section:

```ts
export type AutoTourSeed = {
  sessionId: string;
  revision: number;
  nodeIds: string[];
  anchorNodeIds: string[];
};

export type AutoTourBatch = {
  nodeIds: string[];
  anchorNodeIds: string[];
  dwellMs: number;
};
```

with:

```ts
export type AutoTourDisplayMode = 'compact' | 'readable';

export type AutoTourStageKind = 'structure' | 'reading';

export type AutoTourSeed = {
  sessionId: string;
  revision: number;
  nodeIds: string[];
  anchorNodeIds: string[];
};

export type AutoTourBatch = {
  nodeIds: string[];
  anchorNodeIds: string[];
  dwellMs: number;
};

export type AutoTourStage = AutoTourBatch & {
  kind: AutoTourStageKind;
  displayMode: AutoTourDisplayMode;
};

export type AutoTourUnit = {
  sessionId: string;
  revision: number;
  stages: AutoTourStage[];
};
```

- [ ] **Step 2: Add failing utility tests**

Create `apps/extension/src/sidepanel/auto-tour-utils.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { Edge, Node } from 'reactflow';

import {
  buildTwoStageAutoTourStages,
  getValidAutoTourAnchorNodeIds,
  hasVisibleAddedInternalEdge,
} from './auto-tour-utils';
import type { AutoTourSeed } from './types';

function node(id: string, x: number, y: number, label = id): Node {
  return {
    id,
    type: 'graphNode',
    position: { x, y },
    data: {
      label,
      timestampMs: y,
    },
  };
}

function edge(id: string, source: string, target: string): Edge {
  return {
    id,
    source,
    target,
  };
}

function seed(nodeIds: string[], anchorNodeIds: string[] = []): AutoTourSeed {
  return {
    sessionId: 'session_1',
    revision: 2,
    nodeIds,
    anchorNodeIds,
  };
}

describe('auto-tour two-stage utilities', () => {
  it('只保留与新增节点真实相连的锚点', () => {
    expect(
      getValidAutoTourAnchorNodeIds({
        addedNodeIds: ['n2', 'n3'],
        candidateAnchorNodeIds: ['n1', 'n9'],
        flowEdges: [
          edge('e1', 'n1', 'n2'),
          edge('e2', 'n9', 'old_unrelated'),
          edge('e3', 'n2', 'n3'),
        ],
      }),
    ).toEqual(['n1']);
  });

  it('能检测新增节点之间的可见边', () => {
    expect(
      hasVisibleAddedInternalEdge({
        addedNodeIds: ['n2', 'n3'],
        flowEdges: [edge('e1', 'n2', 'n3')],
      }),
    ).toBe(true);

    expect(
      hasVisibleAddedInternalEdge({
        addedNodeIds: ['n2', 'n3'],
        flowEdges: [edge('e1', 'n1', 'n2')],
      }),
    ).toBe(false);
  });

  it('有有效锚点时先生成 compact 结构揭示，再生成 readable 阅读阶段', () => {
    const stages = buildTwoStageAutoTourStages({
      seed: seed(['n2', 'n3'], ['n1', 'n9']),
      flowNodes: [
        node('n1', 0, 0, '旧锚点'),
        node('n2', 260, 0, '新增节点 1'),
        node('n3', 260, 168, '新增节点 2'),
        node('n9', 0, 336, '无关旧节点'),
      ],
      flowEdges: [
        edge('e1', 'n1', 'n2'),
        edge('e2', 'n2', 'n3'),
      ],
      containerWidth: 960,
      containerHeight: 720,
      currentZoom: 1,
      minReadableZoom: 1,
    });

    expect(stages[0]).toMatchObject({
      kind: 'structure',
      displayMode: 'compact',
      nodeIds: ['n2', 'n3'],
      anchorNodeIds: ['n1'],
    });
    expect(stages[1]).toMatchObject({
      kind: 'reading',
      displayMode: 'readable',
      nodeIds: ['n2', 'n3'],
      anchorNodeIds: [],
    });
  });

  it('没有有效锚点且没有新增内部边时跳过结构揭示', () => {
    const stages = buildTwoStageAutoTourStages({
      seed: seed(['n2'], ['n9']),
      flowNodes: [node('n2', 260, 0, '孤立新增'), node('n9', 0, 0, '无关旧节点')],
      flowEdges: [],
      containerWidth: 960,
      containerHeight: 720,
      currentZoom: 1,
      minReadableZoom: 1,
    });

    expect(stages).toHaveLength(1);
    expect(stages[0]).toMatchObject({
      kind: 'reading',
      displayMode: 'readable',
      nodeIds: ['n2'],
      anchorNodeIds: [],
    });
  });

  it('没有旧锚点但新增节点内部有边时仍生成结构揭示', () => {
    const stages = buildTwoStageAutoTourStages({
      seed: seed(['q1', 'p1', 'p2']),
      flowNodes: [
        node('q1', 0, 0, '问题'),
        node('p1', 260, 0, '小点一'),
        node('p2', 260, 168, '小点二'),
      ],
      flowEdges: [edge('e1', 'q1', 'p1'), edge('e2', 'q1', 'p2')],
      containerWidth: 960,
      containerHeight: 720,
      currentZoom: 1,
      minReadableZoom: 1,
    });

    expect(stages[0]).toMatchObject({
      kind: 'structure',
      displayMode: 'compact',
      nodeIds: ['q1', 'p1', 'p2'],
      anchorNodeIds: [],
    });
  });

  it('阅读阶段根据最小可读缩放拆成多个批次', () => {
    const stages = buildTwoStageAutoTourStages({
      seed: seed(['n1', 'n2', 'n3']),
      flowNodes: [
        node('n1', 0, 0, '新增节点 1'),
        node('n2', 0, 168, '新增节点 2'),
        node('n3', 0, 336, '新增节点 3'),
      ],
      flowEdges: [],
      containerWidth: 260,
      containerHeight: 180,
      currentZoom: 1,
      minReadableZoom: 1,
    });

    expect(stages.map((stage) => stage.kind)).toEqual(['reading', 'reading', 'reading']);
    expect(stages.map((stage) => stage.nodeIds)).toEqual([['n1'], ['n2'], ['n3']]);
  });
});
```

- [ ] **Step 3: Run the new utility tests and verify failure**

Run:

```bash
pnpm --filter extension test:run src/sidepanel/auto-tour-utils.test.ts
```

Expected: FAIL because `buildTwoStageAutoTourStages`, `getValidAutoTourAnchorNodeIds`, and `hasVisibleAddedInternalEdge` do not exist yet.

- [ ] **Step 4: Add utility implementations**

In `apps/extension/src/sidepanel/auto-tour-utils.ts`, update the import from `./types`:

```ts
import type {
  ViewBounds,
  AutoTourSeed,
  AutoTourBatch,
  AutoTourStage,
} from './types';
```

Then add these functions after `buildAutoTourBatches`:

```ts
export function getValidAutoTourAnchorNodeIds(params: {
  addedNodeIds: string[];
  candidateAnchorNodeIds: string[];
  flowEdges: Edge[];
}) {
  const addedNodeSet = new Set(params.addedNodeIds);
  const candidateAnchorSet = new Set(params.candidateAnchorNodeIds);
  const validAnchors = new Set<string>();

  for (const edge of params.flowEdges) {
    if (addedNodeSet.has(edge.source) && candidateAnchorSet.has(edge.target)) {
      validAnchors.add(edge.target);
    }
    if (addedNodeSet.has(edge.target) && candidateAnchorSet.has(edge.source)) {
      validAnchors.add(edge.source);
    }
  }

  return params.candidateAnchorNodeIds.filter((nodeId) => validAnchors.has(nodeId));
}

export function hasVisibleAddedInternalEdge(params: {
  addedNodeIds: string[];
  flowEdges: Edge[];
}) {
  const addedNodeSet = new Set(params.addedNodeIds);
  return params.flowEdges.some(
    (edge) => addedNodeSet.has(edge.source) && addedNodeSet.has(edge.target),
  );
}

export function buildTwoStageAutoTourStages(params: {
  seed: AutoTourSeed;
  flowNodes: Node[];
  flowEdges: Edge[];
  containerWidth: number;
  containerHeight: number;
  currentZoom: number;
  minReadableZoom: number;
}) {
  const validAnchorNodeIds = getValidAutoTourAnchorNodeIds({
    addedNodeIds: params.seed.nodeIds,
    candidateAnchorNodeIds: params.seed.anchorNodeIds,
    flowEdges: params.flowEdges,
  });

  const hasInternalEdges = hasVisibleAddedInternalEdge({
    addedNodeIds: params.seed.nodeIds,
    flowEdges: params.flowEdges,
  });

  const stages: AutoTourStage[] = [];
  if (validAnchorNodeIds.length > 0 || hasInternalEdges) {
    stages.push({
      kind: 'structure',
      displayMode: 'compact',
      nodeIds: params.seed.nodeIds,
      anchorNodeIds: validAnchorNodeIds,
      dwellMs: estimateAutoTourDwellMs({
        nodeCount: params.seed.nodeIds.length + validAnchorNodeIds.length,
        edgeCount: params.flowEdges.filter(
          (edge) => {
            const nodeIds = new Set([...params.seed.nodeIds, ...validAnchorNodeIds]);
            return nodeIds.has(edge.source) && nodeIds.has(edge.target);
          },
        ).length,
        charCount: 0,
      }),
    });
  }

  const readingBatches = buildAutoTourBatches({
    seed: {
      ...params.seed,
      anchorNodeIds: [],
    },
    flowNodes: params.flowNodes,
    flowEdges: params.flowEdges,
    containerWidth: params.containerWidth,
    containerHeight: params.containerHeight,
    currentZoom: params.currentZoom,
    minReadableZoom: params.minReadableZoom,
  });

  stages.push(
    ...readingBatches.map((batch): AutoTourStage => ({
      ...batch,
      anchorNodeIds: [],
      kind: 'reading',
      displayMode: 'readable',
    })),
  );

  return stages;
}
```

- [ ] **Step 5: Update `buildAutoTourBatches` to accept `minReadableZoom`**

In `apps/extension/src/sidepanel/auto-tour-utils.ts`, add the parameter to the function signature:

```ts
export function buildAutoTourBatches(params: {
  seed: AutoTourSeed;
  flowNodes: Node[];
  flowEdges: Edge[];
  containerWidth: number;
  containerHeight: number;
  currentZoom: number;
  minReadableZoom?: number;
}) {
```

Then change the readable minimum zoom inside `canFitReadably`:

```ts
const configuredMinReadableZoom =
  typeof params.minReadableZoom === 'number' && params.minReadableZoom > 0
    ? params.minReadableZoom
    : AUTO_TOUR_ABSOLUTE_READABLE_ZOOM;
const allowedMinZoom = Math.max(
  configuredMinReadableZoom,
  effectiveCurrentZoom * relativeRatio,
);
```

- [ ] **Step 6: Run utility tests**

Run:

```bash
pnpm --filter extension test:run src/sidepanel/auto-tour-utils.test.ts
```

Expected: PASS.

---

### Task 2: Add Compact And Readable Node Display Modes

**Files:**
- Modify: `apps/extension/src/sidepanel/types.ts`
- Modify: `apps/extension/src/sidepanel/GraphNodeCard.tsx`
- Modify: `apps/extension/src/sidepanel/__test-helpers__/app-test-helpers.tsx`
- Test: `apps/extension/src/sidepanel/App.graph-updates.test.tsx`

- [ ] **Step 1: Extend node data types**

In `apps/extension/src/sidepanel/types.ts`, update `ReactFlowDebugNodeData`:

```ts
export type ReactFlowDebugNodeData = {
  label: string;
  nodeType: string;
  speaker?: string;
  timestampMs: number;
  status: 'draft' | 'confirmed';
  isActive: boolean;
  displayMode?: AutoTourDisplayMode;
  isTourAnchor?: boolean;
  isTourAdded?: boolean;
};
```

Update `GraphNodeData` the same way:

```ts
export interface GraphNodeData {
  label: string;
  nodeType: string;
  speaker?: string;
  timestampMs: number;
  status: 'draft' | 'confirmed';
  isActive: boolean;
  displayMode?: AutoTourDisplayMode;
  isTourAnchor?: boolean;
  isTourAdded?: boolean;
  onClickTime: (ms: number) => void;
}
```

- [ ] **Step 2: Add a failing compact-mode assertion**

In `apps/extension/src/sidepanel/App.graph-updates.test.tsx`, add a focused rendering test near the handle/node rendering tests:

```ts
it('结构揭示阶段会用 compact 节点样式并弱化锚点', async () => {
  const listeners: Array<(message: { type?: string; target?: string; payload?: Record<string, unknown> }) => void> = [];
  (globalThis as any).chrome.runtime.onMessage.addListener.mockImplementation(
    (listener: (message: { type?: string; target?: string; payload?: Record<string, unknown> }) => void) => {
      listeners.push(listener);
    },
  );
  (globalThis as any).chrome.runtime.sendMessage.mockImplementation(
    (message: { type?: string }) => {
      if (message?.type === 'GET_RUNTIME_SNAPSHOT') {
        return Promise.resolve({
          success: true,
          snapshot: {
            sessionId: 'session_compact_nodes',
            state: 'capturing',
            currentTimeMs: 0,
            currentView: 'causal',
            currentViewPinned: true,
            graph: {
              sessionId: 'session_compact_nodes',
              revision: 1,
              topics: [],
              nodes: [
                {
                  id: 'n1',
                  type: 'claim',
                  text: '旧锚点',
                  timestampMs: 0,
                  status: 'confirmed',
                },
              ],
              edges: [],
              updatedAt: 100,
            },
          },
        });
      }
      return Promise.resolve({ success: true });
    },
  );

  await renderApp();

  await act(async () => {
    listeners[0]?.({
      type: 'MERGED_GRAPH_UPDATED',
      target: 'sidepanel',
      payload: {
        graph: {
          sessionId: 'session_compact_nodes',
          revision: 2,
          topics: [],
          nodes: [
            {
              id: 'n1',
              type: 'claim',
              text: '旧锚点',
              timestampMs: 0,
              status: 'confirmed',
            },
            {
              id: 'n2',
              type: 'reason',
              text: '新增原因节点，它应该在结构揭示阶段用更紧凑的展示方式',
              timestampMs: 1000,
              status: 'confirmed',
            },
          ],
          edges: [{ id: 'e1', source: 'n1', target: 'n2', type: 'supports' }],
          updatedAt: 200,
        },
      },
    });
    await Promise.resolve();
  });

  await waitFor(() =>
    expect(screen.getByTestId('graph-node-card-n2')).toHaveAttribute('data-display-mode', 'compact'),
  );
  expect(screen.getByTestId('graph-node-card-n1')).toHaveAttribute('data-tour-anchor', 'true');
});
```

- [ ] **Step 3: Run the focused test and verify failure**

Run:

```bash
pnpm --filter extension test:run src/sidepanel/App.graph-updates.test.tsx -t "结构揭示阶段会用 compact 节点样式并弱化锚点"
```

Expected: FAIL because graph nodes do not expose `data-display-mode` or tour membership yet.

- [ ] **Step 4: Render compact/readable variants**

In `apps/extension/src/sidepanel/GraphNodeCard.tsx`, update the destructuring:

```ts
const {
  id,
  label,
  nodeType,
  speaker,
  timestampMs,
  status,
  isActive,
  displayMode = 'readable',
  isTourAnchor = false,
  isTourAdded = false,
  onClickTime,
} = data;
```

Add derived values before `return`:

```ts
const isCompact = displayMode === 'compact';
const displayLabel = isCompact && label.length > 56
  ? `${label.slice(0, 54)}…`
  : label;
```

Update the root `<div>` attributes and styles:

```tsx
<div
  data-testid={`graph-node-card-${id}`}
  data-display-mode={displayMode}
  data-tour-anchor={isTourAnchor ? 'true' : 'false'}
  data-tour-added={isTourAdded ? 'true' : 'false'}
  style={{
    padding: isCompact ? '6px 8px' : '10px 12px',
    borderRadius: 6,
    border: `2px solid ${isActive || isTourAdded ? '#f59e0b' : color}`,
    backgroundColor: isActive || isTourAdded ? '#fffbeb' : '#ffffff',
    boxShadow: isActive || isTourAdded
      ? '0 0 8px rgba(245, 158, 11, 0.4)'
      : '0 1px 4px rgba(0,0,0,0.1)',
    minWidth: isCompact ? 112 : 140,
    maxWidth: isCompact ? 168 : 200,
    opacity: status === 'draft' ? 0.6 : isTourAnchor ? 0.72 : 1,
    transition: 'all 0.2s ease',
  }}
>
```

Because `GraphNodeData` currently lacks `id`, add `id` to the type in `types.ts` and pass it in Task 3:

```ts
id: string;
```

to both node data types.

Update the label block:

```tsx
<div
  style={{
    fontSize: isCompact ? 11 : 12,
    lineHeight: isCompact ? 1.25 : 1.3,
    marginBottom: isCompact ? 4 : 6,
    display: '-webkit-box',
    WebkitLineClamp: isCompact ? 2 : 3,
    WebkitBoxOrient: 'vertical',
    overflow: 'hidden',
  }}
>
  {displayLabel}
</div>
```

Keep the time button visible in compact mode, but make the footer smaller:

```tsx
fontSize: isCompact ? 9 : 10,
```

- [ ] **Step 5: Make the React Flow mock expose display mode**

In `apps/extension/src/sidepanel/__test-helpers__/app-test-helpers.tsx`, update the test mock node data type:

```ts
data?: {
  label?: string;
  timestampMs?: number;
  displayMode?: string;
  isTourAnchor?: boolean;
  isTourAdded?: boolean;
};
```

Update the mocked node `<button>`:

```tsx
data-node-display-mode={node.data?.displayMode ?? ''}
data-node-tour-anchor={node.data?.isTourAnchor ? 'true' : 'false'}
data-node-tour-added={node.data?.isTourAdded ? 'true' : 'false'}
```

- [ ] **Step 6: Run the focused compact test**

Run:

```bash
pnpm --filter extension test:run src/sidepanel/App.graph-updates.test.tsx -t "结构揭示阶段会用 compact 节点样式并弱化锚点"
```

Expected: It may still fail until Task 3 passes active stage data from the hook into nodes. Keep the failing test as the guide for Task 3.

---

### Task 3: Queue And Play Two-Stage Auto-Tour Units

**Files:**
- Modify: `apps/extension/src/sidepanel/constants.ts`
- Modify: `apps/extension/src/sidepanel/hooks/useAutoTour.ts`
- Modify: `apps/extension/src/sidepanel/App.tsx`
- Test: `apps/extension/src/sidepanel/App.graph-updates.test.tsx`

- [ ] **Step 1: Update auto-tour timing constants**

In `apps/extension/src/sidepanel/constants.ts`, change:

```ts
export const AUTO_TOUR_RESUME_DELAY_MS = 3000;
```

to:

```ts
export const AUTO_TOUR_RESUME_DELAY_MS = 7000;
export const AUTO_TOUR_STRUCTURE_DWELL_MS = 1200;
```

- [ ] **Step 2: Add a failing two-stage playback test**

In `apps/extension/src/sidepanel/App.graph-updates.test.tsx`, update or add a test near the existing `"新增节点更新时会使用动画 fitBounds 跟随新区域"` test:

```ts
it('有有效锚点的图更新会先结构揭示再阅读聚焦', async () => {
  vi.useFakeTimers();
  const listeners: Array<(message: { type?: string; target?: string; payload?: Record<string, unknown> }) => void> = [];
  (globalThis as any).chrome.runtime.onMessage.addListener.mockImplementation(
    (listener: (message: { type?: string; target?: string; payload?: Record<string, unknown> }) => void) => {
      listeners.push(listener);
    },
  );
  (globalThis as any).chrome.runtime.sendMessage.mockImplementation(
    (message: { type?: string }) => {
      if (message?.type === 'GET_RUNTIME_SNAPSHOT') {
        return Promise.resolve({
          success: true,
          snapshot: {
            sessionId: 'session_two_stage',
            state: 'capturing',
            currentTimeMs: 0,
            currentView: 'causal',
            currentViewPinned: true,
            graph: {
              sessionId: 'session_two_stage',
              revision: 1,
              topics: [],
              nodes: [
                {
                  id: 'n1',
                  type: 'claim',
                  text: '旧观点',
                  timestampMs: 0,
                  status: 'confirmed',
                },
              ],
              edges: [],
              updatedAt: 100,
            },
          },
        });
      }
      return Promise.resolve({ success: true });
    },
  );

  await renderApp();

  await act(async () => {
    listeners[0]?.({
      type: 'MERGED_GRAPH_UPDATED',
      target: 'sidepanel',
      payload: {
        graph: {
          sessionId: 'session_two_stage',
          revision: 2,
          topics: [],
          nodes: [
            {
              id: 'n1',
              type: 'claim',
              text: '旧观点',
              timestampMs: 0,
              status: 'confirmed',
            },
            {
              id: 'n2',
              type: 'reason',
              text: '新增理由',
              timestampMs: 1000,
              status: 'confirmed',
            },
          ],
          edges: [{ id: 'e1', source: 'n1', target: 'n2', type: 'supports' }],
          updatedAt: 200,
        },
      },
    });
    await Promise.resolve();
  });

  await waitFor(() => expect(reactFlowFitBoundsSpy).toHaveBeenCalledTimes(1));
  expect(screen.getByTestId('auto-tour-status')).toHaveTextContent(/自动导览 1\/2/);
  expect(screen.getByTestId('graph-node-card-n1')).toHaveAttribute('data-display-mode', 'compact');
  expect(screen.getByTestId('graph-node-card-n2')).toHaveAttribute('data-display-mode', 'compact');

  await act(async () => {
    vi.advanceTimersByTime(5000);
    await Promise.resolve();
  });

  expect(reactFlowFitBoundsSpy).toHaveBeenCalledTimes(2);
  expect(screen.getByTestId('auto-tour-status')).toHaveTextContent(/自动导览 2\/2/);
  expect(screen.getByTestId('graph-node-card-n2')).toHaveAttribute('data-display-mode', 'readable');
  expect(screen.getByTestId('graph-node-card-n1')).not.toHaveAttribute('data-tour-anchor', 'true');
});
```

- [ ] **Step 3: Run the two-stage test and verify failure**

Run:

```bash
pnpm --filter extension test:run src/sidepanel/App.graph-updates.test.tsx -t "有有效锚点的图更新会先结构揭示再阅读聚焦"
```

Expected: FAIL because the hook still plays one stage and does not expose active stage display mode.

- [ ] **Step 4: Update `useAutoTour` state and refs**

In `apps/extension/src/sidepanel/hooks/useAutoTour.ts`, import new types and utility:

```ts
import type {
  AutoTourSeed,
  AutoTourStage,
  AutoTourStatus,
  DebugViewArtifact,
} from '../types';
import {
  buildTwoStageAutoTourStages,
  getNodeBounds,
  mergeViewBounds,
  expandViewBounds,
  ensureMinimumBoundsSize,
  getAutoRevealMinimumBoundsSize,
  isViewportCloseToTarget,
} from '../auto-tour-utils';
```

Update `UseAutoTourOptions`:

```ts
  autoFitMinReadableFontPx: number;
  graphNodeBodyFontPx: number;
```

Add state and refs near existing tour state:

```ts
const [activeAutoTourStage, setActiveAutoTourStage] =
  useState<AutoTourStage | null>(null);
const autoTourQueueRef = useRef<AutoTourStage[][]>([]);
```

Keep `autoTourBatchesRef` initially, but change its type to stages:

```ts
const autoTourBatchesRef = useRef<AutoTourStage[]>([]);
```

- [ ] **Step 5: Make target bounds use stage data**

Rename the parameter in `buildAutoTourTargetBounds` from `batch: AutoTourBatch` to `stage: AutoTourStage`, and update the node id set:

```ts
const nodeIds = new Set([...stage.nodeIds, ...stage.anchorNodeIds]);
```

Keep the existing bounds and `getViewportForBounds` flow.

- [ ] **Step 6: Play stages and expose active stage**

Inside `playAutoTourBatch`, replace references to `batch` with `stage`, and set active stage:

```ts
const stage = autoTourBatchesRef.current[index];
if (!stage) {
  setActiveAutoTourStage(null);
  setAutoTourStatus('idle');
  const nextUnit = autoTourQueueRef.current.shift();
  if (nextUnit) {
    autoTourBatchesRef.current = nextUnit;
    autoTourCurrentIndexRef.current = -1;
    autoTourResumeIndexRef.current = 0;
    playAutoTourBatch(0);
  }
  return;
}

setActiveAutoTourStage(stage);
```

Update the timer duration:

```ts
}, AUTO_REVEAL_DURATION_MS + stage.dwellMs);
```

When the final stage completes, clear `activeAutoTourStage` before starting the next queued unit:

```ts
if (nextIndex >= autoTourBatchesRef.current.length) {
  clearAutoTourAdvanceTimer();
  setActiveAutoTourStage(null);
  const nextUnit = autoTourQueueRef.current.shift();
  if (nextUnit) {
    autoTourBatchesRef.current = nextUnit;
    autoTourCurrentIndexRef.current = -1;
    autoTourResumeIndexRef.current = 0;
    playAutoTourBatch(0);
    return;
  }
  setAutoTourStatus('idle');
  return;
}
```

- [ ] **Step 7: Build stages in `maybeStartAutoTour`**

In `maybeStartAutoTour`, replace the existing `buildAutoTourBatches` call with:

```ts
const minReadableZoom = graphNodeBodyFontPx > 0
  ? autoFitMinReadableFontPx / graphNodeBodyFontPx
  : 1;

const stages = buildTwoStageAutoTourStages({
  seed: pending,
  flowNodes: artifactsForView.reactFlow.nodes,
  flowEdges: flowEdgesRef.current,
  containerWidth: el.clientWidth ?? 0,
  containerHeight: el.clientHeight ?? 0,
  currentZoom: inst.getViewport().zoom || 1,
  minReadableZoom,
});
if (stages.length === 0) {
  pendingAutoTourRef.current = null;
  return;
}
```

This assumes `autoFitMinReadableFontPx` and `graphNodeBodyFontPx` are destructured in the `useAutoTour` function signature.

Set the stages:

```ts
autoTourBatchesRef.current = stages;
```

Keep the close-to-target shortcut only when `stages.length === 1` and the first target is close.

- [ ] **Step 8: Queue additional updates rather than overwrite them**

Update `setAutoTourSeed`:

```ts
const setAutoTourSeed = useCallback(
  (seed: AutoTourSeed | null) => {
    if (!seed) {
      clearAutoTourAdvanceTimer();
      clearAutoTourResumeTimer();
      autoTourQueueRef.current = [];
      autoTourBatchesRef.current = [];
      autoTourCurrentIndexRef.current = -1;
      autoTourResumeIndexRef.current = 0;
      pendingAutoTourRef.current = null;
      lastAutoTourKeyRef.current = null;
      setActiveAutoTourStage(null);
      setAutoTourStatus('idle');
      setAutoTourProgress({ current: 0, total: 0 });
      return;
    }

    if (
      pendingAutoTourRef.current ||
      autoTourBatchesRef.current.length > 0 ||
      autoTourQueueRef.current.length > 0
    ) {
      // Store the seed until maybeStartAutoTour can resolve it against current layout artifacts.
      // The queue uses seeds here because React Flow positions are only reliable after render.
      pendingAutoTourRef.current = seed;
      return;
    }

    pendingAutoTourRef.current = seed;
    lastAutoTourKeyRef.current = null;
    setAutoTourStatus('idle');
    setAutoTourProgress({ current: 0, total: 0 });
  },
  [clearAutoTourAdvanceTimer, clearAutoTourResumeTimer],
);
```

If this seed-only queue proves insufficient during implementation, introduce `pendingAutoTourSeedsRef = useRef<AutoTourSeed[]>([])` and shift seeds one at a time in `maybeStartAutoTour`. Keep the behavior: updates are queued, not merged.

- [ ] **Step 9: Return active stage from the hook**

At the bottom of `useAutoTour`, add:

```ts
activeAutoTourStage,
```

to the returned object.

- [ ] **Step 10: Pass settings into `useAutoTour`**

In `apps/extension/src/sidepanel/App.tsx`, update the `useAutoTour` call:

```ts
  } = useAutoTour({
    graph: panel.graph,
    currentView,
    debugViewArtifactsRef,
    flowEdgesRef,
    flowContainerRef,
    reactFlowInstanceRef,
    autoFitMinReadableFontPx: graphDisplaySettings.autoFitMinReadableFontPx,
    graphNodeBodyFontPx: GRAPH_NODE_BODY_FONT_PX,
    onReset: resetLayoutCache,
  });
```

Destructure `activeAutoTourStage` from the hook return.

- [ ] **Step 11: Apply active stage metadata to nodes**

In `apps/extension/src/sidepanel/App.tsx`, update `flowNodes`:

```ts
const activeTourNodeIds = useMemo(
  () => new Set(activeAutoTourStage?.nodeIds ?? []),
  [activeAutoTourStage],
);
const activeTourAnchorIds = useMemo(
  () => new Set(activeAutoTourStage?.anchorNodeIds ?? []),
  [activeAutoTourStage],
);

const flowNodes = useMemo<Node[]>(
  () =>
    debugViewArtifacts[currentView].reactFlow.nodes.map((node) => {
      const isTourAdded = activeTourNodeIds.has(node.id);
      const isTourAnchor = activeTourAnchorIds.has(node.id);
      return {
        ...node,
        data: {
          ...node.data,
          id: node.id,
          onClickTime: handleTimeClick,
          displayMode: isTourAdded || isTourAnchor
            ? activeAutoTourStage?.displayMode ?? 'readable'
            : 'readable',
          isTourAdded,
          isTourAnchor,
        },
      };
    }),
  [
    activeAutoTourStage,
    activeTourAnchorIds,
    activeTourNodeIds,
    currentView,
    debugViewArtifacts,
    handleTimeClick,
  ],
);
```

- [ ] **Step 12: Run focused two-stage tests**

Run:

```bash
pnpm --filter extension test:run src/sidepanel/App.graph-updates.test.tsx -t "有有效锚点的图更新会先结构揭示再阅读聚焦"
pnpm --filter extension test:run src/sidepanel/App.graph-updates.test.tsx -t "结构揭示阶段会用 compact 节点样式并弱化锚点"
```

Expected: PASS.

---

### Task 4: Cover Skips, Queueing, And Resume Delay

**Files:**
- Modify: `apps/extension/src/sidepanel/App.graph-updates.test.tsx`
- Modify if needed: `apps/extension/src/sidepanel/hooks/useAutoTour.ts`
- Modify if needed: `apps/extension/src/sidepanel/auto-tour-utils.ts`

- [ ] **Step 1: Update the no-anchor behavior test**

Add this test to `apps/extension/src/sidepanel/App.graph-updates.test.tsx`:

```ts
it('无锚点且无新增内部边时跳过结构揭示直接阅读', async () => {
  vi.useFakeTimers();
  const listeners: Array<(message: { type?: string; target?: string; payload?: Record<string, unknown> }) => void> = [];
  (globalThis as any).chrome.runtime.onMessage.addListener.mockImplementation(
    (listener: (message: { type?: string; target?: string; payload?: Record<string, unknown> }) => void) => {
      listeners.push(listener);
    },
  );

  await renderApp();

  await act(async () => {
    listeners[0]?.({
      type: 'MERGED_GRAPH_UPDATED',
      target: 'sidepanel',
      payload: {
        graph: {
          sessionId: 'session_skip_structure',
          revision: 1,
          topics: [],
          nodes: [
            {
              id: 'n1',
              type: 'claim',
              text: '新话题孤立节点',
              timestampMs: 1000,
              status: 'confirmed',
            },
          ],
          edges: [],
          updatedAt: 200,
        },
      },
    });
    await Promise.resolve();
  });

  await waitFor(() => expect(reactFlowFitBoundsSpy).toHaveBeenCalledTimes(1));
  expect(screen.getByTestId('auto-tour-status')).toHaveTextContent(/自动导览 1\/1/);
  expect(screen.getByTestId('graph-node-card-n1')).toHaveAttribute('data-display-mode', 'readable');
});
```

- [ ] **Step 2: Add a queueing test**

Add this test to `apps/extension/src/sidepanel/App.graph-updates.test.tsx`:

```ts
it('连续图更新会排队播放而不是合并成一轮', async () => {
  vi.useFakeTimers();
  const listeners: Array<(message: { type?: string; target?: string; payload?: Record<string, unknown> }) => void> = [];
  (globalThis as any).chrome.runtime.onMessage.addListener.mockImplementation(
    (listener: (message: { type?: string; target?: string; payload?: Record<string, unknown> }) => void) => {
      listeners.push(listener);
    },
  );

  await renderApp();

  const graph1 = {
    sessionId: 'session_queue',
    revision: 1,
    topics: [],
    nodes: [
      { id: 'n1', type: 'claim', text: '第一轮新增', timestampMs: 1000, status: 'confirmed' },
    ],
    edges: [],
    updatedAt: 100,
  };
  const graph2 = {
    ...graph1,
    revision: 2,
    nodes: [
      ...graph1.nodes,
      { id: 'n2', type: 'reason', text: '第二轮新增', timestampMs: 2000, status: 'confirmed' },
    ],
    edges: [],
    updatedAt: 200,
  };

  await act(async () => {
    listeners[0]?.({
      type: 'MERGED_GRAPH_UPDATED',
      target: 'sidepanel',
      payload: { graph: graph1 },
    });
    listeners[0]?.({
      type: 'MERGED_GRAPH_UPDATED',
      target: 'sidepanel',
      payload: { graph: graph2 },
    });
    await Promise.resolve();
  });

  await waitFor(() => expect(reactFlowFitBoundsSpy).toHaveBeenCalledTimes(1));
  expect(screen.getByTestId('auto-tour-status')).toHaveTextContent(/自动导览 1\/1/);
  expect(screen.getByTestId('graph-node-card-n1')).toHaveAttribute('data-tour-added', 'true');

  await act(async () => {
    vi.advanceTimersByTime(7000);
    await Promise.resolve();
  });

  expect(reactFlowFitBoundsSpy).toHaveBeenCalledTimes(2);
  expect(screen.getByTestId('graph-node-card-n2')).toHaveAttribute('data-tour-added', 'true');
});
```

If TypeScript complains about inferred literal node type/status, cast the graph payloads as `MergedGraph` by importing `type { MergedGraph }` from `@listen-graphic/schema`.

- [ ] **Step 3: Update manual pause test to 7 seconds**

Find the existing test named:

```ts
it('用户刚手动移动画布后会暂停自动导览并在 3 秒后从下一段恢复', async () => {
```

Rename it:

```ts
it('用户刚手动移动画布后会暂停自动导览并在 7 秒后从下一段恢复', async () => {
```

Change the timer assertion from 3 seconds to 7 seconds:

```ts
await act(async () => {
  vi.advanceTimersByTime(6999);
  await Promise.resolve();
});
expect(screen.getByTestId('auto-tour-status')).toHaveTextContent(/导览暂停/);

await act(async () => {
  vi.advanceTimersByTime(1);
  await Promise.resolve();
});
expect(screen.getByTestId('auto-tour-status')).toHaveTextContent(/自动导览/);
```

- [ ] **Step 4: Run focused graph update tests**

Run:

```bash
pnpm --filter extension test:run src/sidepanel/App.graph-updates.test.tsx -t "无锚点且无新增内部边时跳过结构揭示直接阅读"
pnpm --filter extension test:run src/sidepanel/App.graph-updates.test.tsx -t "连续图更新会排队播放而不是合并成一轮"
pnpm --filter extension test:run src/sidepanel/App.graph-updates.test.tsx -t "用户刚手动移动画布后会暂停自动导览并在 7 秒后从下一段恢复"
```

Expected: PASS.

- [ ] **Step 5: Fix queue implementation if the queueing test fails**

If the queueing test fails because `pendingAutoTourRef` is overwritten, add this ref in `useAutoTour.ts`:

```ts
const pendingAutoTourSeedsRef = useRef<AutoTourSeed[]>([]);
```

Update `setAutoTourSeed` for non-null seeds:

```ts
pendingAutoTourSeedsRef.current.push(seed);
```

Then update `maybeStartAutoTour` to pull the next seed when no current pending seed exists:

```ts
const pending = pendingAutoTourRef.current ?? pendingAutoTourSeedsRef.current.shift() ?? null;
if (!pending) {
  return;
}
pendingAutoTourRef.current = pending;
```

When a stage unit finishes, call `maybeStartAutoTour()` after clearing the current stage so the next seed resolves against the latest layout.

---

### Task 5: Run The Sidepanel Verification Set

**Files:**
- No planned source edits unless verification exposes a failure.

- [ ] **Step 1: Run pure utility tests**

Run:

```bash
pnpm --filter extension test:run src/sidepanel/auto-tour-utils.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run graph update tests**

Run:

```bash
pnpm --filter extension test:run src/sidepanel/App.graph-updates.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Run settings tests because readable font settings are consumed**

Run:

```bash
pnpm --filter extension test:run src/sidepanel/App.settings.test.tsx
```

Expected: PASS.

- [ ] **Step 4: Run extension typecheck**

Run:

```bash
pnpm --filter extension typecheck
```

Expected: PASS.

- [ ] **Step 5: Review final diff**

Run:

```bash
git diff -- apps/extension/src/sidepanel docs/superpowers/specs/2026-05-19-two-stage-auto-tour-design.md docs/superpowers/plans/2026-05-19-two-stage-auto-tour.md
```

Expected: Diff only includes the two-stage auto-tour implementation, related tests, and the spec/plan docs.
