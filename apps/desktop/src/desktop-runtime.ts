import type { MergedGraph } from '@listen-graphic/schema';
import {
  LocalAsrSession,
  type LocalAsrEvent,
  type LocalAsrSessionOptions,
  type WebSocketLike,
} from '@listen-graphic/asr-runtime';
import { MockStructurerProvider } from '@listen-graphic/providers';
import {
  createDesktopAudioSource,
  type DesktopAudioLevel,
  type DesktopAudioSource,
  type DesktopAudioSourceEvent,
  type DesktopAudioSourceKind,
} from './audio/desktop-audio-source';
import { DesktopTranscriptPipeline } from './asr/desktop-transcript-pipeline';

export type AudioSourceKind = DesktopAudioSourceKind;
export type DesktopSessionState = 'idle' | 'capturing' | 'stopped';
export type DesktopAudioStatus = 'idle' | 'starting' | 'capturing' | 'ended' | 'error';
export type DesktopAsrStatus = 'idle' | 'connecting' | 'streaming' | 'error';

export interface DesktopRuntimeSnapshot {
  audioError: string | null;
  audioLevel: DesktopAudioLevel;
  audioSourceKind: AudioSourceKind;
  audioStatus: DesktopAudioStatus;
  asrStatus: DesktopAsrStatus;
  frameCount: number;
  graph: MergedGraph;
  lastFrameAt: number | null;
  logs: string[];
  partialTranscript: string;
  finalTranscriptCount: number;
  sampleRate: number | null;
  sessionId: string | null;
  sessionState: DesktopSessionState;
}

type Listener = (snapshot: DesktopRuntimeSnapshot) => void;

/** 运行时依赖工厂，默认用真实实现；测试可注入假对象。 */
export interface DesktopRuntimeDependencies {
  createAudioSource?(kind: AudioSourceKind): DesktopAudioSource;
  createAsrSession?(options: LocalAsrSessionOptions): LocalAsrSession;
  createStructurer?(): StructurerProviderLike;
  /** WebSocket 工厂，默认用浏览器/Node 原生 WebSocket。 */
  websocketFactory?(endpoint: string): WebSocketLike;
}

// 仅依赖结构化器的结构子集，避免在 desktop-runtime.ts 顶部引入完整 provider 类型循环。
interface StructurerProviderLike {
  name: string;
  extractSegmentGraph(input: {
    sessionId: string;
    transcriptWindow: import('@listen-graphic/schema').TranscriptChunk[];
    previousGraph?: MergedGraph;
    language?: string;
  }): Promise<import('@listen-graphic/schema').SegmentGraph>;
  reset?(): void;
}

const DEFAULT_ENDPOINT = 'ws://127.0.0.1:15377/ws';
const DEFAULT_SAMPLE_RATE = 16_000;
const DEFAULT_FRAME_DURATION_MS = 40;
// 握手等待与服务端关闭确认的超时上限。过长会让停止流程阻塞，过短易误判。
const DEFAULT_HANDSHAKE_TIMEOUT_MS = 10_000;
const DEFAULT_CLOSE_TIMEOUT_MS = 2_000;
const EMPTY_LEVEL: DesktopAudioLevel = { rms: 0, peak: 0 };

function createEmptyGraph(): MergedGraph {
  return {
    sessionId: '',
    revision: 0,
    topics: [],
    nodes: [],
    edges: [],
    updatedAt: Date.now(),
  };
}

function createInitialGraph(sessionId: string): MergedGraph {
  return {
    sessionId,
    revision: 0,
    topics: [{ topicId: 'desktop-v1', title: '桌面端会话', startMs: 0, endMs: 0 }],
    nodes: [],
    edges: [],
    updatedAt: Date.now(),
  };
}

function labelForSource(kind: AudioSourceKind) {
  return kind === 'microphone' ? '麦克风' : '系统声音';
}

