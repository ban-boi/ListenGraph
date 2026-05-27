# Graph Layout Fixtures Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a shared `@listen-graphic/graph-fixtures` package with revision sequences, a DEV-only Extension graph-state injector (`__listenGraphicFixture`, no product buttons), Vitest helpers, docs, and optional web-demo preview.

**Architecture:** JSON sequence fixtures live in `packages/graph-fixtures` with Zod validation and `computeStepPayload` (shared graph-diff). Extension arms a sequence via console/keyboard, dispatches `MERGED_GRAPH_UPDATED` identically to `useChromeMessages`, and resets UI refs through `FIXTURE_SEQUENCE_ARM` + `onFixtureLabReset`. web-demo loads the same JSON for topology-only preview (dagre).

**Tech Stack:** TypeScript, Zod, Vitest, Vite (`import.meta.env.DEV`), React 18, React Flow v11, pnpm workspace.

**Design spec:** `docs/superpowers/specs/2026-05-27-graph-layout-fixtures-design.md`

Do not commit unless the user explicitly asks for a commit.

---

## File Structure

| Path | Responsibility |
|------|----------------|
| `packages/graph-fixtures/package.json` | Workspace package |
| `packages/graph-fixtures/src/types.ts` | `SequenceFixture`, manifest types |
| `packages/graph-fixtures/src/schemas.ts` | Zod `MergedGraph` + sequence schemas |
| `packages/graph-fixtures/src/graph-diff.ts` | `getAddedNodeIds`, `getAutoRevealAnchorNodeIds` (moved from sidepanel) |
| `packages/graph-fixtures/src/compute-step-payload.ts` | `computeStepPayload` |
| `packages/graph-fixtures/src/load.ts` | Read manifest + JSON from disk |
| `packages/graph-fixtures/src/validate.ts` | `validateSequence`, `validateAllFixtures` |
| `packages/graph-fixtures/src/index.ts` | Public exports |
| `packages/graph-fixtures/scripts/write-fixtures.mjs` | Generate 3 committed sequence JSON files |
| `packages/graph-fixtures/fixtures/manifest.json` | `version: 1` index |
| `packages/graph-fixtures/fixtures/sequences/*.json` | Committed fixtures |
| `packages/graph-fixtures/src/validate.test.ts` | Package tests |
| `packages/graph-fixtures/src/compute-step-payload.test.ts` | Package tests |
| `tsconfig.base.json` | Add path `@listen-graphic/graph-fixtures` |
| `apps/extension/src/sidepanel/panel-reducer.ts` | `FIXTURE_SEQUENCE_ARM` actions |
| `apps/extension/src/sidepanel/panel-reducer.fixture.test.ts` | Reducer tests |
| `apps/extension/src/sidepanel/fixture-sequence-controller.ts` | DEV API + keyboard |
| `apps/extension/src/sidepanel/fixture-sequence-dev.ts` | `installFixtureSequenceDev` |
| `apps/extension/src/sidepanel/auto-tour-utils.ts` | Re-export diff from package |
| `apps/extension/src/sidepanel/App.tsx` | Wire DEV install + `onFixtureLabReset` |
| `apps/extension/src/sidepanel/graph-fixtures.test-helper.ts` | `playSequenceAndAssert` |
| `apps/extension/src/sidepanel/App.fixture-sequence.test.tsx` | Autofit regression |
| `apps/extension/src/sidepanel/fixture-build.prod.test.ts` | Prod bundle must not contain API string |
| `apps/web-demo/src/useGraphFixtureSequence.ts` | URL + arrow keys |
| `apps/web-demo/src/App.tsx` | Integrate hook |
| `docs/testing/graph-layout-fixtures.md` | Operator guide |

---

## Task 1: Scaffold `@listen-graphic/graph-fixtures`

**Files:**
- Create: `packages/graph-fixtures/package.json`
- Create: `packages/graph-fixtures/tsconfig.json`
- Modify: `tsconfig.base.json`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "@listen-graphic/graph-fixtures",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "lint": "eslint src --ext .ts",
    "test": "vitest run",
    "test:run": "vitest run",
    "write-fixtures": "node ./scripts/write-fixtures.mjs"
  },
  "dependencies": {
    "@listen-graphic/schema": "workspace:*",
    "zod": "^3.0.0"
  },
  "devDependencies": {
    "vitest": "^1.6.0"
  }
}
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Add path alias**

In `tsconfig.base.json` `paths`:

