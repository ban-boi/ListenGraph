thread_id: 019f01f4-b10e-70f2-8e74-71704b16f270
updated_at: 2026-06-26T03:26:00+00:00
rollout_path: C:\Users\finni\.codex\sessions\2026\06\26\rollout-2026-06-26T11-24-06-019f01f4-b10e-70f2-8e74-71704b16f270.jsonl
cwd: \\?\C:\Users\finni\Desktop\ListenGraph
git_branch: feat/llm-judge-pipeline-wiring

# ListenGraph semantic-structure evaluation should not be treated as a universal hard regression gate

Rollout context: In `C:\Users\finni\Desktop\ListenGraph`, the user described a problem where a structurer acceptance pipeline was calibrated with a flagship model, but rerunning the same acceptance with a smaller/possibly on-device model turned everything red. The user argued that future users may run different models, so the system should not assume a single model family, and asked whether this should be treated as a regression test or only as an assembler-effect check.

## Task 1: Decide whether model-calibrated acceptance should be a hard regression gate

Outcome: success

Preference signals:
- The user said, in effect, that because “以后用户指不定会用什么模型跑，说不定会用端侧模型，咱们不能限制或者替人家假设” and asked whether making this a regression test is inappropriate -> this suggests future semantic-eval work should not assume one fixed model distribution as the universal truth.
- The user proposed that this should “只能用来当 assembler 的效果检验工具” -> this suggests they want the pipeline framed as a comparative quality-check / benchmark tool when model choice varies, not as a universal blocking regression gate.

Key steps:
- The assistant first consulted repo-specific memory and the semantic-structure skill guidance before answering, to anchor the opinion in existing ListenGraph acceptance conventions.
- The assistant separated the problem into three layers: hard engineering regression, model-profile benchmark, and assembler-effect comparison.
- The assistant concluded that the pipeline is useful, but only as a model/profile benchmark or assembler-effect evaluation, not as a universal CI red/green gate for all user-chosen models.

Reusable knowledge:
- ListenGraph semantic acceptance has already been treated in memory as a flexible semantic gate rather than a snapshot test; this rollout extends that idea to model portability: acceptance calibrated on one strong model should not be assumed to represent all models.
- The user’s concern is not “does the code work for one reference model,” but “what is the quality band of whatever model the user chooses”; future similar tasks should answer in that product framing.
- If the acceptance is derived from a flagship model’s output and judge-corrected drafts, it can encode that model’s density/granularity assumptions, so a smaller or local model can fail for distribution mismatch rather than code regression.

Failures and how to do differently:
- The conversation stayed conceptual; no code or test changes were made in this rollout.
- Do not answer future questions about this area only in terms of whether a test is “green/red”; explicitly distinguish model-distribution mismatch from deterministic engineering regressions.

References:
- User framing: “用不同模型跑 structurer 的结果不一样… 以后的用户指不定会用什么模型跑… 不能限制或者替人家假设… 把这个东西做成回归测试是不合适的… 只能用来当 assembler 的效果检验工具.”
- Existing semantic-eval guidance surfaced during the discussion: semantic fixtures are replayable semantic gates, not snapshot tests; exact phrases and slash-combined anchors are brittle.
- The assistant’s final recommendation was to classify the artifact as `structure-eval` / `assembler-eval` / `model-quality-benchmark`, with reports and trends rather than a default blocking gate.
