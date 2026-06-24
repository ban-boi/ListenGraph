// lg-asr-ws-v1 协议类型定义：服务端 → 客户端的规范化事件，
// 以及运行时错误类型。所有字段在 protocol-parser 中做运行时校验。

export type LocalAsrSessionState =
  | 'idle'
  | 'connecting'
  | 'starting'
  | 'streaming'
  | 'flushing'
  | 'stopping'
  | 'closed'
  | 'error';

export interface LocalAsrUtterance {
  utteranceId: string;
  revision: number;
  text: string;
  startMs: number;
  endMs: number;
  finalReason?:
    | 'endpoint'
    | 'input_finished'
    | 'max_duration'
    | 'manual_flush'
    | 'vendor_defined'
    | 'error_recovery';
  stability?: 'stable';
  language?: string;
  confidence?: number;
}

export type LocalAsrEvent =
  | { type: 'status'; status: string; detail?: string; raw: unknown }
  | { type: 'session.started'; bridgeSessionId?: string; raw: unknown }
  | {
      type: 'transcript.partial';
      utterance: LocalAsrUtterance;
      vendor?: Record<string, unknown>;
      raw: unknown;
    }
  | {
      type: 'transcript.final';
      utterance: LocalAsrUtterance;
      vendor?: Record<string, unknown>;
      raw: unknown;
    }
  | { type: 'error'; error: LocalAsrRuntimeError; raw?: unknown }
  | { type: 'closed'; expected: boolean };

export type LocalAsrRuntimeErrorCode =
  | 'CONNECTION_FAILED'
  | 'HANDSHAKE_TIMEOUT'
  | 'INVALID_STATE'
  | 'INVALID_PROTOCOL_MESSAGE'
  | 'BRIDGE_ERROR'
  | 'UNEXPECTED_CLOSE'
  | 'FLUSH_TIMEOUT'
  | 'STOP_TIMEOUT';

/**
 * 共享 ASR 运行时统一错误类型。携带稳定错误码，供宿主侧分类处理
 * （例如扩展据此回传 ASR_STREAM_ERROR）。
 */
export class LocalAsrRuntimeError extends Error {
  readonly code: LocalAsrRuntimeErrorCode;
  constructor(
    code: LocalAsrRuntimeErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'LocalAsrRuntimeError';
    this.code = code;
  }
}