```json
"@listen-graphic/graph-fixtures": ["packages/graph-fixtures/src"]
```

- [ ] **Step 4: Verify workspace resolves**

Run:

```bash
pnpm install
pnpm --filter @listen-graphic/graph-fixtures typecheck
```

Expected: PASS (empty `src/index.ts` exporting `{}` is fine temporarily).

- [ ] **Step 5: Commit (if user requested)**

```bash
git add packages/graph-fixtures tsconfig.base.json pnpm-lock.yaml
git commit -m "feat(graph-fixtures): scaffold workspace package"
```

---

## Task 2: Zod schemas and graph-diff

**Files:**
- Create: `packages/graph-fixtures/src/schemas.ts`
- Create: `packages/graph-fixtures/src/graph-diff.ts`
- Create: `packages/graph-fixtures/src/types.ts`
- Create: `packages/graph-fixtures/src/compute-step-payload.test.ts`
- Create: `packages/graph-fixtures/vitest.config.ts`

- [ ] **Step 1: Write failing computeStepPayload test**

Create `packages/graph-fixtures/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
  },
});
```

Create `packages/graph-fixtures/src/compute-step-payload.test.ts`:

```ts
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
    const prev = base([{ id: 'n1', type: 'claim', text: 'a', timestampMs: 0, status: 'confirmed' }]);
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
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
pnpm --filter @listen-graphic/graph-fixtures test:run
```

Expected: FAIL — cannot resolve `./compute-step-payload`.

- [ ] **Step 3: Implement graph-diff + compute-step-payload**

`packages/graph-fixtures/src/graph-diff.ts` (copy logic from `apps/extension/src/sidepanel/auto-tour-utils.ts` lines 37–70, no React Flow imports):

```ts
import type { MergedGraph } from '@listen-graphic/schema';

export function getAddedNodeIds(previousGraph: MergedGraph | null, nextGraph: MergedGraph) {
  const previousNodeIds = new Set(previousGraph?.nodes.map((node) => node.id) ?? []);
  return nextGraph.nodes
    .filter((node) => !previousNodeIds.has(node.id))
    .map((node) => node.id);
}

export function getAutoRevealAnchorNodeIds(params: {
  addedNodeIds: string[];
  previousGraph: MergedGraph | null;
  nextGraph: MergedGraph;
}) {
  if (!params.addedNodeIds.length) return [];
  const previousNodeIds = new Set(params.previousGraph?.nodes.map((node) => node.id) ?? []);
  const addedNodeSet = new Set(params.addedNodeIds);
  const anchorIds = new Set<string>();
  for (const edge of params.nextGraph.edges) {
    if (addedNodeSet.has(edge.source) && previousNodeIds.has(edge.target)) anchorIds.add(edge.target);
    if (addedNodeSet.has(edge.target) && previousNodeIds.has(edge.source)) anchorIds.add(edge.source);
  }
  return Array.from(anchorIds);
}
```

`packages/graph-fixtures/src/compute-step-payload.ts`:

```ts
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
```

`packages/graph-fixtures/src/schemas.ts` — define `graphNodeSchema`, `graphEdgeSchema`, `mergedGraphSchema`, `sequenceFixtureSchema` matching spec §1 (required fields from `packages/schema/src/graph.ts`).

`packages/graph-fixtures/src/types.ts` — export `SequenceFixture`, `FixtureManifest`, `ManifestEntry`.

- [ ] **Step 4: Run test — expect PASS**

```bash
pnpm --filter @listen-graphic/graph-fixtures test:run
```

- [ ] **Step 5: Commit (if user requested)**

```bash
git add packages/graph-fixtures/src
git commit -m "feat(graph-fixtures): add graph diff and computeStepPayload"
```

---

## Task 3: validate.ts + load.ts + validate tests

**Files:**
- Create: `packages/graph-fixtures/src/validate.ts`
- Create: `packages/graph-fixtures/src/load.ts`
- Create: `packages/graph-fixtures/src/validate.test.ts`
- Create: `packages/graph-fixtures/src/index.ts`

- [ ] **Step 1: Write failing validateAllFixtures test**

