# Shared ASR Runtime Design

## Status

- Date: 2026-06-24
- Decision: approved
- Scope: extract a host-neutral realtime ASR runtime, migrate the extension Local ASR Bridge path to it, then connect desktop audio to the same runtime

## Goal

Create `packages/asr-runtime` as the shared implementation of the `lg-asr-ws-v1` client protocol. The browser extension and Electron desktop app will keep their host-specific audio capture and lifecycle code, while sharing audio encoding, protocol types, WebSocket session state, and transcript events.

The first functional milestone uses the existing mock ASR bridge to prove the complete desktop path. The second milestone replaces the mock bridge with the existing Sherpa reference bridge without changing desktop application code.

## Non-Goals

- Microphone and system-audio mixing
- Audio-device selection
- Desktop packaging or installers
- A desktop settings UI for provider configuration
- Moving structurer, graph merge, storage, or host lifecycle code into the new package
- Supporting protocols other than `lg-asr-ws-v1`
- Rewriting the extension's complete realtime ASR pipeline

## Package Boundary

`packages/asr-runtime` must not depend on Chrome APIs, Electron APIs, React, storage, or a concrete ASR engine. It may depend on shared schema types when those types are genuinely host-neutral.

The package owns:

- Float32-to-PCM16 conversion for mono audio frames
- `lg-asr-ws-v1` request and response types
- Message parsing and validation at the protocol boundary
- WebSocket connection and session lifecycle
- Session start, audio frame, flush, and stop messages
- Status, partial transcript, final transcript, and error events
- Injectable WebSocket construction for deterministic tests

The package does not own:

- Audio capture, resampling, AudioWorklet setup, or permissions
- Chrome message routing and content-script/service-worker coordination
- Electron window or loopback setup
- Provider settings persistence
- Transcript assembly, structuring, graph merge, rendering, or persistence

## Public API

The package exposes a small session-oriented API. Exact names may be adjusted during implementation to match repository conventions, but the behavioral contract is fixed.

```ts
interface LocalAsrSessionOptions {
  endpoint: string;
  authToken?: string;
  sampleRate: number;
  frameDurationMs: number;
  sessionId: string;
  websocketFactory: WebSocketFactory;
}

interface LocalAsrSession {
  connect(): Promise<void>;
  sendFloat32Frame(frame: Float32Array, timestampMs: number): void;
  flush(): Promise<void>;
  stop(): Promise<void>;
  subscribe(listener: (event: LocalAsrEvent) => void): () => void;
}
```

`connect()` resolves only after the WebSocket is open and the bridge has accepted `session.start`. Calling frame, flush, or stop operations in invalid states produces a typed runtime error instead of silently dropping data.

The runtime emits normalized events:

- `status`
- `transcript.partial`
- `transcript.final`
- `error`
- `closed`

Vendor-specific payload fields may be retained as optional metadata, but consumers must not need vendor enums to process transcripts.

## State Model

The shared session uses these states:

```text
idle -> connecting -> starting -> streaming -> flushing -> stopping -> closed
                         |            |            |
                         +---------- error <-------+
```

Rules:

- One session instance represents one ASR session.
- Frames are accepted only while `streaming`.
- `flush()` is idempotent and waits for the protocol flush to be sent.
- `stop()` is idempotent and closes the socket after the stop message or timeout.
- Socket errors and invalid protocol messages transition the session to `error` and emit one normalized error event.
- Consumers may always call `stop()` during cleanup, including after an error.

## Extension Migration

The extension remains responsible for obtaining browser audio and coordinating Chrome contexts. Its Local ASR Bridge path will delegate protocol work to `packages/asr-runtime`.

Migration steps:

1. Add contract tests around the current Local Bridge handshake, PCM framing, partial/final events, flush, and stop behavior.
2. Implement the shared runtime until those tests pass.
3. Replace the Local Bridge-specific WebSocket and encoding logic in the content script with the shared client.
4. Keep Tencent realtime handling in its current path; it is outside this extraction.
5. Preserve existing messages sent from content script to service worker so downstream extension behavior does not change.

This migration must not alter provider settings, replay assets, transcript dedup semantics, or the extension's structurer workflow.

## Desktop Integration

The desktop app already emits 16 kHz mono `Float32Array` frames from its AudioWorklet. `DesktopRuntime` will create one shared ASR session per capture session and forward those frames to it.

Desktop flow:

