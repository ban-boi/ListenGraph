thread_id: 019ef359-3908-7870-9855-fb07a5c96a60
updated_at: 2026-06-25T01:08:07+00:00
rollout_path: C:\Users\finni\.codex\sessions\2026\06\23\rollout-2026-06-23T15-19-38-019ef359-3908-7870-9855-fb07a5c96a60.jsonl
cwd: \\?\C:\Users\finni\Desktop\ListenGraph
git_branch: main

# ListenGraph design-system refinement and AutoTSN CB-persistence bug verification

Rollout context: The user was refining the ListenGraph design system for a multi-platform UI and repeatedly asked for product-level裁决 on what each pipeline module should display, how to treat the Graph/auto-tour relationship, and whether dangerous settings actions should stay in the UI. The same overall session later pivoted to an AutoTSN test report about a suspected CB VLAN migration persistence bug; the agent independently inspected production code in the AutoTSN repo to verify whether the reported bug was real and to decide whether to fix or skip it.

## Task 1: Refine the ListenGraph pipeline module copy and settings affordances

Outcome: success

Preference signals:
- The user kept tightening the design-system spec from richer cards to a very minimal display (“砍得比你建议的更精简，除了名称外只有一行字”), indicating a strong preference for lightweight, non-redundant main UI.
- The user explicitly asked what the one-line text should be for each module and asked whether Graph and auto-tour should be merged, showing they wanted product semantics, not just visual styling.
- The user asked whether a right-bottom “清除密钥” button really needed to exist, indicating they care about whether dangerous actions belong as常驻主操作.

Key steps:
- The agent re-read the latest design-system files and the real extension-side code to understand the current pipeline semantics.
- The agent observed that the design system had already evolved to a v2.5 contract: `PipelineModule` shows only `[dot] 名称` plus one detail line; status text is removed from the main display and reserved for reference matrices.
- The agent checked the ListenGraph code paths and found that the real sidepanel still exposes detailed status cards, logs, and settings, which confirmed the user’s concern that the main UI can easily become too heavy.
- The agent reviewed the design system’s own documentation and aligned on the rule that Graph should be treated as the “graph generation + presentation” phase, with auto-tour as a substage rather than a separate pipeline owner.
- The agent also traced the “清除密钥” action in the extension settings flow and found it clears provider secrets globally and resets provider config, not merely an inline input field.

Failures and how to do differently:
- The earliest design-system framing could still drift toward “current state” duplication; the user’s questions forced the model to separate the three module responsibilities more clearly.
- The Graph module needed to be reinterpreted away from pure graph statistics and toward “图谱生成与呈现阶段”, otherwise the one-line text would remain too thin or misleading.
- The settings “清除密钥” action is too high-risk and too low-frequency to present as a default bottom-bar button; it should be moved into a low-visibility danger zone or renamed if it really resets configuration.

Reusable knowledge:
- The design-system contract is now intentionally minimal: one module name + one detail line; no repeated status text if dot/wave already encode state.
- The three pipeline owners are better treated as distinct user questions: ASR = what was just heard, Structurer = how long it is taking / whether it is backed up, Graph = what was just produced / whether it is being toured.
- Graph and auto-tour can be merged semantically as one phase only if the displayed text switches by stage and the module name remains Graph (or a renamed equivalent); the agent recommended avoiding a fixed second line.
- The extension settings’ clear-secrets action is globally destructive enough that it should not be treated as a standard primary action.

References:
- `C:\Users\finni\AppData\Roaming\Open Design\namespaces\release-stable-win\data\projects\c050dc4d-9dbf-4482-9304-6b55a503ce58\designs\listen-graph-signal-v2\PHILOSOPHY.md`
- `...\lib\components.jsx`, `...\lib\pipeline.jsx`, `...\lib\data.jsx`
- `apps\extension\src\sidepanel\status-cards.ts`
- `apps\extension\src\sidepanel\App.tsx` (graph wave status, auto-tour status text, pipeline render)
- `apps\extension\src\sidepanel\settings\SettingsOverlay.tsx`
- `apps\extension\src\sidepanel\hooks\useProviderSettings.ts`
- `apps\extension\src\service-worker\provider-management.ts`
- `packages\providers\src\config.ts`

## Task 2: Verify the AutoTSN CB VLAN migration persistence bug from the T4 report

Outcome: success

Preference signals:
- The user explicitly asked whether the bug was real and requested independent verification rather than trusting the subagent report.
- The user’s report stressed that the issue appeared to be a “P0 生产 bug” and asked for a decision on whether to fix, skip, or defer.

Key steps:
- The agent independently checked the AutoTSN repo instead of relying on the subagent narrative.
- It located the relevant save pipeline in `ProjectStateService.cs`, especially `FinalizeAndPersistInternalAsync`, `SaveCbAsync`, `ApplyCbConfig`, and `GetCbConfigAsync`.
- It confirmed that `FinalizeAndPersistInternalAsync` does migrate `sharedCbConfig` via `CbVlanReferenceMigrator.MigrateWithReport(...)`.
- It confirmed that the migrated CB config is used for stream coding / forwarding / restorability validation, but the CB authority writeback path is only inside `ApplyCbConfig(...)`, which is only called by `SaveCbAsync`.
- It confirmed that `GetCbConfigAsync` reads back from the authoritative `autotsn.cb.*` IOM metadata through `CbLinker`, so if `SaveAllTrafficAsync` takes the migration path without calling `ApplyCbConfig`, the persisted CB key can remain stale.
- It also confirmed `CbUnlinker` clears `autotsn.cb.*` before writing CB authority metadata, which closed the loop on why an in-memory migration without the unlinker writeback would leave old keys on disk.

Failures and how to do differently:
- The initial suspicion had to be verified through production code, because the subagent’s root-cause explanation referenced concrete lines and behavior that needed independent confirmation.
- The critical failure mode is a split between “migrated in-memory config used for derived artifacts” and “authoritative CB config not written back before persist.” Future similar bugs should be checked by tracing both the derivation path and the authoritative writeback path.

Reusable knowledge:
- In AutoTSN, `CbVlanReferenceMigrator` can make the current save look correct in derived artifacts while the authoritative CB metadata remains stale unless the CB unlinker path writes back to `autotsn.cb.*`.
- `SaveCbAsync` is the only caller of `ApplyCbConfig(...)` in the inspected file, so full-save paths that do not call `SaveCbAsync` will not refresh CB authoritative metadata unless they explicitly route through the same writeback logic.
- The relevant code seams are `ProjectStateService.cs:2111-2385`, `ProjectStateService.cs:1296-1335`, `ProjectStateService.cs:2596-2625`, `AutoTSN2.0\Services\IOM\CB\CbLinker.cs`, and `AutoTSN2.0\Services\IOM\CB\CbUnlinker.cs`.

References:
- `AutoTSN2.0\AutoTSN2.0\Services\ProjectStateService.cs:2111-2385`
- `AutoTSN2.0\AutoTSN2.0\Services\ProjectStateService.cs:1296-1335`
- `AutoTSN2.0\AutoTSN2.0\Services\ProjectStateService.cs:2596-2625`
- `AutoTSN2.0\AutoTSN2.0\Services\IOM\CB\CbLinker.cs`
- `AutoTSN2.0\AutoTSN2.0\Services\IOM\CB\CbUnlinker.cs`
- `AutoTSN2.0\AutoTSN2.0.Tests\Integration\ProtocolStreamSaveConsistencyTests.cs`
- `Docs\superpowers\plans\2026-06-24-traffic-workspace-e2e-validation.md`
