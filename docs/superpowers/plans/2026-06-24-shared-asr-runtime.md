# Shared ASR Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the `lg-asr-ws-v1` client into `packages/asr-runtime`, migrate the extension Local ASR Bridge path without changing behavior, and connect desktop audio frames to transcript-driven graph updates.

**Architecture:** `@listen-graphic/asr-runtime` owns PCM16 encoding, protocol parsing, and one WebSocket-backed `LocalAsrSession` state machine. Extension and desktop retain host capture and lifecycle code; final transcripts are consumed by each host, while desktop uses `MockStructurerProvider` and `mergeSegmentGraph` to replace its timer-driven mock graph.

**Tech Stack:** TypeScript, pnpm workspaces, Turborepo, Vitest, WebSocket, React/Electron, AudioWorklet, `@listen-graphic/schema`, `@listen-graphic/providers`, `@listen-graphic/domain`.

---

## Execution Preconditions

The current workspace contains uncommitted desktop and extension work. Do not reset, clean, or create an isolated worktree from `HEAD` and assume it contains `apps/desktop`. Execute against the current workspace unless the user first creates a baseline commit containing those files. Stage and commit only the paths named by each task.

## File Map

Create:

- `packages/asr-runtime/package.json` - workspace package metadata and scripts
- `packages/asr-runtime/tsconfig.json` - package TypeScript build configuration
- `packages/asr-runtime/src/index.ts` - public exports
- `packages/asr-runtime/src/audio.ts` - Float32 to PCM16 and base64 encoding
- `packages/asr-runtime/src/protocol.ts` - `lg-asr-ws-v1` wire and normalized event types
- `packages/asr-runtime/src/protocol-parser.ts` - unknown JSON payload validation
- `packages/asr-runtime/src/local-asr-session.ts` - WebSocket session state machine
- `packages/asr-runtime/src/audio.test.ts` - deterministic encoder tests
- `packages/asr-runtime/src/protocol-parser.test.ts` - parser tests
- `packages/asr-runtime/src/local-asr-session.test.ts` - lifecycle and failure tests
- `apps/desktop/src/asr/desktop-transcript-pipeline.ts` - final transcript to segment graph orchestration
- `apps/desktop/src/asr/desktop-transcript-pipeline.test.ts` - transcript ordering and graph tests
- `apps/desktop/src/desktop-runtime.test.ts` - host orchestration tests
- `apps/desktop/vitest.config.ts` - desktop Vitest configuration

Modify:

- `pnpm-lock.yaml` - workspace dependency lock
- `apps/extension/package.json` - add shared runtime dependency
- `apps/extension/src/content-script/content-script.ts` - replace only Local Bridge WebSocket code
- `apps/extension/src/content-script/content-script.test.ts` - preserve Local Bridge contract through shared client
- `apps/desktop/package.json` - add runtime/provider dependencies and test script
- `apps/desktop/src/desktop-runtime.ts` - replace timer-driven mock transcripts with ASR events
- `docs/product/desktop-v2-acceptance.md` - record the new runtime state and acceptance commands

Do not edit generated `.js` or `.d.ts` files currently present under `packages/*/src`.

### Task 1: Scaffold The Shared Package And Audio Codec

**Files:**
- Create: `packages/asr-runtime/package.json`
- Create: `packages/asr-runtime/tsconfig.json`
- Create: `packages/asr-runtime/src/index.ts`
- Create: `packages/asr-runtime/src/audio.ts`
- Create: `packages/asr-runtime/src/audio.test.ts`

- [ ] **Step 1: Write the failing audio codec test**

