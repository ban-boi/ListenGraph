import workletUrl from './audio-frame-processor.worklet.ts?url';

export type DesktopAudioSourceKind = 'microphone' | 'system';

export interface DesktopAudioLevel {
  rms: number;
  peak: number;
}

export type DesktopAudioSourceEvent =
  | {
      type: 'started';
      sourceKind: DesktopAudioSourceKind;
      sampleRate: number;
      trackLabel: string;
    }
  | {
      type: 'frame';
      sourceKind: DesktopAudioSourceKind;
      frame: Float32Array;
      frameIndex: number;
      sampleRate: number;
      timestamp: number;
      level: DesktopAudioLevel;
    }
  | {
      type: 'level';
      sourceKind: DesktopAudioSourceKind;
      level: DesktopAudioLevel;
      timestamp: number;
    }
  | {
      type: 'ended';
      sourceKind: DesktopAudioSourceKind;
      reason: string;
    }
  | {
      type: 'error';
      sourceKind: DesktopAudioSourceKind;
      error: Error;
    };

export interface DesktopAudioSource {
  readonly kind: DesktopAudioSourceKind;
  start(): Promise<void>;
  stop(): Promise<void>;
  subscribe(listener: (event: DesktopAudioSourceEvent) => void): () => void;
}

interface WorkletMessage {
  type?: string;
  frame?: ArrayBuffer;
  frameIndex?: number;
  sampleRate?: number;
  timestamp?: number;
  level?: DesktopAudioLevel;
}

abstract class BrowserAudioSource implements DesktopAudioSource {
  readonly kind: DesktopAudioSourceKind;

  private listeners = new Set<(event: DesktopAudioSourceEvent) => void>();
  private stream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private stopped = false;

  protected constructor(kind: DesktopAudioSourceKind) {
    this.kind = kind;
  }

  async start() {
    if (this.stream) return;

    this.stopped = false;
    try {
      const stream = await this.requestStream();
      const audioTracks = stream.getAudioTracks();
      if (audioTracks.length === 0) {
        stream.getTracks().forEach((track) => track.stop());
        throw new Error(this.emptyAudioTrackMessage());
      }

      this.stream = stream;
      const audioTrack = audioTracks[0];
      audioTrack.addEventListener('ended', this.handleTrackEnded);

      const AudioContextCtor = window.AudioContext ?? window.webkitAudioContext;
      if (!AudioContextCtor) throw new Error('当前运行环境不支持 Web Audio AudioContext');

      const audioContext = new AudioContextCtor({ sampleRate: 16_000 });
      await audioContext.audioWorklet.addModule(workletUrl);

      const sourceNode = audioContext.createMediaStreamSource(stream);
      const workletNode = new AudioWorkletNode(
        audioContext,
        'desktop-audio-frame-processor',
        {
          numberOfInputs: 1,
          numberOfOutputs: 0,
          processorOptions: {
            targetSampleRate: 16_000,
            frameDurationMs: 40,
          },
        },
      );
      workletNode.port.onmessage = (event: MessageEvent<WorkletMessage>) => {
        this.handleWorkletMessage(event.data);
      };
      workletNode.onprocessorerror = () => {
        this.emit({
          type: 'error',
          sourceKind: this.kind,
          error: new Error('AudioWorklet 处理器运行失败'),
        });
      };

      sourceNode.connect(workletNode);

      this.audioContext = audioContext;
      this.sourceNode = sourceNode;
      this.workletNode = workletNode;

      this.emit({
        type: 'started',
        sourceKind: this.kind,
        sampleRate: audioContext.sampleRate,
        trackLabel: audioTrack.label || this.defaultTrackLabel(),
      });
    } catch (error) {
      await this.stop();
      const normalizedError = normalizeAudioError(error, this.kind);
      this.emit({
        type: 'error',
        sourceKind: this.kind,
        error: normalizedError,
      });
      throw normalizedError;
    }
  }

  async stop() {
    this.stopped = true;

    if (this.workletNode) {
      this.workletNode.port.onmessage = null;
      this.workletNode.disconnect();
      this.workletNode = null;
    }

    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }

    if (this.stream) {
      for (const track of this.stream.getTracks()) {
        track.removeEventListener('ended', this.handleTrackEnded);
        track.stop();
      }
      this.stream = null;
    }

    if (this.audioContext) {
      const context = this.audioContext;
      this.audioContext = null;
      if (context.state !== 'closed') await context.close();
    }
  }

  subscribe(listener: (event: DesktopAudioSourceEvent) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  protected abstract requestStream(): Promise<MediaStream>;

  protected abstract emptyAudioTrackMessage(): string;

  protected abstract defaultTrackLabel(): string;

  private readonly handleTrackEnded = () => {
    if (this.stopped) return;
    this.emit({
      type: 'ended',
      sourceKind: this.kind,
      reason:
        this.kind === 'system'
          ? '系统声音共享源已结束'
          : '麦克风音频轨已结束',
    });
  };

  private handleWorkletMessage(message: WorkletMessage) {
    if (message.type !== 'frame' || !message.frame || !message.level) return;

    const timestamp = message.timestamp ?? Date.now();
    const sampleRate = message.sampleRate ?? 16_000;
    const frame = new Float32Array(message.frame);
    this.emit({
      type: 'frame',
      sourceKind: this.kind,
      frame,
      frameIndex: message.frameIndex ?? 0,
      sampleRate,
      timestamp,
      level: message.level,
    });
    this.emit({
      type: 'level',
      sourceKind: this.kind,
      level: message.level,
      timestamp,
    });
  }

  private emit(event: DesktopAudioSourceEvent) {
    for (const listener of this.listeners) listener(event);
  }
}

export class MicrophoneAudioSource extends BrowserAudioSource {
  constructor() {
    super('microphone');
  }

  protected requestStream() {
    return navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        channelCount: 1,
      },
    });
  }

  protected emptyAudioTrackMessage() {
    return '麦克风未返回音频轨';
  }

  protected defaultTrackLabel() {
    return '麦克风';
  }
}

export class SystemAudioSource extends BrowserAudioSource {
  constructor() {
    super('system');
  }

  protected requestStream() {
    return navigator.mediaDevices.getDisplayMedia({
      audio: true,
      video: true,
    });
  }

  protected emptyAudioTrackMessage() {
    return '系统声音捕获为空：共享源没有返回音频轨';
  }

  protected defaultTrackLabel() {
    return '系统声音';
  }
}

export function createDesktopAudioSource(kind: DesktopAudioSourceKind) {
  return kind === 'microphone' ? new MicrophoneAudioSource() : new SystemAudioSource();
}

function normalizeAudioError(error: unknown, kind: DesktopAudioSourceKind) {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError') {
      return new Error(
        kind === 'microphone' ? '麦克风权限被拒绝' : '系统声音捕获权限被拒绝',
      );
    }
    if (error.name === 'NotFoundError') {
      return new Error(kind === 'microphone' ? '未找到麦克风设备' : '未找到可共享的系统音频源');
    }
    if (error.name === 'NotReadableError') {
      return new Error('音频设备当前不可读，可能正被其他程序占用');
    }
  }

  const message = error instanceof Error ? error.message : String(error);
  if (/worklet/i.test(message)) return new Error(`AudioWorklet 加载失败: ${message}`);
  return new Error(message);
}

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}