// Node 与浏览器共用的 WebSocket 工厂。Node 端（测试）需 ws 包或注入；
// 浏览器/Electron 渲染端用全局 WebSocket。
function defaultWebsocketFactory(endpoint: string): WebSocketLike {
  const ctor =
    (globalThis as unknown as { WebSocket?: typeof WebSocket; ws?: unknown }).WebSocket ??
    null;
  if (!ctor) {
    throw new Error('当前环境无 WebSocket，请通过依赖注入提供 websocketFactory');
  }
  return new ctor(endpoint) as unknown as WebSocketLike;
}

export class DesktopRuntime {
  private snapshot: DesktopRuntimeSnapshot = {
    audioError: null,
    audioLevel: EMPTY_LEVEL,
    audioSourceKind: 'microphone',
    audioStatus: 'idle',
    asrStatus: 'idle',
    frameCount: 0,
    graph: createEmptyGraph(),
    lastFrameAt: null,
    logs: [],
    partialTranscript: '',
    finalTranscriptCount: 0,
    sampleRate: null,
    sessionId: null,
    sessionState: 'idle',
  };

  private listeners = new Set<Listener>();
  private audioSource: DesktopAudioSource | null = null;
  private audioUnsubscribe: (() => void) | null = null;
  private asrSession: LocalAsrSession | null = null;
  private transcriptPipeline: DesktopTranscriptPipeline | null = null;
  private asrUnsubscribe: (() => void) | null = null;
  private startPromise: Promise<void> | null = null;
  private startToken = 0;
  private lastAudioDiagnosticAt = 0;
  private silentFrameStreak = 0;
  private readonly deps: DesktopRuntimeDependencies;

  constructor(deps: DesktopRuntimeDependencies = {}) {
    this.deps = deps;
  }

  getSnapshot() {
    return this.snapshot;
  }

  subscribe(listener: Listener) {
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => {
      this.listeners.delete(listener);
    };
  }

  setAudioSourceKind(kind: AudioSourceKind) {
    if (this.snapshot.sessionState === 'capturing') return;
    this.setSnapshot({ audioSourceKind: kind });
    this.addLog(`输入源: ${labelForSource(kind)}`);
  }

  async startSession() {
    if (this.snapshot.sessionState === 'capturing' || this.startPromise) return;

    const sessionId = `desktop_${Date.now()}`;
    const startToken = this.startToken + 1;
    this.startToken = startToken;
    this.lastAudioDiagnosticAt = 0;
    this.silentFrameStreak = 0;
    this.setSnapshot({
      audioError: null,
      audioLevel: EMPTY_LEVEL,
      audioStatus: 'starting',
      asrStatus: 'connecting',
      frameCount: 0,
      graph: createInitialGraph(sessionId),
      logs: [],
      lastFrameAt: null,
      partialTranscript: '',
      finalTranscriptCount: 0,
      sampleRate: null,
      sessionId,
      sessionState: 'idle',
    });
    this.addLog(`准备采集: ${labelForSource(this.snapshot.audioSourceKind)}`);

    this.startPromise = this.runStart(sessionId, startToken);
    await this.startPromise;
  }

  private async runStart(sessionId: string, startToken: number): Promise<void> {
    // 1. 建立 ASR 会话并完成握手（在启动音频前，避免握手期丢帧）。
    const session = this.createAsrSession(sessionId);
    this.asrUnsubscribe = session.on((event) => this.handleAsrEvent(event));
    this.asrSession = session;

    try {
      await session.connect();
    } catch (error) {
      this.handleStartupFailure(error, startToken);
      throw error;
    }

    if (startToken !== this.startToken) {
      await this.safelyStopSession(session);
      return;
    }

    // 2. 启动音频采集。
    const source = this.createAudioSource();
    this.audioSource = source;
    this.audioUnsubscribe = source.subscribe((event) => this.handleAudioEvent(event));

    try {
      await source.start();
    } catch (error) {
      this.handleStartupFailure(error, startToken);
      throw error;
    }

    if (startToken !== this.startToken) {
      await this.safelyStopSession(session, source);
      return;
    }

    // 3. 建立转写→图谱管道（用 MockStructurerProvider，真实结构化待后续接入）。
    this.transcriptPipeline = new DesktopTranscriptPipeline({
      sessionId,
      structurer: this.createStructurer(),
      onGraph: (graph) => this.setSnapshot({ graph }),
      onError: (error) => this.addLog(`结构化失败: ${error.message}`),
    });

    this.setSnapshot({ sessionState: 'capturing', asrStatus: 'streaming' });
    this.addLog(`会话开始: ${sessionId}`);
    this.addLog(`输入源: ${labelForSource(this.snapshot.audioSourceKind)} (真实采集)`);
    this.addLog('语义图谱: ASR final 驱动 (structurer=mock)');
  }