```ts
import { describe, expect, it } from 'vitest';
import { bytesToBase64, float32ToPcm16 } from './audio';

describe('float32ToPcm16', () => {
  it('clamps and converts the complete Float32 range', () => {
    expect(Array.from(float32ToPcm16(new Float32Array([-2, -1, -0.5, 0, 0.5, 1, 2])))).toEqual([
      -32768, -32768, -16384, 0, 16384, 32767, 32767,
    ]);
  });

  it('encodes bytes without Node Buffer', () => {
    expect(bytesToBase64(new Uint8Array([0, 1, 2, 253, 254, 255]))).toBe('AAEC/f7/');
  });
});
```

- [ ] **Step 2: Add package metadata and run the test to verify failure**

```json
{
  "name": "@listen-graphic/asr-runtime",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "lint": "eslint src --ext .ts",
    "test": "vitest run"
  },
  "devDependencies": {
    "vitest": "^1.6.0"
  }
}
```

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist" },
  "include": ["src"]
}
```

Run: `pnpm --filter @listen-graphic/asr-runtime test`

Expected: FAIL because `./audio` does not exist.

- [ ] **Step 3: Implement the minimal host-neutral codec**

```ts
export function float32ToPcm16(samples: Float32Array): Int16Array {
  const pcm = new Int16Array(samples.length);
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index]));
    pcm[index] = sample < 0 ? Math.round(sample * 32768) : Math.round(sample * 32767);
  }
  return pcm;
}

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function bytesToBase64(bytes: Uint8Array): string {
  let result = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index] ?? 0;
    const b = bytes[index + 1] ?? 0;
    const c = bytes[index + 2] ?? 0;
    const value = (a << 16) | (b << 8) | c;
    result += BASE64_ALPHABET[(value >> 18) & 63];
    result += BASE64_ALPHABET[(value >> 12) & 63];
    result += index + 1 < bytes.length ? BASE64_ALPHABET[(value >> 6) & 63] : '=';
    result += index + 2 < bytes.length ? BASE64_ALPHABET[value & 63] : '=';
  }
  return result;
}
```

Export both functions from `src/index.ts`.

- [ ] **Step 4: Run package checks**

Run:

```powershell
pnpm --filter @listen-graphic/asr-runtime test
pnpm --filter @listen-graphic/asr-runtime typecheck
pnpm --filter @listen-graphic/asr-runtime lint
```

Expected: all commands exit 0; Vitest reports 2 passing tests.

- [ ] **Step 5: Commit the package scaffold**

```powershell
git add packages/asr-runtime
git commit -m "feat(asr-runtime): add host-neutral audio codec"
```

### Task 2: Define And Parse The LG-ASR-WS V1 Protocol

**Files:**
- Create: `packages/asr-runtime/src/protocol.ts`
- Create: `packages/asr-runtime/src/protocol-parser.ts`
- Create: `packages/asr-runtime/src/protocol-parser.test.ts`
- Modify: `packages/asr-runtime/src/index.ts`

- [ ] **Step 1: Write parser tests for status, transcript, and errors**

```ts
import { describe, expect, it } from 'vitest';
import { parseLocalAsrMessage } from './protocol-parser';

describe('parseLocalAsrMessage', () => {
  it('normalizes a final transcript', () => {
    expect(parseLocalAsrMessage(JSON.stringify({
      type: 'transcript.final',
      utterance: {
        utteranceId: 'utt-1', revision: 2, text: '真实文本', startMs: 10, endMs: 900,
        finalReason: 'endpoint', stability: 'stable', confidence: 0.95,
      },
    }))).toEqual({
      type: 'transcript.final',
      utterance: {
        utteranceId: 'utt-1', revision: 2, text: '真实文本', startMs: 10, endMs: 900,
        finalReason: 'endpoint', stability: 'stable', confidence: 0.95,
      },
      raw: expect.any(Object),
    });
  });

  it('rejects malformed payloads with a stable code', () => {
    expect(() => parseLocalAsrMessage('{"type":"transcript.final"}')).toThrowError(
      expect.objectContaining({ code: 'INVALID_PROTOCOL_MESSAGE' }),
    );
  });
});
```

- [ ] **Step 2: Run the focused test and verify failure**

Run: `pnpm --filter @listen-graphic/asr-runtime test -- protocol-parser.test.ts`

Expected: FAIL because parser and protocol types do not exist.

- [ ] **Step 3: Add fixed public protocol types**

```ts
export type LocalAsrSessionState =
  | 'idle' | 'connecting' | 'starting' | 'streaming'
  | 'flushing' | 'stopping' | 'closed' | 'error';

