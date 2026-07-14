thread_id: 019efcda-f3be-7b60-912b-0fc0712e84bd
updated_at: 2026-06-25T04:05:09+00:00
rollout_path: C:\Users\finni\.codex\sessions\2026\06\25\rollout-2026-06-25T11-37-54-019efcda-f3be-7b60-912b-0fc0712e84bd.jsonl
cwd: \\?\C:\Users\finni\Desktop\ListenGraph
git_branch: feat/llm-judge-pipeline-wiring

# Reviewed a prototype-to-production design-system handoff for ListenGraph, wrote and then refined a production spec, and produced a detailed implementation plan.

Rollout context: the user supplied an attachment describing how to "反哺生产" from a prototype repo (`C:\Users\finni\Desktop\listen-graph-design-system`) into the production ListenGraph repo (`C:\Users\finni\Desktop\ListenGraph`). The work stayed in `C:\Users\finni\Desktop\ListenGraph` and focused on documentation/specification, not code edits.

## Task 1: Read prototype handoff and validate production seams

Outcome: success

Preference signals:

- the user’s attachment framed the task as a production handoff from prototype to production, implying future similar requests should treat prototype HTML/Babel explorations as design contracts to translate into typed production code rather than copying implementation tricks.
- the user’s review later confirmed they care about keeping the UI “轻薄、信息清晰、不要重复、不要有没用的东西挡道,” implying future ListenGraph UI reviews should default toward low-clutter release surfaces and separate main content from diagnostics.
- the user explicitly accepted the idea that `composer` logic should stay extension-owned and that `PipelineModule` should only lose `status`, implying future UI contract work should preserve extension-specific state boundaries and avoid over-centralizing into `packages/ui`.

Key steps:

- read the attachment and confirmed the repo seams: `packages/ui`, `apps/extension/src/sidepanel/status-cards.ts`, `apps/extension/src/sidepanel/panel-reducer.ts`, and `apps/extension/src/sidepanel/settings/*`.
- verified that `PipelineModule` still rendered `status`, `SecretField` had no eye toggle, `status-cards.ts` still only covered ASR/Structurer, and Graph text was inline in `App.tsx`.
- verified `docs/README.md` already existed as the current doc-navigation entrypoint and that `docs/superpowers/specs` / `docs/superpowers/plans` were the right locations for durable design artifacts.

Failures and how to do differently:

- no implementation errors here; the main learning was that the production code already had the exact seams the handoff described, so future work should start by validating those seams before drafting the spec.

Reusable knowledge:

- `packages/ui/src/components/PipelineModule.tsx` still required `status: string` and rendered it.
- `apps/extension/src/sidepanel/settings/FormControls.tsx`, `SecretField.tsx`, and `CollapsibleSection.tsx` were extension-private and not exported from `@listen-graphic/ui`.
- `apps/extension/src/sidepanel/status-cards.ts` was the right home for extension runtime composers because it already read `PanelState` and auto-tour state.
- `docs/README.md` is the authoritative docs navigation entrypoint; timestamped plan docs should not be treated as the active contract.

References:

- [1] `Get-Content -Raw docs/README.md` showed the doc navigation structure and active docs list.
- [2] `Get-Content -Raw packages/ui/src/components/PipelineModule.tsx` showed `status` still being rendered.
- [3] `Get-Content -Raw apps/extension/src/sidepanel/status-cards.ts` showed ASR/Structurer card composers and Graph still handled elsewhere.
- [4] `Get-Content -Raw apps/extension/src/sidepanel/settings/FormControls.tsx`, `SecretField.tsx`, `CollapsibleSection.tsx`, and `SettingsOverlay.tsx` showed the settings atoms were still extension-private.

## Task 2: Write and refine the production design spec

Outcome: success

Preference signals:

- the user later requested a code review on the spec and specifically asked for the Graph stable-state wording to align with `PHILOSOPHY.md`, which means future specs should prefer the repo’s authoritative product language unless a deliberate deviation is explicitly justified.
- the user accepted the note that `onClearSecrets` actually resets the full provider config and that the honest label is `恢复默认配置`, so future work should keep UI text consistent with real behavior rather than a narrower-sounding label like “清除密钥” or “清除全部凭据.”
- the user accepted a deterministic Graph timing contract (`1000ms` fresh delta, `5000ms` replay window), implying future state-machine specs should pin thresholds explicitly instead of saying “about 1 second” or “recent.”

Key steps:

- created `docs/superpowers/specs/2026-06-25-design-system-sync-design.md` and captured the production contract: shared settings atoms, `PipelineModule` status removal, extension-owned detail composers, Graph priority rules, and a pipeline visual contract doc.
- ran a self-review for placeholders and internal consistency, then committed the spec.
- after review feedback, refined the spec to:
  - use `图谱已稳定 · N 节点 · M 关系` for the stable Graph phase,
  - hard-code the fresh/recent windows to `1000ms` and `5000ms`,
  - shrink `lastGraphDelta` to only the composer-relevant fields (`addedNodeCount`, `addedEdgeCount`, `at`) while leaving `addedNodeIds` / `anchorNodeIds` for auto-tour seed flow.
