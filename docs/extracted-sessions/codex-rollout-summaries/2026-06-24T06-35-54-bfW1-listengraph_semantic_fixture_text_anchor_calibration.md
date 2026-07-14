thread_id: 019ef857-a6ce-75f1-90f0-ec55e98e3881
updated_at: 2026-06-24T06:37:22+00:00
rollout_path: C:\Users\finni\.codex\sessions\2026\06\24\rollout-2026-06-24T14-35-59-019ef857-a6ce-75f1-90f0-ec55e98e3881.jsonl
cwd: \\?\C:\Users\finni\Desktop\ListenGraph

# Discussed how to fix ListenGraph semantic acceptance false negatives from text anchors

Rollout context: In `c:\Users\finni\Desktop\ListenGraph`, the user brought a 6/6 diagnostic report for `semantic-*` structure-quality fixtures and asked for thoughts on whether to fix the text-matching mechanism or downgrade acceptance. The report said structure assertions all passed, while 4 failures were all text-related (`mustContainOneOfTexts` / `forbiddenTexts`). The assistant consulted prior memory notes in `MEMORY.md` about semantic acceptance being a flexible gate, not a snapshot test, and replied that the right move was to keep the gate narrow and fix deterministic anchor parsing/granularity rather than turning it into loose semantic similarity.

## Task 1: Judge how to handle 4 text-related failures in semantic fixtures

Outcome: uncertain

Preference signals:
- The user explicitly framed the problem as “不当严格回归，对随机性心里有数” and then asked “说说你的想法” after presenting evidence that all 4 red cases were text-match failures while structure checks were 6/6 green. This suggests they want a concrete opinion on whether to treat these reds as real signal or as a mechanism issue, rather than a generic bug-fix answer.
- The user’s diagnostic singled out three `mustContainOneOfTexts` failures as anchor wording mismatches and one `forbiddenTexts` failure as a possible over-aggressive ban on a short term (“池中”), implying future similar reviews should distinguish deterministic text-anchor issues from genuine semantic regressions instead of flattening them into “randomness.”

Key steps:
- The assistant checked `MEMORY.md` for prior ListenGraph guidance and found notes that semantic acceptance should be treated as a semantic gate, not an exact snapshot, and that acceptance false negatives should be distinguished from model failures.
- The assistant recommended a narrow fix: keep strict checks strict, but split combined/quoted anchor text into short tokens, avoid slash-combined anchors like `幽默应对/自我解嘲`, and be more conservative with short forbidden words.
- The assistant explicitly argued against broadening strict checks into embedding/similarity-based acceptance.

Failures and how to do differently:
- There was no implementation or verification in this rollout; it stayed at the opinion/planning stage.
- The conversation should be treated as a calibration discussion, not evidence that any code change was made or validated.

Reusable knowledge:
- Prior ListenGraph guidance in `MEMORY.md` already frames semantic fixture work as a flexible semantic gate rather than a snapshot test; this rollout reinforced that the repo’s acceptance philosophy is “semantic gate first, visual grammar second.”
- For `semantic-*` acceptance, exact relation labels can produce false negatives when semantics are preserved by a different valid phrasing; keep the gate focused on key points, rough size, fallback avoidance, and hallucination prevention.
- Short, slash-combined, or sentence-level anchors are brittle for `mustContainOneOfTexts`; future similar failures should first check whether the draft anchor format itself is incompatible with the strict matcher before assuming model randomness.

References:
- User report summary: `seg18`, `seg31`, `seg43` failed `mustContainOneOfTexts`; `seg38` failed `forbiddenTexts` with `池中`; all structure checks passed (`min/maxMergedNodes`, `minMergedEdges`, `mustHaveNodeTypes(claim)`, fallback).
- Assistant recommendation: “不要把 strict 变成语义相似度判断器，只修‘锚点格式和短语颗粒度’的确定性误差。”
- Suggested mitigation shape: split anchors on `/、，,；;|`, filter very short tokens, keep existing bidirectional substring matching, and make forbidden-text rules more conservative for short ambiguous terms.
- Memory citation surfaced during the rollout: `MEMORY.md:711-724` and `MEMORY.md:737-740`.