export interface LocalAsrUtterance {
  utteranceId: string;
  revision: number;
  text: string;
  startMs: number;
  endMs: number;
  finalReason?: 'endpoint' | 'input_finished' | 'max_duration' | 'manual_flush' | 'vendor_defined' | 'error_recovery';
  stability?: 'stable';
  language?: string;
  confidence?: number;
}

export type LocalAsrEvent =
  | { type: 'status'; status: string; detail?: string; raw: unknown }
  | { type: 'session.started'; bridgeSessionId?: string; raw: unknown }
  | { type: 'transcript.partial'; utterance: LocalAsrUtterance; vendor?: Record<string, unknown>; raw: unknown }
  | { type: 'transcript.final'; utterance: LocalAsrUtterance; vendor?: Record<string, unknown>; raw: unknown }
  | { type: 'error'; error: LocalAsrRuntimeError; raw?: unknown }
  | { type: 'closed'; expected: boolean };

export class LocalAsrRuntimeError extends Error {
  constructor(
    public readonly code:
      | 'CONNECTION_FAILED' | 'HANDSHAKE_TIMEOUT' | 'INVALID_STATE'
      | 'INVALID_PROTOCOL_MESSAGE' | 'BRIDGE_ERROR' | 'UNEXPECTED_CLOSE'
      | 'FLUSH_TIMEOUT' | 'STOP_TIMEOUT',
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'LocalAsrRuntimeError';
  }
}
```

Implement `parseLocalAsrMessage(raw: string): LocalAsrEvent` with explicit object, string, and numeric guards. Unknown message types throw `INVALID_PROTOCOL_MESSAGE`; bridge `error` payloads return a normalized `error` event with code `BRIDGE_ERROR`.

- [ ] **Step 4: Run parser and package tests**

Run: `pnpm --filter @listen-graphic/asr-runtime test`

Expected: all codec and parser tests pass.

- [ ] **Step 5: Commit protocol types and parsing**

```powershell
git add packages/asr-runtime/src
git commit -m "feat(asr-runtime): define lg-asr-ws-v1 protocol"
```

### Task 3: Implement The Local ASR Session State Machine

**Files:**
- Create: `packages/asr-runtime/src/local-asr-session.ts`
- Create: `packages/asr-runtime/src/local-asr-session.test.ts`
- Modify: `packages/asr-runtime/src/index.ts`

- [ ] **Step 1: Create a fake WebSocket and failing lifecycle tests**

```ts
class FakeWebSocket {
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  send(value: string) { this.sent.push(value); }
  close() { this.readyState = 3; this.onclose?.(); }
  open() { this.readyState = 1; this.onopen?.(); }
  message(value: unknown) { this.onmessage?.({ data: JSON.stringify(value) }); }
}

function baseOptions(websocketFactory: WebSocketFactory): LocalAsrSessionOptions {
  return {
    endpoint: 'ws://127.0.0.1:15377/ws', sampleRate: 16_000,
    frameDurationMs: 40, sessionId: 'session-1', websocketFactory,
    handshakeTimeoutMs: 100, closeTimeoutMs: 100,
  };
}