  async stopSession() {
    this.startToken += 1;
    const token = this.startToken;

    const session = this.asrSession;
    const source = this.audioSource;
    this.asrSession = null;
    this.audioSource = null;

    this.asrUnsubscribe?.();
    this.asrUnsubscribe = null;
    this.audioUnsubscribe?.();
    this.audioUnsubscribe = null;

    // 确定性清理：每个资源独立 try/catch，确保后续资源仍能释放。
    if (session) {
      try {
        await session.flush();
      } catch (error) {
        this.addLog(error instanceof Error ? error.message : String(error));
      }
      try {
        await session.stop();
      } catch (error) {
        this.addLog(error instanceof Error ? error.message : String(error));
      }
    }

    await this.transcriptPipeline?.drain();
    this.transcriptPipeline = null;

    if (source) {
      try {
        await source.stop();
      } catch (error) {
        this.addLog(error instanceof Error ? error.message : String(error));
      }
    }

    if (token === this.startToken) {
      if (this.snapshot.sessionState === 'capturing' || this.snapshot.audioStatus === 'starting') {
        this.addLog('会话已停止');
      }
      this.setSnapshot({
        audioLevel: EMPTY_LEVEL,
        audioStatus: 'idle',
        asrStatus: 'idle',
        lastFrameAt: null,
        partialTranscript: '',
        sessionId: null,
        sessionState: 'stopped',
      });
    }

    this.startPromise = null;
  }

  private createAsrSession(sessionId: string): LocalAsrSession {
    const options: LocalAsrSessionOptions = {
      endpoint: DEFAULT_ENDPOINT,
      sampleRate: DEFAULT_SAMPLE_RATE,
      frameDurationMs: DEFAULT_FRAME_DURATION_MS,
      sessionId,
      websocketFactory: this.deps.websocketFactory ?? defaultWebsocketFactory,
      handshakeTimeoutMs: DEFAULT_HANDSHAKE_TIMEOUT_MS,
      closeTimeoutMs: DEFAULT_CLOSE_TIMEOUT_MS,
    };
    return this.deps.createAsrSession
      ? this.deps.createAsrSession(options)
      : new LocalAsrSession(options);
  }

  private createAudioSource(): DesktopAudioSource {
    return this.deps.createAudioSource
      ? this.deps.createAudioSource(this.snapshot.audioSourceKind)
      : createDesktopAudioSource(this.snapshot.audioSourceKind);
  }

  private createStructurer(): StructurerProviderLike {
    return this.deps.createStructurer
      ? this.deps.createStructurer()
      : new MockStructurerProvider();
  }

  private async safelyStopSession(
    session: LocalAsrSession,
    source?: DesktopAudioSource,
  ): Promise<void> {
    try {
      await session.flush();
    } catch {
      /* 忽略 */
    }
    try {
      await session.stop();
    } catch {
      /* 忽略 */
    }
    if (source) {
      try {
        await source.stop();
      } catch {
        /* 忽略 */
      }
    }
  }

