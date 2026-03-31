# Extension Structurer Incremental Design

## Purpose
This note records the current structurer pipeline decisions that were made after the original real-provider baseline.
It is the source of truth for the current `ASR -> structurer -> merge -> debug` behavior in the extension mainline.

## Scope
This document covers the current production-shaped path for:

- transcript windowing and bootstrap behavior
- structurer prompt contract
- provider output normalization
- canonical node id rules
- merge and de-duplication rules
- timeout / retry policy
- debug export shape

It does not redefine the extension capture pipeline or the provider settings UI.

## Source Of Truth
- Runtime orchestration: `apps/extension/src/service-worker/index.ts`
- Structurer provider: `packages/providers/src/structurer/openai-structurer.ts`
- Provider defaults: `packages/providers/src/config.ts`
- Graph merge rules: `packages/domain/src/merge.ts`
- Text normalization helpers: `packages/domain/src/normalize.ts`
- Debug message contracts: `apps/extension/src/shared/messages.ts`

## Current Pipeline
The active runtime path remains:

`Audio chunk -> ASR transcript chunk -> transcript window -> structurer segment -> merged graph -> sidepanel`

Current chunking and structuring behavior is:

- audio capture still produces `10s` ASR chunks
- the first structurer call waits until there are `3` transcript chunks
- after bootstrap, structurer still receives the most recent `3` chunks as context
- incremental extraction only asks for net-new semantics implied by the latest chunk

This means the current mode is:

`带最近 3 个 chunk 做上下文，但只抽最新 chunk 的净新增`

## Windowing And Bootstrap Rules
The service worker keeps a bounded transcript window in memory.

Current rules:

- `STRUCTURER_BOOTSTRAP_WINDOW_SIZE = 3`
- before the first merged graph exists, the first `2` chunks only update transcript/debug state
- the first structurer run uses the full `0-30s` bootstrap window
- every later run keeps a rolling `30s` context window
- the latest chunk is still the semantic focus for incremental extraction

Why this exists:

- `10s` alone was too small and forced premature node splitting
- a rolling `30s` context gives the model enough local continuity without letting prompt size grow unbounded

## Structurer Prompt Contract
The structurer prompt is intentionally strict and optimized for incremental extraction.

Current request characteristics:

- `response_format: { type: "json_object" }`
- for Zhipu, `thinking: { type: "disabled" }`
- user payload includes:
  - `mode`
  - `windowTranscript`
  - `latestChunkTranscript`
  - `recentGraphContext`
  - `previousGraphSummary`

Current prompt decisions:

- bootstrap mode may summarize the full `30s` window
- incremental mode must only output net-new nodes implied by `latestChunkTranscript`
- if the latest chunk only adds support/detail/example, prefer edges instead of repeating claims
- if there is no net-new semantic contribution, return empty `nodes` and `edges`
- recent graph semantics must not be restated, paraphrased, or renamed
- edges may point either to returned node ids or to recent graph node ids

`recentGraphContext` currently contains:

- the most recent `8` graph nodes
- the most recent `4` graph edges

This is a deliberate tradeoff:

- enough recent structure to suppress repetition
- small enough to keep prompt size stable

## Transcript Cleaning Rules
Structurer input does not use raw Tencent transcript text verbatim.

Current cleaning behavior:

- remove Tencent-prefixed transcript timestamps such as `[0:0.000,0:10.000]`
- keep the outer runtime range wrapper `[startMs-endMs]`
- use cleaned text for fallback nodes as well

This avoids double-wrapped timestamps such as:

`[0-10000] [0:0.000,0:10.000] ...`

Raw ASR payload is still preserved in storage/debug, but it is not used as-is in the structurer prompt.

## Provider Output Normalization
The model is instructed to return one strict JSON object, but the runtime still normalizes common drift before building a segment graph.

Currently accepted shapes:

- top-level `{ topic, nodes, edges }`
- wrapped `{ answer: { topic, nodes, edges } }`

Currently accepted node text fields:

- `text`
- `content`
- `label`

Current normalization behavior:

