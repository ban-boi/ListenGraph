// lg-asr-ws-v1 服务端消息解析器。
// 相比扩展原生的「JSON.parse + 类型断言」，这里对每个字段做显式运行时校验，
// 畸形负载以稳定错误码 INVALID_PROTOCOL_MESSAGE 抛出，避免后续 undefined 访问。

import { LocalAsrRuntimeError, type LocalAsrEvent, type LocalAsrUtterance } from './protocol';

function invalid(detail: string, cause?: unknown): LocalAsrRuntimeError {
  return new LocalAsrRuntimeError('INVALID_PROTOCOL_MESSAGE', detail, { cause });
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** 校验并规范化 utterance 子对象。 */
function parseUtterance(raw: unknown): LocalAsrUtterance {
  if (!isObject(raw)) {
    throw invalid('utterance 不是对象');
  }
  const { utteranceId, revision, text, startMs, endMs, finalReason, stability, language, confidence } =
    raw;
  if (!isString(utteranceId) || utteranceId.length === 0) {
    throw invalid('utterance.utteranceId 缺失或非字符串');
  }
  if (!isNumber(revision)) {
    throw invalid('utterance.revision 缺失或非有限数');
  }
  if (!isString(text)) {
    throw invalid('utterance.text 缺失或非字符串');
  }
  if (!isNumber(startMs)) {
    throw invalid('utterance.startMs 缺失或非有限数');
  }
  if (!isNumber(endMs)) {
    throw invalid('utterance.endMs 缺失或非有限数');
  }
  const utterance: LocalAsrUtterance = { utteranceId, revision, text, startMs, endMs };
  if (isString(finalReason)) utterance.finalReason = finalReason as LocalAsrUtterance['finalReason'];
  if (isString(stability)) utterance.stability = 'stable';
  if (isString(language)) utterance.language = language;
  if (isNumber(confidence)) utterance.confidence = confidence;
  return utterance;
}

function parseVendor(raw: unknown): Record<string, unknown> | undefined {
  return isObject(raw) ? raw : undefined;
}

/**
 * 解析一条来自 Local ASR Bridge 的文本消息，返回规范化事件。
 * 非字符串、非 JSON、未知类型或字段缺失均抛 INVALID_PROTOCOL_MESSAGE。
 * bridge 自身的 error 负载归一为 BRIDGE_ERROR 事件。
 */
export function parseLocalAsrMessage(raw: string): LocalAsrEvent {
  if (!isString(raw)) {
    throw invalid('消息不是字符串');
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch (error) {
    throw invalid('消息不是合法 JSON', error);
  }

  if (!isObject(payload)) {
    throw invalid('消息根不是对象');
  }

  const { type } = payload;
  if (!isString(type)) {
    throw invalid('消息缺少 type 字段');
  }

  switch (type) {
    case 'status': {
      const status = payload.status;
      if (!isString(status)) throw invalid('status.status 缺失或非字符串');
      const detail = isString(payload.detail) ? payload.detail : undefined;
      return { type: 'status', status, detail, raw: payload };
    }

    case 'session.started': {
      const session = payload.session;
      const bridgeSessionId = isObject(session) && isString(session.bridgeSessionId)
        ? session.bridgeSessionId
        : undefined;
      return { type: 'session.started', bridgeSessionId, raw: payload };
    }

    case 'transcript.partial':
    case 'transcript.final': {
      const utterance = parseUtterance(payload.utterance);
      const vendor = parseVendor(payload.vendor);
      return { type, utterance, vendor, raw: payload } as LocalAsrEvent;
    }

    case 'error': {
      const errorPayload = payload.error;
      const code = isObject(errorPayload) && isString(errorPayload.code) ? errorPayload.code : 'UNKNOWN';
      const message =
        isObject(errorPayload) && isString(errorPayload.message)
          ? errorPayload.message
          : 'Local ASR Bridge 返回错误';
      return {
        type: 'error',
        error: new LocalAsrRuntimeError('BRIDGE_ERROR', `${code}: ${message}`),
        raw: payload,
      };
    }

    default:
      throw invalid(`未知消息类型: ${type}`);
  }
}
