// work-queues.ts — 工作队列管理
// 从 index.ts 提取：enqueueAudioChunk、handleAudioChunk、waitForChunkQueueToSettle、
// enqueueTranscriptProcessing、waitForTranscriptProcessingToSettle、processTranscriptChunk

import type { TranscriptChunk } from '@listen-graphic/schema';
import type { AudioChunkPayload } from '../shared/messages';
import type { RuntimeStateContainer } from './runtime-state';
import {
  serializeProviderError,
} from './provider-config';
import {
  notifyError,
  notifySessionState,
  broadcastToSidepanel,
  getSerializeErrorFallback,
} from './runtime-snapshot';
import { appendTranscriptToWindow, getStructurerInvocationContextFromAssembler } from './assembler-machine';
import type { ServiceWorkerResponse } from './sw-types';

export interface WorkQueueCallbacks {
  ensureHydrated: () => Promise<void>;
  rehydrateRuntimeState: () => Promise<void>;
  notifySessionState: (state: any) => Promise<void>;
  persistRuntimeState: () => Promise<void>;
  transcriptChunkRepository: {
    append(chunk: TranscriptChunk): Promise<void>;
  };
  withIndexedDbRetry: <T>(op: () => Promise<T>) => Promise<T>;
  isIndexedDbBackingStoreError: (error: unknown) => boolean;
  runStructurerForTranscriptContext: (params: {
    chunkSessionId: string;
    transcript: TranscriptChunk;
    structurerWindow: TranscriptChunk[];
    evidenceChunkIds?: string[];
  }) => Promise<ServiceWorkerResponse>;
  notifyProviderProgress: (stage: 'asr' | 'structurer', message: string) => Promise<void>;
}

export function enqueueAudioChunk(
  payload: AudioChunkPayload,
  S: RuntimeStateContainer,
  callbacks: WorkQueueCallbacks,
): Promise<ServiceWorkerResponse> {
  S.pendingChunkWorkCount += 1;
  if (S.currentSession) {
    void callbacks.notifySessionState(S.currentSession.state);
  }
  const chunkPromise = S.chunkQueueTail
    .catch(() => undefined)
    .then(async () => {
      const currentPromise = handleAudioChunk(payload, S, callbacks);
      S.inFlightChunkPromise = currentPromise;

      try {
        return await currentPromise;
      } finally {
        if (S.inFlightChunkPromise === currentPromise) {
          S.inFlightChunkPromise = null;
        }
        S.pendingChunkWorkCount = Math.max(S.pendingChunkWorkCount - 1, 0);
        if (S.currentSession) {
          void callbacks.notifySessionState(S.currentSession.state);
        }
      }
    });

  S.chunkQueueTail = chunkPromise.then(
    () => undefined,
    () => undefined,
  );

  return chunkPromise;
}

export async function handleAudioChunk(
  payload: AudioChunkPayload,
  S: RuntimeStateContainer,
  callbacks: WorkQueueCallbacks,
): Promise<ServiceWorkerResponse> {
  await callbacks.ensureHydrated();

  if (!S.currentSession) {
    await callbacks.rehydrateRuntimeState();
  }

  if (!S.currentSession) {
    return { success: false, error: '没有活动会话' };
  }

  if (
    S.currentSession.state === 'error' ||
    S.stoppingSessionId === S.currentSession.sessionId
  ) {
    return { success: false, error: '当前会话已停止或进入错误状态' };
  }

  const audioBytes = new Uint8Array(payload.audioData);
  const audioBlob = new Blob([audioBytes], {
    type: payload.audioMimeType ?? 'audio/wav',
  });

  try {
    await callbacks.notifySessionState('transcribing');

    const transcript = await S.asrProvider.transcribeChunk({
      sessionId: S.currentSession.sessionId,
      audio: audioBlob,
      startMs: payload.startMs,
      endMs: payload.endMs,
    });
    return enqueueTranscriptProcessing(() => processTranscriptChunk(transcript, S, callbacks), S, callbacks);
  } catch (error) {
    if (S.currentSession && S.stoppingSessionId === S.currentSession.sessionId) {
      return { success: false, error: '会话停止中' };
    }

    S.lastProviderError = serializeProviderError(error, getSerializeErrorFallback(S));
    const message = S.lastProviderError.message;
    S.currentSession.state = 'error';
    await callbacks.notifySessionState('error');
    await callbacks.persistRuntimeState();
    await notifyError(S.lastProviderError?.code ?? 'CHUNK_PROCESS_ERROR', message);
    return { success: false, error: message, providerError: S.lastProviderError };
  }
}

