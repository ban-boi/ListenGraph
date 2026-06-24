import { describe, expect, it } from 'vitest';
import {
  LocalAsrSession,
  type LocalAsrSessionOptions,
  type WebSocketFactory,
  type WebSocketLike,
} from './local-asr-session';
import { LocalAsrRuntimeError, type LocalAsrEvent } from './protocol';

// 可控的假 WebSocket：记录发出的消息，手动驱动 open/message/error/close。
class FakeWebSocket implements WebSocketLike {
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  closed = false;

  send(value: string): void {
    this.sent.push(value);
  }
  close(): void {
    this.closed = true;
    this.readyState = 3;
    this.onclose?.();
  }

  open(): void {
    this.readyState = 1;
    this.onopen?.();
  }
  message(value: unknown): void {
    this.onmessage?.({ data: JSON.stringify(value) });
  }
}

function baseOptions(websocketFactory: WebSocketFactory): LocalAsrSessionOptions {
  return {
    endpoint: 'ws://127.0.0.1:15377/ws',
    sampleRate: 16_000,
    frameDurationMs: 40,
    sessionId: 'session-1',
    websocketFactory,
    handshakeTimeoutMs: 100,
    closeTimeoutMs: 100,
  };
}

function sessionStarted(socket: FakeWebSocket, bridgeSessionId = 'bridge-1'): void {
  socket.message({ type: 'session.started', session: { bridgeSessionId } });
}

describe('LocalAsrSession', () => {
  it('等待 session.started 之后再发送音频帧', async () => {
    const socket = new FakeWebSocket();
    const session = new LocalAsrSession(baseOptions(() => socket));
    const connecting = session.connect();
    socket.open();
    expect(JSON.parse(socket.sent[0]).type).toBe('session.start');
    sessionStarted(socket);
    await connecting;
    session.sendFloat32Frame(new Float32Array([0, 0.5]), 100);
    expect(JSON.parse(socket.sent[1])).toMatchObject({
      type: 'audio.frame',
      audio: { codec: 'pcm_s16le', samples: 2 },
      timestampMs: 100,
    });
  });

  it('session.start 负载携带版本、会话与音频参数', async () => {
    const socket = new FakeWebSocket();
    const session = new LocalAsrSession({
      ...baseOptions(() => socket),
      authToken: 'tok',
    });
    void session.connect();
    socket.open();
    expect(JSON.parse(socket.sent[0])).toMatchObject({
      type: 'session.start',
      version: '1',
      session: { sessionId: 'session-1' },
      audio: { codec: 'pcm_s16le', sampleRate: 16_000, channels: 1, frameDurationMs: 40 },
      auth: { token: 'tok' },
    });
    sessionStarted(socket);
    await session.connect();
  });

  it('未进入 streaming 状态时发帧抛 INVALID_STATE', async () => {
    const socket = new FakeWebSocket();
    const session = new LocalAsrSession(baseOptions(() => socket));
    expect(() => session.sendFloat32Frame(new Float32Array([0]), 0)).toThrowError(
      expect.objectContaining({ code: 'INVALID_STATE' }),
    );
  });

  it('转发 partial 与 final 事件给订阅者', async () => {
    const socket = new FakeWebSocket();
    const session = new LocalAsrSession(baseOptions(() => socket));
    const events: LocalAsrEvent[] = [];
    const off = session.on((event) => events.push(event));
    const connecting = session.connect();
    socket.open();
    sessionStarted(socket);
    await connecting;

    socket.message({
      type: 'transcript.partial',
      utterance: { utteranceId: 'u1', revision: 1, text: '部', startMs: 0, endMs: 100 },
    });
    socket.message({
      type: 'transcript.final',
      utterance: {
        utteranceId: 'u1', revision: 2, text: '部分', startMs: 0, endMs: 200,
        finalReason: 'endpoint', stability: 'stable',
      },
    });

    expect(events.map((e) => e.type)).toEqual(['transcript.partial', 'transcript.final']);
    off();
  });

  it('畸形消息仅转发一个 error 事件，不中断会话', async () => {
    const socket = new FakeWebSocket();
    const session = new LocalAsrSession(baseOptions(() => socket));
    const events: LocalAsrEvent[] = [];
    session.on((event) => events.push(event));
    const connecting = session.connect();
    socket.open();
    sessionStarted(socket);
    await connecting;

    socket.onmessage?.({ data: 'not-json' });
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('error');
  });

  it('flush 与 stop 幂等：重复调用复用同一 in-flight promise', async () => {
    const socket = new FakeWebSocket();
    const session = new LocalAsrSession(baseOptions(() => socket));
    const connecting = session.connect();
    socket.open();
    sessionStarted(socket);
    await connecting;

    const flushA = session.flush();
    const flushB = session.flush();
    expect(flushA).toBe(flushB);
    await flushA;

    const stopA = session.stop();
    const stopB = session.stop();
    expect(stopA).toBe(stopB);
    await stopA;
  });

  it('flush 发送 audio.flush，stop 发送 session.stop', async () => {
    const socket = new FakeWebSocket();
    const session = new LocalAsrSession(baseOptions(() => socket));
    const connecting = session.connect();
    socket.open();
    sessionStarted(socket);
    await connecting;
    const sentBefore = socket.sent.length;

    await session.flush();
    expect(JSON.parse(socket.sent[sentBefore]).type).toBe('audio.flush');

    await session.stop();
    expect(JSON.parse(socket.sent[sentBefore + 1]).type).toBe('session.stop');
  });

  it('意外关闭时转发 UNEXPECTED_CLOSE 错误', async () => {
    const socket = new FakeWebSocket();
    const session = new LocalAsrSession(baseOptions(() => socket));
    const events: LocalAsrEvent[] = [];
    session.on((event) => events.push(event));
    const connecting = session.connect();
    socket.open();
    sessionStarted(socket);
    await connecting;

    socket.readyState = 3;
    socket.onclose?.();
    const error = events.find((e) => e.type === 'error');
    expect(error).toBeDefined();
    if (error?.type === 'error') {
      expect(error.error.code).toBe('UNEXPECTED_CLOSE');
    }
  });

  it('连接握手超时抛 HANDSHAKE_TIMEOUT 且清理安全', async () => {
    const socket = new FakeWebSocket();
    const session = new LocalAsrSession({
      ...baseOptions(() => socket),
      handshakeTimeoutMs: 20,
    });
    await expect(session.connect()).rejects.toThrowError(
      expect.objectContaining({ code: 'HANDSHAKE_TIMEOUT' }),
    );
    // 连接失败后再操作不应抛未捕获异常
    expect(() => session.sendFloat32Frame(new Float32Array([0]), 0)).toThrow(LocalAsrRuntimeError);
  });

  it('连接失败后调用 flush/stop 不抛', async () => {
    const socket = new FakeWebSocket();
    const session = new LocalAsrSession({
      ...baseOptions(() => socket),
      handshakeTimeoutMs: 20,
    });
    await expect(session.connect()).rejects.toBeTruthy();
    await expect(session.flush()).resolves.toBeUndefined();
    await expect(session.stop()).resolves.toBeUndefined();
  });

  it('连接建立失败（onerror）抛 CONNECTION_FAILED', async () => {
    const socket = new FakeWebSocket();
    const session = new LocalAsrSession({
      ...baseOptions(() => socket),
      handshakeTimeoutMs: 50,
    });
    const connecting = session.connect();
    socket.onerror?.();
    await expect(connecting).rejects.toThrowError(
      expect.objectContaining({ code: 'CONNECTION_FAILED' }),
    );
  });
});
