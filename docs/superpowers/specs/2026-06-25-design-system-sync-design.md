# Design System Sync Design

## Status

- Date: 2026-06-25
- Decision: approved from prototype handoff
- Prototype source: `C:\Users\finni\Desktop\listen-graph-design-system`
- Production target: `C:\Users\finni\Desktop\ListenGraph`
- Scope: first production batch for shared UI atoms, pipeline status contract, extension runtime detail semantics, and design-contract documentation

## Goal

Translate the validated HTML + Babel prototype contract into production TypeScript without copying prototype-only implementation tricks. The prototype remains the place where the visual contract was explored; production owns typed components, real reducer state, real tests, and host-specific integration.

The first batch must make the smallest useful shared move: promote repeated extension settings atoms into `packages/ui`, make `PipelineModule` stop rendering a second status label, make the extension pipeline details answer the three real runtime questions, and document the pipeline visual contract for future work.

## Current Production Findings

- `packages/ui/src/components/PipelineModule.tsx` still requires and renders `status: string`.
- `packages/ui/src/components/PipelineLayout.tsx` passes `PipelineModuleProps` through unchanged, so removing `status` affects all consumers.
- `apps/extension/src/sidepanel/settings/FormControls.tsx`, `SecretField.tsx`, and `CollapsibleSection.tsx` are extension-private settings atoms and are not exported from `@listen-graphic/ui`.
- `SecretField` always renders `type="password"` and has no show/hide control.
- `apps/extension/src/sidepanel/status-cards.ts` builds ASR and Structurer status card data. Graph detail is still composed inline in `apps/extension/src/sidepanel/App.tsx`.
- Structurer detail currently exposes implementation fragments such as elapsed time, target, backlog, preview, and mode. This is denser than the release contract.
- `panel-reducer` already receives `previousGraph`, `addedNodeIds`, and `anchorNodeIds` in `MERGED_GRAPH_UPDATED`, but it does not persist a last graph delta.
- `lastStructurerRun` is mostly snapshot-derived in the sidepanel runtime and is cleared by graph updates. The new Structurer detail must not depend on it.
- The settings footer button says `清除密钥`, while `useProviderSettings.handleClearSecrets` resets provider config to `createExtensionDefaultProviderConfigForUi()`. The honest production label is `恢复默认配置`, not `清除全部凭据`.
- `PipelineLayout` already uses the 400px / 600px breakpoints. Production should keep its existing SVG path + ResizeObserver wave implementation and only sync the visual contract.

## In Scope

### Shared Settings Atoms

Move the extension settings atoms into `packages/ui/src/components` and export them from `packages/ui/src/index.ts`:

- `Button`
- `InputField`
- `SelectField`
- `LabeledField`
- `SectionHeader`
- `SecretField`
- `CollapsibleSection`

These components must use production TypeScript props and production theme primitives. They must not import extension-only provider types, Chrome APIs, or sidepanel reducer types.

`SecretField` adds a keyboard-accessible eye toggle. The toggle switches only the input type between `password` and `text`; it does not change the configured-secret semantics. Its aria label must distinguish showing and hiding the secret value.

Extension settings should consume the shared atoms after they are exported. `SettingsOverlay`, `AsrSettings`, `StructurerSettings`, and `DisplaySettings` remain extension-owned because they still depend on extension provider helpers and runtime state.

### Settings Reset Honesty

Rename the destructive settings action from `清除密钥` to `恢复默认配置`. The confirmation and success text must explain that provider type, endpoint, model, and secret fields return to extension defaults.

The behavior remains unchanged in this batch: `onClearSecrets` still calls the existing runtime action and then resets local provider config to `createExtensionDefaultProviderConfigForUi()`.

Do not import the prototype DangerZone copy that claims provider, endpoint, or model are preserved. That would conflict with production behavior.

### PipelineModule Contract

Remove `status` from `PipelineModuleProps` and from the rendered header. The module header becomes dot + label only. `detail` becomes the single human-readable answer for the module.

`PipelineLayout` keeps its existing layout modes:

- narrow: `< 400px`
- medium: `400px - 599px`
- wide: `>= 600px`

