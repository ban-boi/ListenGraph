// asr-stream-handlers.ts — ASR 流式消息处理
// 从 index.ts 提取：handleAsrStreamFinal、handleAsrStreamPartial、
// handleAsrStreamStatus、handleAsrStreamError

import type { TranscriptChunk } from '@listen-graphic/schema';
import { generateId } from '@listen-graphic/shared-utils';
import type {
  AsrStreamErrorPayload,
  AsrStreamFinalPayload,
  AsrStreamPartialPayload,
  AsrStreamStatusPayload,
} from '../shared/messages';
import type { RuntimeStateContainer } from './runtime-state';
import {
  ProviderRequestError,
} from '@listen-graphic/providers';
import {
  normalizeAsrErrorCode,
  serializeProviderError,
  toRecord,
} from './provider-config';
import {
  notifyError,
  notifyProviderProgress,
  notifySessionState,
  getSerializeErrorFallback,
} from './runtime-snapshot';
import type { PersistenceDeps } from './state-persistence';
import { isIndexedDbBackingStoreError } from './state-persistence';
import type { ServiceWorkerResponse } from './sw-types';

export interface AsrStreamCallbacks {
  ensureHydrated: () => Promise<void>;
  rehydrateRuntimeState: () => Promise<void>;
  enqueueTranscriptProcessing: (work: () => Promise<ServiceWorkerResponse>) => Promise<ServiceWorkerResponse>;
  processTranscriptChunk: (chunk: TranscriptChunk) => Promise<ServiceWorkerResponse>;
  transcriptChunkRepository: {
    append(chunk: TranscriptChunk): Promise<void>;
  };
  withIndexedDbRetry: <T>(op: () => Promise<T>) => Promise<T>;
  persistRuntimeState: () => Promise<void>;
}

export async function handleAsrStreamFinal(
  payload: AsrStreamFinalPayload,
  S: RuntimeStateContainer,
  callbacks: AsrStreamCallbacks,
): Promise<ServiceWorkerResponse> {
  await callbacks.ensureHydrated();

  if (!S.currentSession) {
    return { success: false, error: '没有活动会话' };
  }

  if (
    S.currentSession.state === 'error' ||
    S.stoppingSessionId === S.currentSession.sessionId
  ) {
    return { success: false, error: '当前会话已停止或进入错误状态' };
  }

  const transcript: TranscriptChunk = {
    chunkId: generateId('chunk'),
    sessionId: S.currentSession.sessionId,
    utteranceId: payload.utteranceId,
    kind: 'final',
    finalReason: payload.finalReason ?? 'vendor_defined',
    transport: payload.transport ?? 'ws',
    stability: payload.stability ?? 'stable',
    language: payload.language,
    text: payload.text,
    startMs: payload.startMs,
    endMs: payload.endMs,
    provider: payload.provider,
    confidence: payload.confidence,
    metrics: payload.startMs <= payload.endMs
      ? {
          audioDurationMs: payload.endMs - payload.startMs,
        }
      : undefined,
    tokens: (payload as any).tokens
      ? (payload as any).tokens.items?.map((token: any) => ({
          text: token.text,
          startMs: token.startMs,
          endMs: token.endMs,
          speaker: token.speaker,
          confidence: token.confidence,
        })) ?? (payload as any).tokens
      : undefined,
    raw: payload.raw
      ? {
          ...toRecord(payload.raw),
          vendor: payload.vendor,
          transport: payload.transport ?? 'ws',
        }
      : {
          vendor: payload.vendor,
          transport: payload.transport ?? 'ws',
        },
  };

  return callbacks.enqueueTranscriptProcessing(() => callbacks.processTranscriptChunk(transcript));
}

export async function handleAsrStreamPartial(
  payload: AsrStreamPartialPayload,
  S: RuntimeStateContainer,
  ensureHydrated: () => Promise<void>,
): Promise<ServiceWorkerResponse> {
  await ensureHydrated();
  const providerLabel = payload.provider ?? 'ASR';
  const label = payload.sliceType === 0 ? '开始' : '中间结果';
  const text = payload.text.trim();
  await notifyProviderProgress(
    'asr',
    text ? `${providerLabel} ${label}: ${text}` : `${providerLabel} ${label}`,
    payload.sliceType,
  );
  return { success: true };
}

export async function handleAsrStreamStatus(
  payload: AsrStreamStatusPayload,
  S: RuntimeStateContainer,
  ensureHydrated: () => Promise<void>,
): Promise<ServiceWorkerResponse> {
  await ensureHydrated();
  await notifyProviderProgress('asr', payload.detail ?? `${payload.provider} ${payload.status}`);
  return { success: true };
}

export async function handleAsrStreamError(
  payload: AsrStreamErrorPayload,
  S: RuntimeStateContainer,
  ensureHydrated: () => Promise<void>,
  notifyErrorFn: (code: string, message: string) => Promise<void>,
  persistRuntimeState: () => Promise<void>,
): Promise<ServiceWorkerResponse> {
  await ensureHydrated();

  S.lastProviderError = serializeProviderError(
    new ProviderRequestError({
      code: normalizeAsrErrorCode(payload.code),
      message: payload.message,
      provider: payload.provider,
      stage: 'asr',
      retriable: false,
    }),
  );

  if (S.currentSession) {
    S.currentSession.state = 'error';
    await notifySessionState('error', S);
    await persistRuntimeState();
  }
  await notifyErrorFn(S.lastProviderError.code, S.lastProviderError.message);
  return { success: false, error: S.lastProviderError.message, providerError: S.lastProviderError };
}