it('waits for session.started before streaming frames', async () => {
  const socket = new FakeWebSocket();
  const session = new LocalAsrSession(baseOptions(() => socket));
  const connecting = session.connect();
  socket.open();
  expect(JSON.parse(socket.sent[0]).type).toBe('session.start');
  socket.message({ type: 'session.started', session: { bridgeSessionId: 'bridge-1' } });
  await connecting;
  session.sendFloat32Frame(new Float32Array([0, 0.5]), 100);
  expect(JSON.parse(socket.sent[1])).toMatchObject({
    type: 'audio.frame', audio: { codec: 'pcm_s16le', samples: 2 }, timestampMs: 100,
  });
});
```

Also add tests proving: frame-before-streaming throws `INVALID_STATE`; partial/final events are forwarded; malformed messages emit one error; `flush()` and `stop()` are idempotent; unexpected close emits `UNEXPECTED_CLOSE`; cleanup after connection failure is safe.

- [ ] **Step 2: Run the focused tests and verify failure**

Run: `pnpm --filter @listen-graphic/asr-runtime test -- local-asr-session.test.ts`

Expected: FAIL because `LocalAsrSession` is not defined.

- [ ] **Step 3: Implement the fixed session API**

```ts
export interface WebSocketLike {
  readonly readyState: number;
  onopen: (() => void) | null;
  onmessage: ((event: { data: string }) => void) | null;
  onerror: (() => void) | null;
  onclose: (() => void) | null;
  send(data: string): void;
  close(): void;
}

export type WebSocketFactory = (endpoint: string) => WebSocketLike;

export interface LocalAsrSessionOptions {
  endpoint: string;
  authToken?: string;
  sampleRate: number;
  frameDurationMs: number;
  sessionId: string;
  websocketFactory: WebSocketFactory;
  handshakeTimeoutMs?: number;
  closeTimeoutMs?: number;
}
```

`connect()` must create the socket, send this payload on `open`, and resolve only on `session.started`:

```ts
{
  type: 'session.start',
  version: '1',
  session: { sessionId: options.sessionId },
  audio: {
    codec: 'pcm_s16le', sampleRate: options.sampleRate,
    channels: 1, frameDurationMs: options.frameDurationMs,
  },
  auth: options.authToken ? { token: options.authToken } : undefined,
}
```

`sendFloat32Frame()` converts with Task 1 helpers and sends:

```ts
{
  type: 'audio.frame',
  audio: { codec: 'pcm_s16le', data: bytesToBase64(bytes), samples: pcm16.length },
  timestampMs,
}
```

Implement timer cleanup in one private method and make `flush()`/`stop()` reuse the same in-flight promise so repeated calls are idempotent.

- [ ] **Step 4: Run all shared package gates**

```powershell
pnpm --filter @listen-graphic/asr-runtime test
pnpm --filter @listen-graphic/asr-runtime typecheck
pnpm --filter @listen-graphic/asr-runtime lint
pnpm --filter @listen-graphic/asr-runtime build
```

Expected: all commands exit 0.

- [ ] **Step 5: Commit the state machine**

```powershell
git add packages/asr-runtime/src
git commit -m "feat(asr-runtime): add local asr session"
```

### Task 4: Migrate The Extension Local Bridge Branch

**Files:**
- Modify: `apps/extension/package.json`
- Modify: `apps/extension/src/content-script/content-script.ts`
- Modify: `apps/extension/src/content-script/content-script.test.ts`
- Modify: `pnpm-lock.yaml`

- [ ] **Step 1: Strengthen the existing Local Bridge test before migration**

In the existing test named `Local ASR Bridge 模式会建立 WebSocket，并把 partial/final 回传给 service worker`, retain its current assertions and add assertions for exact start/frame/flush/stop ordering:

```ts
expect(sentPayloads.map((payload) => payload.type)).toEqual([
  'session.start', 'audio.frame', 'audio.flush', 'session.stop',
]);
expect(sentPayloads[1]).toMatchObject({
  audio: { codec: 'pcm_s16le', samples: expect.any(Number) },
});
```

- [ ] **Step 2: Run the focused extension test before changing production code**

Run: `pnpm --filter extension test:run -- src/content-script/content-script.test.ts -t "Local ASR Bridge"`

Expected: PASS, establishing the migration baseline. If ordering differs, update the assertion to the documented current behavior before proceeding; do not weaken partial/final assertions.

- [ ] **Step 3: Add the dependency and split host session state**

Add `"@listen-graphic/asr-runtime": "workspace:*"` to extension dependencies and run `pnpm install` to update only workspace metadata and the lockfile.

Replace use of `realtimeSocket` for the external branch with:

```ts
import { LocalAsrSession, type LocalAsrEvent } from '@listen-graphic/asr-runtime';

