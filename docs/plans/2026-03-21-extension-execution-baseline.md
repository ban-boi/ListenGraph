# Extension Execution Baseline

## Purpose
This note defines the single execution baseline for the next implementation phase.
Its job is to eliminate document drift, not to restate the full system design.

## Current Source Of Truth
- Primary engineering reference: `doc/更工程化的技术设计文档.md`
- Primary product/stage reference: `doc/重构版 design 文档 v2.md`
- Historical references only: `doc/技术方案.md`, `docs/plans/2026-03-20-extension-audio-pipeline-fix.md`

## Current Extension Mainline
The only active extension mainline is:

`sidepanel -> service-worker -> content-script -> getDisplayMedia -> AudioWorklet -> service-worker -> sidepanel`

Operational rules:
- `apps/extension/src/service-worker/index.ts` is the only active service worker source.
- Audio capture is initiated from `apps/extension/src/content-script/content-script.ts`.
- `offscreen` and `tabCapture` stay in the repository as reserved or experimental paths, but are not part of the current production mainline.

## Out Of Scope For The Current Mainline
The following are explicitly not part of the current extension execution path:
- `tabCapture` as the default capture entry
- `offscreen document` as the active audio processing host
- `apps/extension/public/service-worker.js` as a build input or runtime source

## Next 3 Implementation Goals
1. Providerization
- Replace inline mock ASR and structuring logic in the service worker with `packages/providers` contracts.
- Keep mock providers if needed, but force the live path through provider abstractions.

2. Persistent Session Assets
- Connect the live path to `packages/storage`.
- Persist session metadata, transcript chunks, and merged graph assets beyond runtime snapshot state.

3. Export / Debug / Replay
- Add export outputs for JSON, Markdown, and Mermaid first.
- Add session recovery and a lightweight debug surface for transcript, segment, and merged graph inspection.

## Execution Constraints
- New functionality follows strict TDD: write failing tests first, implement second, refactor last.
- Prefer extending the current mainline instead of reviving deprecated branches.
- When a document conflicts with this baseline, this baseline wins unless a newer ADR or plan replaces it.