`packages/graph-fixtures/src/validate.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { validateAllFixtures } from './validate';

describe('validateAllFixtures', () => {
  it('passes after fixtures are generated', () => {
    const report = validateAllFixtures();
    expect(report.ok, report.errors.join('\n')).toBe(true);
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (no manifest yet)

```bash
pnpm --filter @listen-graphic/graph-fixtures test:run src/validate.test.ts
```

- [ ] **Step 3: Implement validate.ts**

`validateSequence(fixture)` checks:

- Zod parse
- `steps.length >= 2`
- revision strictly increasing
- `sessionId` constant across steps
- node/edge id sets monotonic: `ids(step[i]) ⊆ ids(step[i+1])`

`validateAllFixtures()` reads `fixtures/manifest.json`, validates each listed sequence file.

`load.ts` uses `import.meta.url` + `path.dirname` + `fs.readFileSync` (Node) — same pattern as extension fixture loaders.

Export from `index.ts`:

```ts
export * from './types';
export * from './load';
export * from './validate';
export * from './compute-step-payload';
export * from './graph-diff';
```

- [ ] **Step 4: Run validate test — still FAIL until Task 4**

Expected until JSON exists.

- [ ] **Step 5: Commit (if user requested)**

---

## Task 4: Generate fixtures (manifest + 3 sequences)

**Files:**
- Create: `packages/graph-fixtures/scripts/write-fixtures.mjs`
- Create: `packages/graph-fixtures/fixtures/manifest.json`
- Create: `packages/graph-fixtures/fixtures/sequences/seq-incremental-growth.json`
- Create: `packages/graph-fixtures/fixtures/sequences/seq-late-burst.json`
- Create: `packages/graph-fixtures/fixtures/sequences/seq-view-switch-mid.json`

- [ ] **Step 1: Implement write-fixtures.mjs**

Script (Node ESM) should **programmatically** build:

1. **`seq-incremental-growth`**: 8 steps; start 2 nodes; each step add 2–3 nodes + edges in a chain/DAG; end ~20–24 nodes; `sessionId: fixture-seq-incremental-growth`; revisions `1..8`.
2. **`seq-late-burst`**: step 0–1: 0–1 nodes; steps 2–4: add ~15 nodes in one burst; revisions `1..5`.
3. **`seq-view-switch-mid`**: 6 steps; at step 3 set `viewHints.defaultView` to `timeline` (was `causal`); include `opposes` edge for comparison view stress.

Write `fixtures/manifest.json`:

```json
{
  "version": 1,
  "sequences": [
    {
      "id": "seq-incremental-growth",
      "file": "sequences/seq-incremental-growth.json",
      "tags": ["growth", "autofit"],
      "primaryView": "causal",
      "description": "8 steps, nodes grow 2→~24"
    },
    {
      "id": "seq-late-burst",
      "file": "sequences/seq-late-burst.json",
      "tags": ["burst", "auto-tour"],
      "primaryView": "causal",
      "description": "Late burst of ~15 nodes"
    },
    {
      "id": "seq-view-switch-mid",
      "file": "sequences/seq-view-switch-mid.json",
      "tags": ["view-switch"],
      "primaryView": "causal",
      "description": "Mid-sequence defaultView change"
    }
  ],
  "snapshots": []
}
```

- [ ] **Step 2: Run generator**

```bash
pnpm --filter @listen-graphic/graph-fixtures write-fixtures
```

- [ ] **Step 3: Run full package tests**

```bash
pnpm --filter @listen-graphic/graph-fixtures test:run
```

Expected: ALL PASS.

- [ ] **Step 4: Commit (if user requested)**

```bash
git add packages/graph-fixtures/fixtures packages/graph-fixtures/scripts
git commit -m "feat(graph-fixtures): add manifest and sequence fixtures"
```

**Step 1 checkpoint (spec §8):** package-only deliverable is done.

---

## Task 5: Refactor sidepanel to use package graph-diff

**Files:**
- Modify: `apps/extension/src/sidepanel/auto-tour-utils.ts`
- Modify: `apps/extension/package.json` (dependency)

- [ ] **Step 1: Add dependency**

In `apps/extension/package.json` `dependencies`:

```json
"@listen-graphic/graph-fixtures": "workspace:*"
```

Run `pnpm install`.

- [ ] **Step 2: Replace local implementations**

In `auto-tour-utils.ts`, remove local `getAddedNodeIds` / `getAutoRevealAnchorNodeIds` bodies; re-export:

```ts
export { getAddedNodeIds, getAutoRevealAnchorNodeIds } from '@listen-graphic/graph-fixtures';
```

- [ ] **Step 3: Run extension unit tests**

```bash
pnpm --filter extension test:run src/sidepanel/view-mapping.test.ts
pnpm --filter extension test:run src/sidepanel/App.graph-updates.test.tsx
```

Expected: PASS (no behavior change).

- [ ] **Step 4: Commit (if user requested)**

---

## Task 6: panel-reducer fixture actions

**Files:**
- Modify: `apps/extension/src/sidepanel/panel-reducer.ts`
- Create: `apps/extension/src/sidepanel/panel-reducer.fixture.test.ts`

- [ ] **Step 1: Write failing reducer test**

`panel-reducer.fixture.test.ts`:

```ts
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
```

- [ ] **Step 2: Run — expect FAIL**

```bash
pnpm --filter extension test:run src/sidepanel/panel-reducer.fixture.test.ts
```

- [ ] **Step 3: Add PanelAction variants and cases**

Extend `PanelAction`:

```ts
| {
    type: 'FIXTURE_SEQUENCE_ARM';
    payload: { sessionId: string; initialGraph: MergedGraph };
  }