let localAsrSession: LocalAsrSession | null = null;

const browserWebSocketFactory = (endpoint: string) => new WebSocket(endpoint);
```

Keep `realtimeSocket` for Tencent. In the Local Bridge connect function, construct the shared session from the active config, subscribe through `handleLocalAsrEvent`, await `connect()`, and assign it only after successful startup.

- [ ] **Step 4: Map normalized events to existing extension messages**

```ts
async function handleLocalAsrEvent(event: LocalAsrEvent) {
  if (!activeRealtimeStreamConfig || activeRealtimeStreamConfig.providerType !== 'external') return;
  if (event.type === 'transcript.partial') {
    await chrome.runtime.sendMessage({
      type: 'ASR_STREAM_PARTIAL_UPDATED', target: 'service-worker',
      payload: {
        text: event.utterance.text, provider: activeRealtimeStreamConfig.provider,
        utteranceId: event.utterance.utteranceId, revision: event.utterance.revision,
        kind: 'partial', stability: 'interim', startMs: event.utterance.startMs,
        endMs: event.utterance.endMs, vendor: event.vendor, raw: event.raw,
      },
    } as AppMessage);
    return;
  }
  if (event.type === 'transcript.final' && event.utterance.text.trim()) {
    await chrome.runtime.sendMessage({
      type: 'ASR_STREAM_FINAL_READY', target: 'service-worker',
      payload: {
        text: event.utterance.text, provider: activeRealtimeStreamConfig.provider,
        utteranceId: event.utterance.utteranceId, revision: event.utterance.revision,
        kind: 'final', finalReason: event.utterance.finalReason ?? 'vendor_defined',
        stability: event.utterance.stability ?? 'stable', transport: 'ws',
        language: event.utterance.language, startMs: event.utterance.startMs,
        endMs: event.utterance.endMs, confidence: event.utterance.confidence,
        vendor: event.vendor, raw: event.raw,
      },
    } as AppMessage);
    return;
  }
  if (event.type === 'error') {
    await chrome.runtime.sendMessage({
      type: 'ASR_STREAM_ERROR', target: 'service-worker',
      payload: {
        provider: activeRealtimeStreamConfig.provider,
        code: event.error.code, message: event.error.message,
      },
    } as AppMessage);
  }
}
```

Map partials to `ASR_STREAM_PARTIAL_UPDATED`, finals to `ASR_STREAM_FINAL_READY`, and errors to `ASR_STREAM_ERROR`, preserving every field currently emitted by `handleExternalBridgeMessage`. Route frames to `localAsrSession.sendFloat32Frame`. Replace the external branch in `closeRealtimeSocket()` with async `closeLocalAsrSession()`, which awaits `flush()` and then `stop()`; keep Tencent socket closure unchanged.

- [ ] **Step 5: Run extension migration gates**

```powershell
pnpm --filter extension test:run -- src/content-script/content-script.test.ts
pnpm test:ext:contract
pnpm test:ext:replay
pnpm --filter extension typecheck
pnpm --filter extension build
```

Expected: all commands exit 0. Local Bridge tests still observe partial/final messages; Tencent tests remain unchanged and pass.

- [ ] **Step 6: Commit extension migration**

```powershell
git add apps/extension/package.json apps/extension/src/content-script/content-script.ts apps/extension/src/content-script/content-script.test.ts pnpm-lock.yaml
git commit -m "refactor(extension): use shared asr runtime"
```

### Task 5: Add The Desktop Transcript Pipeline

**Files:**
- Create: `apps/desktop/src/asr/desktop-transcript-pipeline.ts`
- Create: `apps/desktop/src/asr/desktop-transcript-pipeline.test.ts`
- Create: `apps/desktop/vitest.config.ts`
- Modify: `apps/desktop/package.json`
- Modify: `pnpm-lock.yaml`

- [ ] **Step 1: Add the desktop test entry and dependencies**

Add dependencies:

```json
"@listen-graphic/asr-runtime": "workspace:*",
"@listen-graphic/providers": "workspace:*"
```

Add script: `"test": "vitest run"`.

Create `vitest.config.ts` with Node environment and source aliases matching `vite.config.ts` so workspace TypeScript sources resolve consistently.

- [ ] **Step 2: Write failing transcript pipeline tests**

```ts
function segment(segmentId: string, text: string): SegmentGraph {
  return {
    segmentId, sessionId: 'desktop-1', startMs: 0, endMs: 1000,
    provider: 'test', edges: [],
    nodes: [{
      id: `node-${segmentId}`, type: 'claim', text, timestampMs: 0,
      status: 'confirmed', evidenceChunkIds: [`chunk-${segmentId}`],
    }],
  };
}