- invalid node types are dropped
- invalid edge types are dropped
- empty node text is dropped
- edges that cannot be resolved to either returned nodes or recent graph nodes are dropped
- if normalization leaves zero valid nodes, the runtime falls back to one draft claim node from the latest cleaned transcript text

The intent is:

- prompt should keep the happy path strict
- runtime should absorb known provider drift instead of corrupting the graph

## Canonical Node Id Rules
Model-supplied node ids are never trusted as final graph ids.

Current rule:

- each segment gets its own `segmentId`
- each normalized node gets a canonical id of `segmentId:providerLocalId`
- if the provider did not return an id, runtime uses a generated local fallback such as `node_1`

Why this exists:

- models frequently reuse ids like `n1`, `n2`, `1`
- React Flow and the merged graph both require globally unique node ids
- edge rewriting becomes deterministic only after canonicalization

Cross-segment edges are allowed, but they must point to:

- canonical ids generated in the current segment
- or recent graph node ids explicitly surfaced in `recentGraphContext`

## Merge And De-Duplication Rules
`mergeSegmentGraph()` now treats graph correctness as the first priority.

### Node merge
Current node fold rules:

- exact merge:
  - same `type`
  - no speaker conflict
  - normalized text exactly equal
- conservative near-duplicate merge:
  - same `type`
  - no speaker conflict
  - not a `question`
  - timestamp distance within `30s`
  - both normalized texts are long enough
  - and either:
    - one normalized text contains the other
    - or bigram overlap is at least `0.68`

When nodes merge:

- `confidence` keeps the max value
- `evidenceChunkIds` are unioned
- `timestampMs` keeps the earlier time
- `status` upgrades to `confirmed` if any merged node is confirmed

### Edge merge
Current edge rules:

- edge endpoints are rewritten through the node remap generated by node merge
- self-loop edges are dropped
- edges pointing to non-existent nodes are dropped
- duplicate edges with the same `source + target + type` are folded
- folded edges keep max confidence and unioned evidence chunk ids

This was introduced to eliminate dangling edges after node folding.

## Timeout And Retry Policy
The current structurer policy is intentionally more conservative than the generic provider default.

Current structurer defaults:

- timeout: `90s`
- `429` is not retried
- timeout / abort is not retried
- transient network and selected `5xx` responses remain retryable through the shared retry helper

Reasoning:

- earlier `15s` timeout caused local cancellation followed by duplicate follow-up requests
- `429` retry amplified rate-limit failures instead of helping
- timeout should surface as a terminal error for the current run instead of silently spraying retries

## Debug Data Contract
Debug export now distinguishes between operational observability and raw payload retention.

Current debug layers:

- transcripts
- structurer segments
- chunk traces
- merged graph
- derived renderer views
- structured `structurerRuns`

`structurerRuns` exists to summarize each structurer attempt with:

- mode
- window range and chunk count
- transcript character counts
- recent graph counts
- start/end timestamps
- duration
- success / timeout / error
- segment id
- node/edge count
- fallback usage

Export policy:

- default debug export is slim
- slim export does not inline all `tokens` and large `raw` blobs
- full export keeps the raw payloads for deep diagnosis

This keeps ordinary debug files usable while preserving a full-fidelity path when needed.

## Known Tradeoffs
The current design is intentionally biased toward pipeline stability, not final graph quality.

Known tradeoffs:

- cross-segment linking is currently allowed and may still be too aggressive
- fallback nodes still protect continuity, but they can inject low-quality raw sentences into the graph
- provider latency is still highly variable even when prompt size is stable
- prompt-side suppression reduces repetition, but merge still needs to carry part of the de-duplication load

## Open Issues
These items are not yet considered settled:

1. Cross-segment edge policy is likely too permissive.
2. Structurer latency still shows high variance even with small rolling windows.
3. Failed structurer attempts should always be visible in exported `structurerRuns`, not only in `lastProviderError`.
4. Fallback behavior may need to become stricter so a weak response does not pollute the graph.

## Change Rule
If the implementation changes any of the following, this document should be updated in the same change:

- transcript window size or bootstrap threshold
- incremental prompt contract
- recent graph context shape
- canonical id strategy
- merge thresholds
- timeout / retry behavior
- debug export semantics