- committed the refined spec as `cc10c29 docs: refine graph pipeline status contract`.

Failures and how to do differently:

- the first spec draft had a small wording mismatch in Graph stable-state semantics; the fix was to align production copy with `PHILOSOPHY.md` and then make the timing windows deterministic.
- a plan example originally risked a formatting bug in Graph text composition (`graphCountDetail` spacing); the correction was to make the prefix text explicit and avoid hidden whitespace assumptions.

Reusable knowledge:

- production spec file: `docs/superpowers/specs/2026-06-25-design-system-sync-design.md`.
- spec commit after review: `cc10c29 docs: refine graph pipeline status contract`.
- the spec now treats the Graph status machine as:
  - error -> fresh delta within `1000ms` -> touring -> paused -> recent update within `5000ms` -> `图谱已稳定 · N 节点 · M 关系` -> empty.
- `lastGraphDelta` should remain a lightweight durable fact; auto-tour seed fields need not be duplicated inside it.

References:

- [1] `docs/superpowers/specs/2026-06-25-design-system-sync-design.md`
- [2] Commit `1019898 docs: add design system sync spec`
- [3] Commit `cc10c29 docs: refine graph pipeline status contract`
- [4] Review feedback explicitly called out the Graph stable wording mismatch and requested deterministic time windows.

## Task 3: Write the implementation plan and keep it execution-ready

Outcome: success

Preference signals:

- the user accepted that after the spec, the next step should be a plan in `docs/superpowers/plans`, then execution choices; future similar work should keep spec and plan as separate durable artifacts before touching code.
- the user’s review of the spec confirmed they prefer a plan that is detailed enough to execute independently and that each task can be tested in isolation.
- the user’s feedback also reinforced that settings-copy changes must reflect actual behavior (`恢复默认配置`), and that Graph timing constants should be explicit rather than vaguely described.

Key steps:

- wrote `docs/superpowers/plans/2026-06-25-design-system-sync.md` using the writing-plans format, with bite-sized tasks and explicit file lists.
- split the work into 6 executable buckets plus final verification:
  - shared settings atoms in `packages/ui`,
  - switch extension settings to shared atoms,
  - remove `PipelineModule` status,
  - add reducer facts for transcript tail and graph delta,
  - rewrite extension pipeline composers,
  - document the production pipeline contract,
  - run final verification gates.
- included concrete tests and commands instead of vague placeholders; the plan was then refined once to fix Graph detail concatenation and keep the stable/recent text unambiguous.
- committed the plan as `391492a docs: add design system sync implementation plan`.

Failures and how to do differently:

- the plan initially had a `graphCountDetail` prefix-spacing issue; fixing it early avoided ambiguous output text in the spec/plan examples.
- the first draft also needed one more pass to ensure every task had concrete files, commands, and tests. Future similar plans should do the same self-review before committing.

Reusable knowledge:

- plan file: `docs/superpowers/plans/2026-06-25-design-system-sync.md`.
- plan commit: `391492a docs: add design system sync implementation plan`.
- the plan intentionally keeps `SettingsOverlay` extension-owned, `status-cards.ts` extension-owned, and only extracts reusable atoms into `packages/ui`.
- the plan’s final verification gates are `pnpm lint`, `pnpm typecheck`, `pnpm test:ext:contract`, `pnpm test:ext:replay`, and optionally `pnpm test:ext:e2e` if visible flows changed.

References:

- [1] `docs/superpowers/plans/2026-06-25-design-system-sync.md`
- [2] Commit `391492a docs: add design system sync implementation plan`
- [3] The plan’s file map and task breakdown explicitly enumerate shared atoms, reducer facts, composers, and docs.
- [4] The plan keeps Graph timing explicit: fresh delta `<= 1000ms`, recent replay `<= 5000ms`, then stable.

## Task 4: Repository facts useful for future similar runs

Outcome: success

Reusable knowledge:

- `packages/ui/package.json` exposes `test:run`, `typecheck`, `lint`, and `build`; `apps/extension/package.json` already has `test:run`, `typecheck`, `lint`, `test:ext:contract`, `test:ext:replay`, and E2E commands.
- `docs/README.md` already lists the active doc set and is the right place to link a new production contract doc.
- `apps/extension/src/sidepanel/settings/*` already had shared-atom candidates, but they were not yet centralized into `@listen-graphic/ui`.
- `PipelineLayout` breakpoints were already aligned with the spec at 400px / 600px; the wave implementation should be preserved, not replaced.

References:

- [1] `packages/ui/package.json`
- [2] `apps/extension/package.json`
- [3] `docs/README.md`
- [4] `apps/extension/src/sidepanel/App.tsx`, `status-cards.ts`, `panel-reducer.ts`, and settings files as the main implementation seams for the planned work.
