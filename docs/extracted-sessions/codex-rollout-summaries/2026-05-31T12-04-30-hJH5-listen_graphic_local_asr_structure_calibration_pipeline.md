thread_id: 019e7deb-df56-7e81-8aa8-39892fcfd3fb
updated_at: 2026-06-17T14:41:25+00:00
rollout_path: C:\Users\finni\.codex\sessions\2026\05\31\rollout-2026-05-31T20-04-30-019e7deb-df56-7e81-8aa8-39892fcfd3fb.jsonl
cwd: \\?\C:\Users\finni\Desktop\ListenGraph
git_branch: main

# Local ASR structure calibration pipeline was implemented, validated on a first batch, and committed.

Rollout context: The user wanted the agent to analyze the structure-quality workflow, implement the plan, then run it against real environment variables, and finally commit the result. The work happened in `C:\Users\finni\Desktop\ListenGraph` and centered on the extension/service-worker structure regression path.

## Task 1: Implement structure-quality calibration pipeline

Outcome: success

Preference signals:
- the user asked to “Implement the plan.” and later “如果你需要跑起来 需要什么？我设置相关structurer的相关环境变量就行了？” -> future runs should assume the user is comfortable wiring env vars and wants the agent to keep the existing pipeline rather than invent a new one.
- when the user later said the model is slow and asked why there should be time limits, they indicated “我实际生产环境都不限时 只是排队的” -> future real-provider runs should default to long waits / no artificial short timeout when diagnosing or validating slow models.
- when the user said “我搞好了 你试试跑吧” and later “我已经把…API模型名称更新好了，judge相关的环境变量也都配置好了，你直接跑一下试试吧，可能返回得比较慢。因为模型比较大” -> future agents should expect long-running real-provider jobs to be acceptable if the user has configured env vars and explicitly asks to run.
- when the user said “我来做第一批小样本校准，不一次性跑 51 条。” and then “ok你来做这个事情” -> future agents should default to small, high-value batches first, not full sweeps.
- when the user asked “提交” -> future agents should treat a clean commit as part of the deliverable once the batch is validated.

Key steps:
- Extended the real structure replay test harness to support semantic acceptance fields (`maxMergedNodes`, `maxFallbackRuns`, `forbiddenTexts`, `mustHaveNodeTypes`, `manualReviewTags`) and added safer text matching.
- Added a real-provider harness compatibility fix for jsdom/Node `AbortSignal` mismatch in the fetch wrapper, plus a separate test timeout override path; also made `timeoutMs <= 0` mean “do not create a timeout signal”.
- Added 21 semantic `semantic-*` fixture samples and updated structure-regression docs to describe them as semantic-quality fixtures, not snapshots.
- Built the local ASR artifact pipeline: segment generation, replay-fixture generation from segments, compare script, judge script, and compact graph artifact writing.
- Generated 51 `replay-local-segNN-*` replay scaffold fixtures from local ASR segments and wrote the first-batch human-readable calibration summary.
- Ran a first batch of six segments (`seg14`, `seg18`, `seg31`, `seg33`, `seg38`, `seg43`) through compare + judge and extracted promotion candidates.
- Committed the pipeline work in commit `4df33e2`.

Failures and how to do differently:
- Initial real-provider runs hit two environment issues: a jsdom/Node `AbortSignal` mismatch (`RequestInit: Expected signal ... to be an instance of AbortSignal`) and later DashScope `403` free-tier quota errors. The former was fixed in the test harness; the latter was resolved only after the user refreshed the shell/env and changed the configured model/key.
- Short provider timeouts were useful for diagnosis only; they were not suitable for concluding quality on a slow model. For future similar runs, use long waits or explicit `timeoutMs=0` for provider requests when the user says queueing is normal.
- A batch-wide run over all 51 segments timed out at the tool layer. The successful workflow was to run a few high-value segments one by one and aggregate the results manually.
- One follow-up bug in `prepare-local-replay-fixtures.mjs` (`existedBeforeWrite` in the segments path) was caught during validation and fixed before commit.
- Keep commit scope tight: this rollout intentionally left unrelated UI/product-route changes unstaged/uncommitted.