export async function waitForChunkQueueToSettle(S: RuntimeStateContainer) {
  await S.chunkQueueTail;

  if (S.inFlightChunkPromise) {
    await S.inFlightChunkPromise;
  }
}

export function enqueueTranscriptProcessing(
  work: () => Promise<ServiceWorkerResponse>,
  S: RuntimeStateContainer,
  callbacks: WorkQueueCallbacks,
): Promise<ServiceWorkerResponse> {
  S.pendingTranscriptWorkCount += 1;
  if (S.currentSession) {
    void callbacks.notifySessionState(S.currentSession.state);
  }
  const transcriptPromise = S.transcriptProcessTail
    .catch(() => undefined)
    .then(async () => {
      const currentPromise = work();
      S.inFlightTranscriptPromise = currentPromise;

      try {
        return await currentPromise;
      } finally {
        if (S.inFlightTranscriptPromise === currentPromise) {
          S.inFlightTranscriptPromise = null;
        }
        S.pendingTranscriptWorkCount = Math.max(S.pendingTranscriptWorkCount - 1, 0);
        if (S.currentSession) {
          void callbacks.notifySessionState(S.currentSession.state);
        }
      }
    });

  S.transcriptProcessTail = transcriptPromise.then(
    () => undefined,
    () => undefined,
  );

  return transcriptPromise;
}

export async function waitForTranscriptProcessingToSettle(S: RuntimeStateContainer) {
  await S.transcriptProcessTail;

  if (S.inFlightTranscriptPromise) {
    await S.inFlightTranscriptPromise;
  }
}

export async function processTranscriptChunk(
  transcript: TranscriptChunk,
  S: RuntimeStateContainer,
  callbacks: WorkQueueCallbacks,
): Promise<ServiceWorkerResponse> {
  const chunkSessionId = S.currentSession?.sessionId;
  if (!chunkSessionId) {
    return { success: false, error: '没有活动会话' };
  }

  try {
    try {
      await callbacks.withIndexedDbRetry(() => callbacks.transcriptChunkRepository.append(transcript));
    } catch (error) {
      if (!callbacks.isIndexedDbBackingStoreError(error)) {
        throw error;
      }
      console.warn('[Service Worker] transcript 持久化暂不可用，保留内存态结果:', error);
    }
    appendTranscriptToWindow(transcript, S);
    S.currentTimeMs = transcript.endMs;
    S.lastTranscriptAt = Date.now();

    await broadcastToSidepanel({
      type: 'TRANSCRIPT_READY',
      target: 'sidepanel',
      payload: { transcript },
    });

    const assemblerContext = getStructurerInvocationContextFromAssembler(
      transcript,
      S,
      callbacks.notifyProviderProgress,
    );
    if (!assemblerContext) {
      S.lastProviderError = null;
      await callbacks.notifySessionState('capturing');
      await callbacks.persistRuntimeState();
      return { success: true };
    }

    return await callbacks.runStructurerForTranscriptContext({
      chunkSessionId,
      transcript: assemblerContext.transcript,
      structurerWindow: assemblerContext.structurerWindow,
      evidenceChunkIds: assemblerContext.evidenceChunkIds,
    });
  } catch (error) {
    if (!S.currentSession || S.currentSession.sessionId !== chunkSessionId) {
      return { success: false, error: '会话已结束' };
    }

    if (S.stoppingSessionId === S.currentSession.sessionId) {
      return { success: false, error: '会话停止中' };
    }

    S.lastProviderError = serializeProviderError(error, getSerializeErrorFallback(S));
    const message = S.lastProviderError.message;
    S.currentSession.state = 'error';
    await callbacks.notifySessionState('error');
    await callbacks.persistRuntimeState();
    await notifyError(S.lastProviderError?.code ?? 'CHUNK_PROCESS_ERROR', message);
    return { success: false, error: message, providerError: S.lastProviderError };
  }
}
