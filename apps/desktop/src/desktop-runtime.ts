import type {
  EdgeType,
  GraphEdge,
  GraphNode,
  MergedGraph,
  NodeType,
} from '@listen-graphic/schema';
import {
  createDesktopAudioSource,
  type DesktopAudioLevel,
  type DesktopAudioSource,
  type DesktopAudioSourceEvent,
  type DesktopAudioSourceKind,
} from './audio/desktop-audio-source';

export type AudioSourceKind = DesktopAudioSourceKind;
export type DesktopSessionState = 'idle' | 'capturing' | 'stopped';
export type DesktopAudioStatus = 'idle' | 'starting' | 'capturing' | 'ended' | 'error';

export interface DesktopRuntimeSnapshot {
  audioError: string | null;
  audioLevel: DesktopAudioLevel;
  audioSourceKind: AudioSourceKind;
  audioStatus: DesktopAudioStatus;
  frameCount: number;
  graph: MergedGraph;
  lastFrameAt: number | null;
  logs: string[];
  sampleRate: number | null;
  sessionId: string | null;
  sessionState: DesktopSessionState;
}

type Listener = (snapshot: DesktopRuntimeSnapshot) => void;

const MOCK_TRANSCRIPTS = [
  '桌面端正在监听当前输入源。',
  '第一版先验证桌面壳和音频源抽象。',
  '系统声音和麦克风会共享同一条结构化链路。',
  '图谱层继续复用现有渲染和语义模型。',
  '真实 ASR 接入会在运行时边界稳定后推进。',
];

const NODE_TYPES: NodeType[] = ['claim', 'reason', 'example', 'question', 'conclusion'];
const EDGE_TYPES: EdgeType[] = ['supports', 'causes', 'follows', 'example_of'];
const SPEAKERS = ['桌面端', '输入源', 'Runtime'];
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

export class DesktopRuntime {
  private snapshot: DesktopRuntimeSnapshot = {
    audioError: null,
    audioLevel: EMPTY_LEVEL,
    audioSourceKind: 'microphone',
    audioStatus: 'idle',
    frameCount: 0,
    graph: createEmptyGraph(),
    lastFrameAt: null,
    logs: [],
    sampleRate: null,
    sessionId: null,
    sessionState: 'idle',
  };

  private listeners = new Set<Listener>();
  private audioSource: DesktopAudioSource | null = null;
  private audioUnsubscribe: (() => void) | null = null;
  private startPromise: Promise<void> | null = null;
  private startToken = 0;
  private timer: number | null = null;
  private lastAudioDiagnosticAt = 0;
  private silentFrameStreak = 0;
  private transcriptIndex = 0;
  private sessionStartMs = 0;

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
    this.transcriptIndex = 0;
    this.lastAudioDiagnosticAt = 0;
    this.silentFrameStreak = 0;
    this.setSnapshot({
      audioError: null,
      audioLevel: EMPTY_LEVEL,
      audioStatus: 'starting',
      frameCount: 0,
      graph: createInitialGraph(sessionId),
      logs: [],
      lastFrameAt: null,
      sampleRate: null,
      sessionId,
      sessionState: 'idle',
    });
    this.addLog(`准备采集: ${labelForSource(this.snapshot.audioSourceKind)}`);

    const source = createDesktopAudioSource(this.snapshot.audioSourceKind);
    this.audioSource = source;
    this.audioUnsubscribe = source.subscribe((event) => this.handleAudioEvent(event));

    this.startPromise = source
      .start()
      .then(async () => {
        if (startToken !== this.startToken) {
          await source.stop();
          return;
        }
        this.sessionStartMs = Date.now();
        this.setSnapshot({ sessionState: 'capturing' });
        this.addLog(`会话开始: ${sessionId}`);
        this.addLog(`输入源: ${labelForSource(this.snapshot.audioSourceKind)} (真实采集)`);
        this.addLog('语义图谱: mock transcript 驱动');

        this.emitMockTranscript();
        this.timer = window.setInterval(() => this.emitMockTranscript(), 6000);
      })
      .catch((error: unknown) => {
        this.clearMockTimer();
        this.audioUnsubscribe?.();
        this.audioUnsubscribe = null;
        if (this.audioSource === source) this.audioSource = null;
        const message = error instanceof Error ? error.message : String(error);
        this.setSnapshot({
          audioError: message,
          audioLevel: EMPTY_LEVEL,
          audioStatus: 'error',
          sessionId: null,
          sessionState: 'idle',
        });
        this.addLog(`采集失败: ${message}`);
      })
      .finally(() => {
        this.startPromise = null;
      });

    await this.startPromise;
  }

  async stopSession() {
    this.startToken += 1;
    this.clearMockTimer();
    this.audioUnsubscribe?.();
    this.audioUnsubscribe = null;

    const source = this.audioSource;
    this.audioSource = null;
    if (source) await source.stop();

    if (this.snapshot.sessionState === 'capturing' || this.snapshot.audioStatus === 'starting') {
      this.addLog('会话已停止');
    }
    this.setSnapshot({
      audioLevel: EMPTY_LEVEL,
      audioStatus: 'idle',
      lastFrameAt: null,
      sessionId: null,
      sessionState: 'stopped',
    });
  }

  private clearMockTimer() {
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
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

  private emitMockTranscript() {
    const graph = this.snapshot.graph;
    const elapsedMs = Date.now() - this.sessionStartMs;
    const text = MOCK_TRANSCRIPTS[this.transcriptIndex % MOCK_TRANSCRIPTS.length];
    const nodeId = `desktop_node_${Date.now()}`;
    const sourceLabel = labelForSource(this.snapshot.audioSourceKind);

    const node: GraphNode = {
      id: nodeId,
      type: NODE_TYPES[this.transcriptIndex % NODE_TYPES.length],
      text: `${sourceLabel}: ${text}`,
      speaker: SPEAKERS[this.transcriptIndex % SPEAKERS.length],
      timestampMs: elapsedMs,
      status: 'confirmed',
      confidence: 0.9,
    };

    const edges: GraphEdge[] = graph.nodes.length
      ? [
          {
            id: `desktop_edge_${Date.now()}`,
            source: graph.nodes[graph.nodes.length - 1].id,
            target: nodeId,
            type: EDGE_TYPES[this.transcriptIndex % EDGE_TYPES.length],
            confidence: 0.86,
          },
        ]
      : [];

    this.transcriptIndex += 1;
    this.setSnapshot({
      graph: {
        ...graph,
        revision: graph.revision + 1,
        topics: graph.topics.map((topic) => ({ ...topic, endMs: elapsedMs })),
        nodes: [...graph.nodes, node],
        edges: [...graph.edges, ...edges],
        updatedAt: Date.now(),
      },
    });
    this.addLog(`转写(mock): ${text}`);
    this.addLog(`图更新: ${graph.nodes.length + 1} 个节点`);
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