| { type: 'FIXTURE_SEQUENCE_DISARM' }
```

`FIXTURE_SEQUENCE_ARM` case:

- `sessionId`, `graph` ← payload
- `sessionState: 'stopped'`
- `currentTimeMs: 0`, `selectedNodeId: null`
- Apply `RESET_RUNTIME_UI` field clears (timeline **keep** — fixture logs append later)

`FIXTURE_SEQUENCE_DISARM`: only clear a new optional `fixtureLabId: string | null` in state if added; or no-op on panel state (controller holds armed flag). Prefer **controller-owned `isArmed`**; reducer only handles ARM graph/session.

Add to `PanelState` if needed: `fixtureLabId: string | null` (default `null`) set on ARM, cleared on DISARM.

- [ ] **Step 4: Run test — PASS**

- [ ] **Step 5: Commit (if user requested)**

---

## Task 7: fixture-sequence-controller + DEV install

**Files:**
- Create: `apps/extension/src/sidepanel/fixture-sequence-controller.ts`
- Create: `apps/extension/src/sidepanel/fixture-sequence-dev.ts`
- Modify: `apps/extension/src/sidepanel/App.tsx`

- [ ] **Step 1: Implement controller types**

`fixture-sequence-controller.ts` exports:

```ts
export type FixtureLabDeps = {
  dispatch: React.Dispatch<PanelAction>;
  graphRef: React.MutableRefObject<MergedGraph>;
  addLog: (msg: string) => void;
  setAutoTourSeed: (seed: AutoTourSeed | null) => void;
  onFixtureLabReset: () => void;
};

export function createFixtureSequenceController(deps: FixtureLabDeps): ListenGraphicFixtureAPI;
```

Controller state: `{ armed: boolean; fixtureId: string | null; stepIndex: number; sequence: SequenceFixture | null }`.

**`arm(id)`:**

1. `loadSequence(id)` from package (bundle JSON via `?raw` import list or dynamic import map — use explicit imports in `fixture-sequence-dev.ts` for each sequence id to keep Vite predictable).
2. `deps.onFixtureLabReset()`
3. `dispatch FIXTURE_SEQUENCE_ARM` with `steps[0].graph`
4. `graphRef.current = steps[0].graph`
5. `stepIndex = 0`
6. Register `keydown` on `window`
7. `addLog('[fixture] armed …')`

**`next()`:**

- If `stepIndex + 1 >= steps.length` return `false`
- Increment index; call internal `deliverStep(steps[i].graph])` using `computeStepPayload` + `MERGED_GRAPH_UPDATED` + `setAutoTourSeed` when `addedNodeIds.length > 0`
- `addLog('[fixture] id step/total | rev=… | nodes=…')`
- return `true`

**`prev()`:** decrease index, deliver that graph (allow shrink — tests layout regen).

**`reset()`:** `onFixtureLabReset()` + re-`arm` same id (or set index 0 + deliver step 0).

**`disarm()`:** remove listener; `armed = false`.

Keyboard handler: skip if `event.target` is `HTMLInputElement` / `HTMLTextAreaElement`.

- [ ] **Step 2: fixture-sequence-dev.ts**

```ts
import seqIncremental from '@listen-graphic/graph-fixtures/fixtures/sequences/seq-incremental-growth.json';
// … register map id → fixture