```text
DesktopAudioSource
  -> Float32 frame
  -> LocalAsrSession
  -> Local ASR Bridge
  -> partial/final transcript events
  -> desktop transcript window
  -> MockStructurerProvider
  -> mergeSegmentGraph
  -> DesktopRuntime graph snapshot
  -> GraphArea
```

Behavior:

- Partial transcripts update transcript/status diagnostics only.
- Final transcripts enter the structurer and graph merge path.
- Structurer calls are serialized to preserve transcript order.
- The existing timer and `MOCK_TRANSCRIPTS` graph generation are removed.
- Bridge failure is visible as an ASR error and does not fall back to generated transcript text.
- Stopping capture flushes ASR, stops the ASR session, then releases the audio source.
- If the bridge closes unexpectedly, desktop stops forwarding frames and surfaces the failure without crashing the renderer.

The first desktop integration uses the existing default endpoint `ws://127.0.0.1:15377/ws`. A settings surface is deferred until the runtime contract is stable.

## Structurer And Graph Behavior

The first milestone uses `MockStructurerProvider` so the test proves orchestration without introducing network credentials or model variability. The structurer receives actual final transcript text returned by the bridge.

Each final transcript becomes a schema-compatible transcript chunk with stable session, utterance, revision, and timestamp fields. The resulting segment graph is merged using `mergeSegmentGraph`; no desktop-specific graph merge implementation is introduced.

Replacing the mock structurer with a configured real structurer is a later task and must not require changes to the ASR runtime package.

## Error Handling

Errors are classified at the shared boundary:

- Connection failure
- Handshake timeout or rejection
- Invalid state transition
- Invalid protocol message
- Bridge-declared error
- Unexpected socket closure
- Stop or flush timeout

The shared error includes a stable code, user-readable message, and optional cause. Host applications decide how to display or persist it.

Extension migration must preserve its current user-facing error semantics. Desktop records concise session errors in its runtime snapshot and diagnostic log. Neither host silently reconnects in the first implementation; reconnect policy requires a separate design because replaying live audio frames has data-loss implications.

## Testing Strategy

### Shared Package

Vitest unit tests cover:

- Float32 boundary values and PCM16 encoding
- Session start payload
- Audio frame payload and sequencing
- Partial and final transcript parsing
- Flush and stop idempotency
- Handshake timeout
- Invalid JSON and unsupported message handling
- Socket error and unexpected close
- Cleanup after partial startup

A fake WebSocket implementation is injected through `WebSocketFactory`; unit tests do not open network sockets.

### Extension Regression

Run in repository order:

1. `pnpm test:ext:contract`
2. `pnpm test:ext:replay`
3. Local Bridge-specific tests
4. Thin E2E only if host-visible behavior changes

The extension migration is complete only when existing Local Bridge partial/final and real fixture behavior remains unchanged.

### Desktop Verification

Automated checks cover:

- Desktop runtime forwards real AudioWorklet frames to the shared session
- Partial transcript does not mutate the graph
- Final transcript invokes the structurer once and updates the graph
- Multiple finals preserve order
- Bridge failure stops frame forwarding and surfaces an error
- Stop flushes and closes ASR before audio cleanup

Then run desktop lint, typecheck, build, and smoke commands, followed by the root build.

## End-To-End Acceptance

### Phase 1: Mock Bridge

1. Start `pnpm dev:mock-asr-bridge`.
2. Start the desktop app.
3. Select microphone or system audio and begin capture.
4. Verify audio frames reach the bridge.
5. Verify partial transcript is visible only as progress.
6. Verify the mock final transcript creates graph content.
7. Stop capture and verify the bridge session and audio source are released.

### Phase 2: Sherpa Bridge

1. Start the existing Sherpa reference bridge with the local model.
2. Start desktop capture without changing desktop code.
3. Speak or play known audio.
4. Verify returned final transcript reflects the real audio.
5. Verify that transcript creates graph content.
6. Stop capture and verify resource cleanup.

Phase 2 proves real ASR integration, not semantic graph quality. Structurer quality remains a separate acceptance axis.

## Delivery Sequence

1. Add `packages/asr-runtime` package scaffolding and tests.
2. Implement protocol types, encoder, parser, and session state machine.
3. Migrate extension Local Bridge transport to the shared runtime.
4. Run extension contract and replay gates.
5. Add desktop transcript-to-graph orchestration tests.
6. Connect desktop audio frames and remove mock transcript generation.
7. Run desktop and root verification.
8. Complete mock bridge manual acceptance.
9. Complete Sherpa manual acceptance.

Each step should be independently reviewable. Extension migration and desktop integration should not be combined into one unverified rewrite.