function partialEvent(utteranceId: string, text: string): LocalAsrEvent {
  return {
    type: 'transcript.partial', raw: {},
    utterance: { utteranceId, revision: 1, text, startMs: 0, endMs: 400 },
  };
}

function finalEvent(
  utteranceId: string, text: string, startMs: number, endMs: number,
): LocalAsrEvent {
  return {
    type: 'transcript.final', raw: {},
    utterance: {
      utteranceId, revision: 2, text, startMs, endMs,
      finalReason: 'endpoint', stability: 'stable',
    },
  };
}

it('ignores partials and serializes final transcript graph updates', async () => {
  const structurer = { name: 'test', reset() {}, extractSegmentGraph: vi.fn() };
  structurer.extractSegmentGraph
    .mockResolvedValueOnce(segment('seg-1', '第一句'))
    .mockResolvedValueOnce(segment('seg-2', '第二句'));
  const graphs: MergedGraph[] = [];
  const pipeline = new DesktopTranscriptPipeline({
    sessionId: 'desktop-1', structurer, onGraph: (graph) => graphs.push(graph),
  });

  pipeline.accept(partialEvent('utt-1', '第一'));
  pipeline.accept(finalEvent('utt-1', '第一句', 0, 800));
  pipeline.accept(finalEvent('utt-2', '第二句', 900, 1600));
  await pipeline.drain();

  expect(structurer.extractSegmentGraph).toHaveBeenCalledTimes(2);
  expect(graphs.at(-1)?.nodes.map((node) => node.text)).toEqual(['第一句', '第二句']);
});
```

Add a second test proving duplicate `(utteranceId, revision)` finals are ignored and a structurer rejection reaches `onError` without corrupting the previous graph.

- [ ] **Step 3: Run the desktop focused test and verify failure**

Run: `pnpm --filter desktop test -- src/asr/desktop-transcript-pipeline.test.ts`

Expected: FAIL because `DesktopTranscriptPipeline` does not exist.

- [ ] **Step 4: Implement final-only ordered processing**

```ts
export class DesktopTranscriptPipeline {
  private graph: MergedGraph;
  private transcriptWindow: TranscriptChunk[] = [];
  private seenFinals = new Set<string>();
  private queue = Promise.resolve();

  accept(event: LocalAsrEvent) {
    if (event.type !== 'transcript.final') return;
    const key = `${event.utterance.utteranceId}:${event.utterance.revision}`;
    if (this.seenFinals.has(key)) return;
    this.seenFinals.add(key);
    this.queue = this.queue.then(() => this.processFinal(event)).catch(this.onError);
  }