Desktop and web-demo should mechanically remove the `status` field from their `PipelineLayout` module objects so TypeScript compiles. Their detail semantics are not redesigned in this batch.

### Extension Detail Semantics

The extension pipeline details follow three questions:

- ASR: what was just heard
- Structurer: what pressure is the structurer under
- Graph: what graph output is visible now

ASR should use a new reducer field:

```ts
type LastTranscriptTail = {
  text: string;
  stable: boolean;
  at: number;
} | null;
```

`TRANSCRIPT_READY` writes a stable tail from the final transcript text. `PROVIDER_PROGRESS` may write an unstable tail only when the ASR progress payload contains transcript-like partial text. If partial payload shape is not available at implementation time, the implementation must keep ASR on stable final tails and document that partial tails remain deferred.

Structurer detail uses the current state that is already reliable in the sidepanel:

- `structuringSince`
- `pendingTranscriptCount`
- `pendingWorkCount`
- `currentStructurerTarget`
- `stopPending`
- `stopDrainPendingCount`
- `recentProviderError`

Structurer detail must not rely on `lastStructurerRun` for normal runtime copy.

Graph detail moves from `App.tsx` inline composition into a pure composer in `status-cards.ts`. It reads the graph, the new `lastGraphDelta`, current time, recent structurer error, and auto-tour status/progress passed from `App.tsx`.

## Graph Status State Machine

Add a reducer field:

```ts
type LastGraphDelta = {
  addedNodeCount: number;
  addedEdgeCount: number;
  at: number;
} | null;
```

`MERGED_GRAPH_UPDATED` computes it from existing payload data and stores it with the update timestamp. `addedNodeIds`, `anchorNodeIds`, and `revision` continue to feed auto-tour through the existing seed path; they do not need to be duplicated in `lastGraphDelta` unless implementation discovers a second durable consumer. Reset actions and fixture resets clear stale delta where they clear graph runtime state.

`computeGraphStatusCard` returns one module object at a time using this priority:

1. Structurer error: `保留旧图 · 待处理 N`
2. Fresh graph delta, when `nowMs - lastGraphDelta.at <= 1000`: `新增 N 节点 · M 关系`
3. Auto-tour touring: `导览 current/total`
4. Auto-tour paused: `导览暂停 current/total`
5. Recent graph update, when `nowMs - lastGraphUpdatedAt <= 5000`: `回显 N 节点 · M 关系`
6. Stable graph: `图谱已稳定 · N 节点 · M 关系`
7. Empty graph: `等待图谱数据`

The composer decides tone and detail only. It must not trigger tour behavior, read ReactFlow instances, or mutate reducer state.

## Out Of Scope

- Moving `SettingsOverlay` itself into `packages/ui`
- Adding settings pages to desktop or web-demo
- Redesigning desktop or web-demo detail semantics
- Replacing production `PipelineWaveDivider` with prototype CSS background waves
- Implementing `SessionList`
- Turning desktop diagnostics into `DiagnosticsDrawer`
- Moving ASR / Structurer / Graph composers into `packages/ui`
- Fixing the deeper `lastStructurerRun` runtime reporting gap
- Changing provider reset behavior beyond honest naming and copy

These are separate batches. `SessionList` and `DiagnosticsDrawer` are valuable, but they touch storage and desktop information architecture respectively and should not be mixed into this batch.

## Architecture

`packages/ui` owns reusable visual atoms and pipeline primitives. It must stay independent of extension panel state.

`apps/extension/src/sidepanel/status-cards.ts` owns the extension runtime composers because they read `PanelState` and auto-tour state. This keeps extension-specific state out of the shared UI package. Later cross-host reuse can happen only after the inputs are made host-neutral.

`apps/extension/src/sidepanel/panel-reducer.ts` owns durable sidepanel runtime facts such as `lastTranscriptTail` and `lastGraphDelta`. Ephemeral auto-tour mechanics stay in `useAutoTour` and are passed into the Graph composer by `App.tsx`.

`apps/desktop` and `apps/web-demo` follow the `PipelineModule` signature change only. Their broader release information architecture remains deferred.

## Visual Contract To Document

Add a production doc under `docs/extension` or `docs/product` for the pipeline visual contract and link it from `docs/README.md`.

