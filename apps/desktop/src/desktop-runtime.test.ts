import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LocalAsrEvent, LocalAsrSessionOptions, WebSocketLike } from '@listen-graphic/asr-runtime';
import { LocalAsrSession } from '@listen-graphic/asr-runtime';
import type { MergedGraph, SegmentGraph, StructurerProvider, TranscriptChunk } from '@listen-graphic/schema';
import { DesktopRuntime, type DesktopRuntimeDependencies } from './desktop-runtime';

// 可控的假 WebSocket：构造后立即可触发 open / message。
class FakeSocket implements WebSocketLike {
  readyState = 1;
  onopen: ((event?: any) => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: ((event?: any) => void) | null = null;
  onclose: ((event?: any) => void) | null = null;
  sent: string[] = [];
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.readyState = 3;
    this.onclose?.();
  }
}

function fakeStructurer(): StructurerProvider & { calls: string[]; extract: ReturnType<typeof vi.fn> } {
  const extract = vi.fn(
    async (input: { transcriptWindow: TranscriptChunk[] }): Promise<SegmentGraph> => {
      const last = input.transcriptWindow[input.transcriptWindow.length - 1];
      return {
        segmentId: `seg-${last.chunkId}`,
        sessionId: 'desktop-test',
        startMs: last.startMs,
        endMs: last.endMs,
        provider: 'mock-structurer',
        nodes: [{ id: `n-${last.chunkId}`, type: 'claim', text: last.text, timestampMs: last.startMs, status: 'confirmed', evidenceChunkIds: [last.chunkId] }],
        edges: [],
      };
    },
  );
  return { name: 'mock-structurer', reset() {}, extractSegmentGraph: extract } as unknown as StructurerProvider & {
    calls: string[];
    extract: ReturnType<typeof vi.fn>;
  };
}

function fakeAudioSource() {
  const listeners = new Set<(event: any) => void>();
  let started = false;
  return {
    kind: 'microphone' as const,
    calls: [] as string[],
    listeners,
    start: vi.fn(async () => {
      started = true;
      listeners.forEach((l) => l({ type: 'started', sourceKind: 'microphone', sampleRate: 16000, trackLabel: 'mic' }));
    }),
    stop: vi.fn(async () => {
      listeners.forEach((l) => l({ type: 'ended', sourceKind: 'microphone', reason: 'stopped' }));
    }),
    subscribe(listener: (event: any) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    emitFrame(frame: Float32Array, timestamp: number) {
      listeners.forEach((l) => l({ type: 'frame', sourceKind: 'microphone', frame, frameIndex: 0, sampleRate: 16000, timestamp, level: { rms: 0.01, peak: 0.05 } }));
    },
    isStarted() {
      return started;
    },
  };
}

function makeDependencies(): { deps: DesktopRuntimeDependencies; socket: FakeSocket; audio: ReturnType<typeof fakeAudioSource>; structurer: ReturnType<typeof fakeStructurer>; calls: string[] } {
  const calls: string[] = [];
  const socket = new FakeSocket();
  const audio = fakeAudioSource();
  const structurer = fakeStructurer();
  const deps: DesktopRuntimeDependencies = {
    createAudioSource: () => audio as any,
    createAsrSession: (options: LocalAsrSessionOptions) => {
      // 注入短超时，避免停止流程因 FakeSocket 不主动关闭而阻塞测试。
      return new LocalAsrSession({ ...options, closeTimeoutMs: 30, handshakeTimeoutMs: 50 });
    },
    createStructurer: () => structurer as unknown as StructurerProvider,
    websocketFactory: () => socket,
  };
  return { deps, socket, audio, structurer, calls };
}

describe('DesktopRuntime ASR 集成', () => {
  let env: ReturnType<typeof makeDependencies>;

  beforeEach(() => {
    env = makeDependencies();
  });

  it('启动顺序：先连 ASR 再启音频，帧送入 ASR', async () => {
    const runtime = new DesktopRuntime(env.deps);
    const startPromise = runtime.startSession();

    env.socket.onopen?.();
    env.socket.onmessage?.({ data: JSON.stringify({ type: 'session.started', session: { bridgeSessionId: 'b1' } }) });
    await startPromise;

    expect(env.audio.isStarted()).toBe(true);

    const beforeFrames = env.socket.sent.length;
    env.audio.emitFrame(new Float32Array([0, 0.5, -0.5]), 123);
    const framePayload = env.socket.sent
      .slice(beforeFrames)
      .map((raw) => JSON.parse(raw))
      .find((p) => p.type === 'audio.frame');
    expect(framePayload).toMatchObject({ type: 'audio.frame', timestampMs: 123 });

    await runtime.stopSession();

    const sentTypes = env.socket.sent.map((raw) => JSON.parse(raw).type);
    expect(sentTypes).toContain('audio.flush');
    expect(sentTypes).toContain('session.stop');
  });

  it('partial 事件不改变图谱 revision', async () => {
    const runtime = new DesktopRuntime(env.deps);
    const startPromise = runtime.startSession();
    env.socket.onopen?.();
    env.socket.onmessage?.({ data: JSON.stringify({ type: 'session.started', session: { bridgeSessionId: 'b1' } }) });
    await startPromise;

    const revisionBefore = runtime.getSnapshot().graph.revision;
    env.socket.onmessage?.({
      data: JSON.stringify({
        type: 'transcript.partial',
        utterance: { utteranceId: 'u1', revision: 1, text: '部分', startMs: 0, endMs: 100 },
      }),
    });
    await new Promise((r) => setTimeout(r, 0));

    expect(runtime.getSnapshot().graph.revision).toBe(revisionBefore);
    expect(runtime.getSnapshot().partialTranscript).toBe('部分');
  });

  it('final 事件经 structurer 产生新图谱节点', async () => {
    const runtime = new DesktopRuntime(env.deps);
    const startPromise = runtime.startSession();
    env.socket.onopen?.();
    env.socket.onmessage?.({ data: JSON.stringify({ type: 'session.started', session: { bridgeSessionId: 'b1' } }) });
    await startPromise;

    env.socket.onmessage?.({
      data: JSON.stringify({
        type: 'transcript.final',
        utterance: { utteranceId: 'u1', revision: 2, text: '最终句', startMs: 0, endMs: 500, finalReason: 'endpoint', stability: 'stable' },
      }),
    });
    await new Promise((r) => setTimeout(r, 10));

    const graph = runtime.getSnapshot().graph as MergedGraph;
    expect(graph.nodes.length).toBeGreaterThan(0);
    expect(graph.nodes.some((n) => n.text === '最终句')).toBe(true);
    expect(runtime.getSnapshot().finalTranscriptCount).toBe(1);
  });

  it('ASR error 设置错误状态但不调用生成的转写回退', async () => {
    const runtime = new DesktopRuntime(env.deps);
    const startPromise = runtime.startSession();
    env.socket.onopen?.();
    env.socket.onmessage?.({ data: JSON.stringify({ type: 'session.started', session: { bridgeSessionId: 'b1' } }) });
    await startPromise;

    env.socket.onmessage?.({
      data: JSON.stringify({ type: 'error', error: { code: 'DECODE_FAILED', message: '坏帧' } }),
    });
    await new Promise((r) => setTimeout(r, 0));

    expect(runtime.getSnapshot().asrStatus).toBe('error');
    // 图谱不应因此产生新节点。
    expect(runtime.getSnapshot().graph.nodes.length).toBe(0);
  });
});