  private handleStartupFailure(error: unknown, _startToken: number): void {
    this.asrUnsubscribe?.();
    this.asrUnsubscribe = null;
    this.audioUnsubscribe?.();
    this.audioUnsubscribe = null;
    this.asrSession = null;
    this.audioSource = null;
    this.transcriptPipeline = null;
    const message = error instanceof Error ? error.message : String(error);
    this.setSnapshot({
      audioError: message,
      audioLevel: EMPTY_LEVEL,
      audioStatus: 'error',
      asrStatus: 'error',
      sessionId: null,
      sessionState: 'idle',
    });
    this.addLog(`启动失败: ${message}`);
    this.startPromise = null;
  }

  private handleAudioEvent(event: DesktopAudioSourceEvent) {
    if (event.type === 'started') {
      this.setSnapshot({
        audioError: null,
        audioStatus: 'capturing',
        sampleRate: event.sampleRate,
      });
      this.addLog(`采集已启动: ${event.trackLabel}, ${event.sampleRate} Hz`);
      return;
    }

    if (event.type === 'frame') {
      this.updateAudioDiagnostics(event.level);
      this.setSnapshot({
        audioLevel: event.level,
        frameCount: this.snapshot.frameCount + 1,
        lastFrameAt: event.timestamp,
        sampleRate: event.sampleRate,
      });
      // 音频帧送入 ASR 会话。
      try {
        this.asrSession?.sendFloat32Frame(event.frame, event.timestamp);
      } catch (error) {
        this.addLog(`ASR 帧发送失败: ${error instanceof Error ? error.message : String(error)}`);
      }
      return;
    }

    if (event.type === 'level') {
      this.setSnapshot({
        audioLevel: event.level,
        lastFrameAt: event.timestamp,
      });
      return;
    }

    if (event.type === 'ended') {
      this.setSnapshot({
        audioLevel: EMPTY_LEVEL,
        audioStatus: 'ended',
      });
      this.addLog(event.reason);
      void this.stopSession();
      return;
    }

    this.setSnapshot({
      audioError: event.error.message,
      audioLevel: EMPTY_LEVEL,
      audioStatus: 'error',
    });
    this.addLog(`采集错误: ${event.error.message}`);
  }

  private handleAsrEvent(event: LocalAsrEvent): void {
    if (event.type === 'transcript.partial') {
      this.setSnapshot({ partialTranscript: event.utterance.text });
      return;
    }

    if (event.type === 'transcript.final') {
      // 清空 partial 显示，计数并交给管道。
      this.setSnapshot({
        partialTranscript: '',
        finalTranscriptCount: this.snapshot.finalTranscriptCount + 1,
      });
      this.transcriptPipeline?.accept(event);
      return;
    }

    if (event.type === 'error') {
      this.setSnapshot({ asrStatus: 'error' });
      this.addLog(`ASR 错误: ${event.error.message}`);
      return;
    }

    if (event.type === 'closed' && !event.expected) {
      this.setSnapshot({ asrStatus: 'error' });
      this.addLog('ASR 连接意外关闭');
    }
  }

  private updateAudioDiagnostics(level: DesktopAudioLevel) {
    const now = Date.now();
    const isSilent = level.peak < 0.0005 && level.rms < 0.0002;
    this.silentFrameStreak = isSilent ? this.silentFrameStreak + 1 : 0;

    if (now - this.lastAudioDiagnosticAt < 5000) return;
    this.lastAudioDiagnosticAt = now;

    if (isSilent && this.silentFrameStreak > 25) {
      this.addLog('音频帧: 持续接近静音，检查输入设备/系统共享源是否真的有声音');
      return;
    }

    if (!isSilent) {
      this.addLog(
        `音频电平: RMS ${(level.rms * 100).toFixed(2)}%, Peak ${(level.peak * 100).toFixed(2)}%`,
      );
    }
  }

  private addLog(message: string) {
    const time = new Date().toLocaleTimeString();
    this.setSnapshot({
      logs: [`[${time}] ${message}`, ...this.snapshot.logs].slice(0, 80),
    });
  }

  private setSnapshot(next: Partial<DesktopRuntimeSnapshot>) {
    this.snapshot = { ...this.snapshot, ...next };
    for (const listener of this.listeners) listener(this.snapshot);
  }
}