The doc should include:

- 400px / 600px layout breakpoints
- module header contract: dot + label, no secondary status text
- detail contract: ASR heard text, Structurer pressure, Graph output
- Graph priority order from this spec
- Graph timing contract: fresh delta window is 1000ms; recent graph replay window is 5000ms; after that, the stable phase says `图谱已稳定 · N 节点 · M 关系`
- wave contract: wavelength 40px, amplitude 7px, 4 statuses, 3 tones, using the current production SVG path implementation
- release rule: provider/model/endpoint/token/debug stack details do not belong in the always-visible pipeline modules

## Testing Strategy

### Packages UI

Run focused `packages/ui` tests for:

- `SecretField` toggles between password and text
- `SecretField` exposes correct aria labels
- `PipelineModule` renders label and detail, and does not render old status text
- existing `PipelineLayout` behavior still covers the 400px / 600px modes

Suggested command:

```powershell
pnpm --filter @listen-graphic/ui test:run
```

### Extension Unit Tests

Add focused Vitest coverage for:

- `computeAsrStatusCard` uses `lastTranscriptTail` when present and remains null-safe
- `computeStructurerStatusCard` produces pressure-oriented detail without depending on `lastStructurerRun`
- `computeGraphStatusCard` priority cases: error, fresh delta within 1000ms, touring, paused, recent update within 5000ms, stable after 5000ms, empty
- `panelReducer` writes `lastTranscriptTail` from `TRANSCRIPT_READY`
- `panelReducer` writes `lastGraphDelta` from `MERGED_GRAPH_UPDATED`
- `SettingsOverlay` uses honest reset wording

Suggested command:

```powershell
pnpm --filter extension test:run
```

### Repository Gates

Because this batch changes extension UI and shared UI, use the repository sequence:

```powershell
pnpm lint
pnpm typecheck
pnpm test:ext:contract
pnpm test:ext:replay
```

Run thin E2E only if implementation changes visible user flows beyond the settings reset copy and pipeline text:

```powershell
pnpm test:ext:e2e
```

## Implementation Order

1. Create a feature worktree or branch named `feat/design-system-sync` before production code changes.
2. Add shared settings atoms to `packages/ui` with tests.
3. Switch extension settings files to import those atoms from `@listen-graphic/ui`.
4. Rename the reset action copy to `恢复默认配置` and update tests.
5. Remove `status` from `PipelineModule` and update all `PipelineLayout` consumers.
6. Add `lastTranscriptTail` and `lastGraphDelta` to `panel-reducer` with reducer tests.
7. Rewrite ASR and Structurer detail composers.
8. Add `computeGraphStatusCard` and replace App inline Graph module composition.
9. Add the production pipeline contract doc and link it from `docs/README.md`.
10. Run focused tests first, then repository gates.

## Acceptance Criteria

- No always-visible `PipelineModule` header renders a status text next to the label.
- Extension settings consume shared atoms exported by `@listen-graphic/ui`.
- Secret fields can be temporarily revealed and hidden with an accessible button.
- The destructive settings action is named and confirmed as restoring default provider configuration.
- Extension pipeline details are concise and reflect ASR tail, Structurer pressure, and Graph output state.
- Graph detail follows a deterministic priority order instead of mixing node counts and tour state in separate places.
- Desktop and web-demo compile after the `PipelineModule` signature change.
- Production docs record the pipeline visual contract without treating timestamped `docs/plans` files as authority.

## Risks

- ASR partial text may not be available in the current `PROVIDER_PROGRESS` payload. The implementation should land stable transcript tails first rather than inventing partial parsing.
- Removing `status` from `PipelineModuleProps` will surface all remaining consumers through TypeScript. This is expected and should be handled mechanically.
- Settings atoms may currently depend on inline style constants in extension `settings/theme.ts`. The implementation must either move the minimum needed theme styles into `packages/ui` or map the atoms onto existing `@listen-graphic/ui` classes.
- Graph delta timing can become noisy if old deltas are not cleared on reset and fixture paths. Reducer reset behavior needs explicit tests.
- This batch does not solve `lastStructurerRun` being stale or mostly unreachable in normal sidepanel runtime.