Reusable knowledge:
- `pnpm compare:structure -- --filter segXX --force --delay 0` runs a single local-ASR segment through with/without assembler compare and writes `*.graphs.json` artifacts.
- `pnpm judge:acceptance -- --filter segXX --force` runs the LLM judge on an existing graph artifact and writes a judgment JSON plus calibration summary.
- `pnpm prepare:structure:local-replay -- --segments --filter segXX` generates segment-based replay scaffolds from the local ASR segment artifacts.
- `LISTEN_GRAPHIC_E2E_STRUCTURER_TIMEOUT_MS=0` now means no provider-side abort signal is created; `LISTEN_GRAPHIC_E2E_STRUCTURE_TEST_TIMEOUT_MS` controls the Vitest outer timeout.
- The judge/model environment needed a refreshed shell to pick up the updated model name; once that happened, `judge:acceptance` succeeded with `qwen3.6-plus-2026-04-02`.
- For the first batch, all six evaluated segments were marked `shouldPromoteToFixture: true`; the split was 3 wins for graphA and 3 for graphB, so assembler was not yet dominant in the small sample.
- The most useful promoted candidates from the first batch were `seg18`, `seg43`, `seg31`, and `seg14`.

References:
- [1] Commit: `4df33e2 test(extension): add local ASR structure calibration pipeline`
- [2] Successful compare/judge commands used in practice:
  - `pnpm compare:structure -- --filter seg18 --force --delay 0`
  - `pnpm judge:acceptance -- --filter seg18 --force`
  - repeated for `seg14`, `seg31`, `seg33`, `seg38`, `seg43`
- [3] First-batch summary artifact: `apps/extension/src/service-worker/fixtures/asr-realtime/artifacts/segments/calibration-summary-first-batch.md`
- [4] Judge success evidence: `模型: qwen3.6-plus-2026-04-02 | API: https://dashscope.aliyuncs.com/compatible-mode/v1`, then `成功: 1 | 跳过: 0 | 失败: 0`
- [5] First batch readout: `seg14 graphA`, `seg18 graphB`, `seg31 graphB`, `seg33 graphA`, `seg38 graphA`, `seg43 graphB`, all `Promote = True`

## Task 2: Repository hygiene and scoped commit

Outcome: success

Preference signals:
- the user explicitly asked for “提交” after validation -> commit should be treated as expected output, not optional.
- the user later only wanted the structure-calibration work committed; unrelated UI/product-route edits remained in the worktree -> future agents should avoid sweeping unrelated work into the same commit.

Key steps:
- Confirmed staged files and diff scope before committing.
- Added only the structure-calibration pipeline, fixtures, docs, and the first-batch summary to the commit.
- Left unrelated modified files in the worktree: `docs/README.md`, `packages/ui/src/components/PipelineLayout.tsx`, `packages/ui/src/components/PipelineWaveDivider.tsx`, `packages/ui/src/styles/theme.css`, plus untracked `apps/desktop/` and `docs/product/`.

Failures and how to do differently:
- The worktree contained many unrelated changes. Future agents should inspect `git status` carefully and explicitly exclude unrelated UI/product docs before staging.
- The pipeline artifacts directory under `.gitignore` meant that the agent needed `git add -f` for the first-batch summary while intentionally avoiding forced add of bulky generated JSON artifacts.

Reusable knowledge:
- Final commit created from a narrow staged set; the remaining worktree was intentionally left dirty.
- The first-batch summary is the durable human-readable artifact; the per-run graph/judgment JSON files are generated and can be regenerated.

References:
- [1] Staged/committed files included the new scripts, `prepare-local-replay-fixtures.mjs`, structure test updates, docs, the 51 segment scaffolds, and `calibration-summary-first-batch.md`.
- [2] Remaining uncommitted files after commit were limited to unrelated docs/UI/product-route work and `apps/desktop/`, not the pipeline changes.