export function installFixtureSequenceDev(deps: FixtureLabDeps) {
  if (!import.meta.env.DEV) return;
  globalThis.__listenGraphicFixture = createFixtureSequenceController(deps);
}
```

Add `src/vite-env.d.ts` augmentation:

```ts
interface ListenGraphicFixtureAPI { /* … */ }
declare global {
  interface GlobalThis {
    __listenGraphicFixture?: ListenGraphicFixtureAPI;
  }
}
```

**Vite note:** For JSON imports from another package, add alias in `apps/extension/vite.config.ts` or import from relative path `../../../packages/graph-fixtures/fixtures/...` in dev module only.

- [ ] **Step 3: Wire App.tsx**

After `useAutoTour` / `resetLayoutCache` definitions:

```ts
const onFixtureLabReset = useCallback(() => {
  resetLayoutCache();
  hasAutoFitRef.current = false;
  resetAutoTourState();
  lastUserViewportChangeAtRef.current = 0;
  userPinnedViewRef.current = false;
}, [resetLayoutCache, resetAutoTourState]);

useEffect(() => {
  if (!import.meta.env.DEV) return;
  const { installFixtureSequenceDev } = await import('./fixture-sequence-dev');
  installFixtureSequenceDev({ dispatch, graphRef, addLog, setAutoTourSeed, onFixtureLabReset });
  return () => {
    globalThis.__listenGraphicFixture?.disarm();
    delete globalThis.__listenGraphicFixture;
  };
}, [dispatch, addLog, setAutoTourSeed, onFixtureLabReset]);
```

Use static `import('./fixture-sequence-dev')` only inside `if (import.meta.env.DEV)` branch; verify prod build strips it.

- [ ] **Step 4: Manual DEV smoke**

```bash
pnpm dev:ext
```

Open sidepanel → DevTools console:

```js
__listenGraphicFixture.list()
__listenGraphicFixture.arm('seq-incremental-growth')
__listenGraphicFixture.status() // isArmed: true
__listenGraphicFixture.next()
```

Press `]` repeatedly; confirm LogPanel lines and graph growth; first step autofits, later steps do not re-fit without force.

- [ ] **Step 5: Commit (if user requested)**

**Step 2 checkpoint (spec §8):** DEV injector done.

---

## Task 8: Production bundle guard test

**Files:**
- Create: `apps/extension/src/sidepanel/fixture-build.prod.test.ts`

- [ ] **Step 1: Write test**

```ts
import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('production sidepanel bundle', () => {
  it('does not ship __listenGraphicFixture', () => {
    const bundlePath = path.resolve(__dirname, '../../dist/sidepanel/sidepanel.js');
    const code = fs.readFileSync(bundlePath, 'utf-8');
    expect(code).not.toContain('__listenGraphicFixture');
  });
});
```

- [ ] **Step 2: Build and run**

```bash
pnpm --filter extension build
pnpm --filter extension test:run src/sidepanel/fixture-build.prod.test.ts
```

Expected: PASS.

If FAIL: ensure `fixture-sequence-dev.ts` is only dynamic-imported under `import.meta.env.DEV` and Vite dead-code-eliminates it.

- [ ] **Step 3: Commit (if user requested)**

---

## Task 9: Vitest `playSequenceAndAssert`

**Files:**
- Create: `apps/extension/src/sidepanel/graph-fixtures.test-helper.ts`
- Create: `apps/extension/src/sidepanel/App.fixture-sequence.test.tsx`

- [ ] **Step 1: Write failing autofit test**

`App.fixture-sequence.test.tsx`:

```ts
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { playSequenceAndAssert } from './graph-fixtures.test-helper';
import { reactFlowFitViewSpy } from './__test-helpers__/app-test-helpers';