  drain() { return this.queue; }
}
```

`processFinal()` creates a `TranscriptChunk` whose `chunkId` includes session, utterance, and revision; appends it to the window; calls `structurer.extractSegmentGraph`; applies `mergeSegmentGraph`; and invokes `onGraph`. Initialize an empty `MergedGraph` with the desktop session ID and revision 0.

- [ ] **Step 5: Run desktop pipeline checks**

```powershell
pnpm --filter desktop test -- src/asr/desktop-transcript-pipeline.test.ts
pnpm --filter desktop typecheck
```

Expected: all pipeline tests pass and typecheck exits 0.

- [ ] **Step 6: Commit the desktop pipeline**

```powershell
git add apps/desktop/package.json apps/desktop/vitest.config.ts apps/desktop/src/asr pnpm-lock.yaml
git commit -m "feat(desktop): add transcript graph pipeline"
```

### Task 6: Connect Desktop Audio To The Shared Session

**Files:**
- Create: `apps/desktop/src/desktop-runtime.test.ts`
- Modify: `apps/desktop/src/desktop-runtime.ts`

- [ ] **Step 1: Make DesktopRuntime dependencies injectable and write failing orchestration tests**

```ts
interface DesktopRuntimeDependencies {
  createAudioSource(kind: AudioSourceKind): DesktopAudioSource;
  createAsrSession(options: LocalAsrSessionOptions): LocalAsrSession;
  createStructurer(): StructurerProvider;
  now(): number;
}
```

Test this exact sequence with fakes:

```ts
expect(calls).toEqual([
  'asr.connect',
  'audio.start',
  'asr.frame',
  'asr.flush',
  'asr.stop',
  'audio.stop',
]);
```

Add assertions that a partial event does not change graph revision, a final event does, and a bridge error sets `audioError`/ASR status without invoking generated transcript fallback.

- [ ] **Step 2: Run the runtime test and verify failure**

Run: `pnpm --filter desktop test -- src/desktop-runtime.test.ts`

Expected: FAIL because runtime dependencies and shared ASR orchestration are absent.

- [ ] **Step 3: Replace timer-driven mock generation**

Remove `MOCK_TRANSCRIPTS`, `timer`, `transcriptIndex`, `emitMockTranscript`, and `clearMockTimer`.

Add snapshot fields:

```ts
asrStatus: 'idle' | 'connecting' | 'streaming' | 'error';
partialTranscript: string;
finalTranscriptCount: number;
```

On `startSession()`:

1. Create `LocalAsrSession` using `ws://127.0.0.1:15377/ws`, 16 kHz, 40 ms, and the desktop session ID.
2. Subscribe to ASR events.
3. Await ASR `connect()` before starting capture so frames cannot be dropped during handshake.
4. Start the selected audio source.
5. Create `DesktopTranscriptPipeline` with `MockStructurerProvider`.

On every audio `frame`, keep existing diagnostics and call:

```ts
this.asrSession?.sendFloat32Frame(event.frame, event.timestamp);
```

On ASR partial, update `partialTranscript`. On final, clear the partial text, increment `finalTranscriptCount`, and pass the event to the pipeline. On graph callback, replace `snapshot.graph`.

- [ ] **Step 4: Implement deterministic cleanup**

Use this order in `stopSession()` and protect each cleanup so later resources still release:

```ts
const asr = this.asrSession;
this.asrSession = null;
if (asr) {
  try { await asr.flush(); } catch (error) { this.addLog(error instanceof Error ? error.message : String(error)); }
  try { await asr.stop(); } catch (error) { this.addLog(error instanceof Error ? error.message : String(error)); }
}
await this.transcriptPipeline?.drain();
this.transcriptPipeline = null;
await source?.stop();
```