describe('Fixture sequence lab', () => {
  beforeEach(() => {
    reactFlowFitViewSpy.mockClear();
  });

  it('seq-incremental-growth: fitView only on first step with nodes', async () => {
    await playSequenceAndAssert({
      fixtureId: 'seq-incremental-growth',
      assertions: [
        { afterStep: 0, expectFitViewCalls: 1 },
        { afterStep: 3, expectFitViewCalls: 1 },
      ],
    });
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
pnpm --filter extension test:run src/sidepanel/App.fixture-sequence.test.tsx
```

- [ ] **Step 3: Implement helper**

`graph-fixtures.test-helper.ts`:

- Import `loadSequence`, `computeStepPayload` from `@listen-graphic/graph-fixtures`
- Import `renderApp`, `triggerDeferredReactFlowInit`, `reactFlowFitViewSpy` from `app-test-helpers` (only inside helper file)
- `playSequenceAndAssert({ fixtureId, assertions })`:
  - `renderApp()`
  - `triggerDeferredReactFlowInit()`
  - Loop steps: dispatch `MERGED_GRAPH_UPDATED` mirroring controller
  - `await act` + `vi.runOnlyPendingTimersAsync()` as needed
  - After each `afterStep`, `expect(reactFlowFitViewSpy.mock.calls.length).toBe(expectFitViewCalls)`

- [ ] **Step 4: Run — PASS**

```bash
pnpm --filter extension test:run src/sidepanel/App.fixture-sequence.test.tsx
```

- [ ] **Step 5: Commit (if user requested)**

**Step 3 checkpoint (spec §8):** automation done.

---

## Task 10: Documentation

**Files:**
- Create: `docs/testing/graph-layout-fixtures.md`
- Modify: `docs/testing/README.md` (link)

- [ ] **Step 1: Write operator guide**

Include:

- Prerequisites: `pnpm dev:ext`, open sidepanel DevTools
- Console API table (`arm`, `next`, `status`, `disarm`)
- Keyboard: `]` `[` `Esc` (sidepanel focused)
- Recipe: arm → wait autofit → zoom out manually → `next` × 3 → observe no re-fit
- **web-demo boundary** (verbatim spec §5 quote)
- Playwright example on **sidepanel** page `evaluate`
- vs `test:ext:replay` / mock E2E table

- [ ] **Step 2: Link from testing README**

- [ ] **Step 3: Commit (if user requested)**

---

## Task 11: web-demo sequence preview

**Files:**
- Modify: `apps/web-demo/package.json`
- Create: `apps/web-demo/src/useGraphFixtureSequence.ts`
- Modify: `apps/web-demo/src/App.tsx`
- Delete or thin: `apps/web-demo/src/mock-session.ts` (re-export snapshot from package later — optional v1 skip)

- [ ] **Step 1: Add dependency**

```json
"@listen-graphic/graph-fixtures": "workspace:*"
```

- [ ] **Step 2: Implement hook**

`useGraphFixtureSequence.ts`:

- Parse `new URLSearchParams(location.search).get('sequence')`
- `loadSequence(id)` on mount
- `stepIndex` state; `ArrowRight` / `ArrowLeft` on `window` keydown
- Return `{ graph, stepIndex, total, sequenceId }`

- [ ] **Step 3: Integrate App.tsx**

When `sequence` query present: use hook graph instead of capturing simulation; show subtitle `sequence step 3/8` in existing header area (web-demo only — not extension).

- [ ] **Step 4: Manual smoke**

```bash
pnpm dev:web
# open http://localhost:5173/?sequence=seq-incremental-growth
```

Arrow keys change node count in header/log.

- [ ] **Step 5: Commit (if user requested)**

---

## Spec Self-Review (plan author checklist)

| Spec requirement | Task |
|------------------|------|
| `@listen-graphic/graph-fixtures` + manifest v1 | 1–4 |
| Zod + monotonic validation | 2–3 |
| 3 sequences | 4 |
| `computeStepPayload` shared | 2, 5 |
| DEV `__listenGraphicFixture` on sidepanel window | 7 |
| No product buttons | 7 (no Overflow changes) |
| LogPanel feedback | 7 |
| Keyboard sidepanel-only | 7 |
| `FIXTURE_SEQUENCE_ARM` + `onFixtureLabReset` | 6–7 |
| Prod strip fixture API | 8 |
| `playSequenceAndAssert` | 9 |
| docs + web-demo boundary | 10–11 |
| Playwright note | 10 |
| `status().isArmed` | 7 |
| No sequence-delta v1 | — (deferred) |
| snapshots / mock-session migrate | Optional post-v1 |

No TBD placeholders remain in task steps.

---

## Final Verification

```bash
pnpm --filter @listen-graphic/graph-fixtures test:run
pnpm --filter extension test:run src/sidepanel/panel-reducer.fixture.test.ts
pnpm --filter extension test:run src/sidepanel/App.fixture-sequence.test.tsx
pnpm --filter extension build
pnpm --filter extension test:run src/sidepanel/fixture-build.prod.test.ts
pnpm typecheck
```

Manual: DEV console `arm` + `]` on `seq-incremental-growth`.

---

## Execution Handoff

Plan saved to `docs/superpowers/plans/2026-05-27-graph-layout-fixtures.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — one fresh subagent per task, review between tasks  
2. **Inline Execution** — run tasks in this session with `executing-plans`, batch checkpoints after Task 4 / 7 / 9  

Which approach do you want?