Use the existing `startToken` check after each awaited startup boundary so a concurrent stop cannot revive a cancelled session.

- [ ] **Step 5: Run desktop automated gates**

```powershell
pnpm --filter desktop test
pnpm --filter desktop lint
pnpm --filter desktop typecheck
pnpm --filter desktop build
pnpm --filter desktop smoke
```

Expected: all commands exit 0; no test contains timer-based `MOCK_TRANSCRIPTS` expectations.

- [ ] **Step 6: Commit desktop runtime integration**

```powershell
git add apps/desktop/src/desktop-runtime.ts apps/desktop/src/desktop-runtime.test.ts
git commit -m "feat(desktop): stream audio through local asr"
```

### Task 7: Run Mock Bridge And Sherpa Acceptance

**Files:**
- Modify: `docs/product/desktop-v2-acceptance.md`

- [ ] **Step 1: Run the mock bridge protocol closure**

Terminal A:

```powershell
pnpm dev:mock-asr-bridge
```

Expected: bridge listens on `ws://127.0.0.1:15377/ws` and health endpoint reports OK.

Terminal B:

```powershell
pnpm dev:desktop
```

Manual assertions for microphone and system audio separately:

- session reaches ASR streaming state
- audio frame count increases
- partial text does not add a node
- mock final text `今天天气不错，我们开始测试本地 bridge。` appears in a graph node
- stopping prevents further frame and graph updates
- bridge and audio capture release without renderer errors

- [ ] **Step 2: Run the Sherpa closure without changing desktop code**

Start the existing local Sherpa bridge using the documented model paths:

```powershell
pnpm dev:sherpa-asr-bridge -- --encoder .tmp/sherpa-model/sherpa-onnx-streaming-paraformer-bilingual-zh-en/encoder.int8.onnx --decoder .tmp/sherpa-model/sherpa-onnx-streaming-paraformer-bilingual-zh-en/decoder.int8.onnx --tokens .tmp/sherpa-model/sherpa-onnx-streaming-paraformer-bilingual-zh-en/tokens.txt --model-name sherpa-onnx-streaming-paraformer-bilingual-zh-en
```

Expected: `/healthz` reports protocol `lg-asr-ws-v1`. Speak or play a known sentence; verify a final transcript reflecting that audio appears in a graph node. If local model prerequisites are absent, record Phase 2 as not run rather than claiming success.

- [ ] **Step 3: Run final repository gates**

```powershell
pnpm --filter @listen-graphic/asr-runtime test
pnpm test:ext:contract
pnpm test:ext:replay
pnpm --filter desktop test
pnpm lint
pnpm typecheck
pnpm build
```

Expected: every command exits 0. Existing extension warnings may be recorded, but new failures block completion.

- [ ] **Step 4: Update the acceptance document with observed evidence**

Replace the statements that desktop graph generation is timer-driven mock text. Record:

- shared package and protocol path
- exact automated commands and outcomes
- mock bridge manual result
- Sherpa result or explicit prerequisite blocker
- remaining limits: mock structurer, no mixing, no settings UI, no packaging

- [ ] **Step 5: Commit acceptance evidence**

```powershell
git add docs/product/desktop-v2-acceptance.md
git commit -m "docs: record desktop asr runtime acceptance"
```

## Completion Criteria

The work is complete only when:

- `packages/asr-runtime` owns all Local Bridge encoding, parsing, and WebSocket session behavior.
- Extension Local Bridge tests pass through the shared package and Tencent behavior remains unchanged.
- Desktop contains no timer-driven `MOCK_TRANSCRIPTS` graph generation.
- Mock bridge audio-to-final-to-graph closure is manually observed.
- Sherpa is either manually verified with real audio or explicitly reported as blocked by missing local prerequisites.
- Shared package, extension contract/replay, desktop tests/build/smoke, root lint/typecheck/build all pass.
- Documentation distinguishes real ASR integration from still-mock structurer quality.
