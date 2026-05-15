// session-lifecycle.ts — 会话生命周期管理
// 从 index.ts 提取：startSession、stopSession、cleanupSession、
// flushPendingSessionFinalize、handleCaptureEnded

import type { MergedGraph } from '@listen-graphic/schema';
import { generateId } from '@listen-graphic/shared-utils';
import type { AppMessage, SessionState, RuntimeSnapshot } from '../shared/messages';
import type { RuntimeStateContainer } from './runtime-state';
import {
  notifyError,
  notifySessionState,
  notifyProviderProgress,
  broadcastToSidepanel,
} from './runtime-snapshot';
import {
  getRuntimeStorageArea,
} from './state-persistence';
import { createProviderConfigError } from './provider-config';
import type { ServiceWorkerResponse } from './sw-types';

type LastStoppedSessionPayload = {
  sessionId: string;
  mergedGraph: MergedGraph;
  currentTimeMs: number;
  currentView: RuntimeSnapshot['currentView'];
  currentViewPinned: boolean;
};

export interface SessionLifecycleCallbacks {
  ensureHydrated: () => Promise<void>;
  persistRuntimeState: () => Promise<void>;
  clearRuntimeState: () => Promise<void>;
  loadProviderRuntimeFromSettings: () => Promise<void>;
  applyBootstrapProviderRuntime: () => void;
  sendMessageToContentScript: <TResponse = any>(
    tabId: number,
    message: Extract<AppMessage, { target: 'content-script' }>,
  ) => Promise<TResponse>;
  buildContentScriptStartPayload: () => Promise<Extract<AppMessage, { type: 'START_CAPTURE' }>['payload']>;
  notifySessionState: (state: SessionState) => Promise<void>;
  notifyError: (code: string, message: string) => Promise<void>;
  notifyProviderProgress: (stage: 'asr' | 'structurer', message: string) => Promise<void>;
  waitForChunkQueueToSettle: () => Promise<void>;
  waitForTranscriptProcessingToSettle: () => Promise<void>;
  flushPendingStructureBuffer: (reason: any) => Promise<ServiceWorkerResponse | null>;
  resetAssemblerState: () => void;
  withIndexedDbRetry: <T>(op: () => Promise<T>) => Promise<T>;
  sessionRepository: {
    save(record: any): Promise<void>;
    markEnded(sessionId: string, endedAt: number): Promise<void>;
  };
  runtimeStateKey: string;
  lastStoppedSessionKey: string;
  persistAssemblerTrace: (
    sessionId: string,
    assemblerRuns: unknown[],
    structureUnits: unknown[],
  ) => Promise<void>;
}

export async function startSession(
  tabId: number,
  S: RuntimeStateContainer,
  callbacks: SessionLifecycleCallbacks,
): Promise<ServiceWorkerResponse> {
  await callbacks.ensureHydrated();

  if (S.currentSession) {
    return {
      success: true,
      sessionId: S.currentSession.sessionId,
      alreadyRunning: true,
    };
  }

  try {
    await callbacks.loadProviderRuntimeFromSettings();
    S.lastProviderError = null;
    S.lastStructurerRun = null;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : '读取 provider 配置失败';
    S.lastProviderError = createProviderConfigError(message);
    await callbacks.notifyError('PROVIDER_CONFIG_ERROR', message);
    await callbacks.persistRuntimeState();
    return { success: false, error: message };
  }

  const sessionId = generateId('session');
  try {
    await getRuntimeStorageArea().remove(callbacks.lastStoppedSessionKey);
  } catch (error) {
    console.warn('[Service Worker] 清理上次停止会话快照失败:', error);
  }

  S.resetActiveRuntime();
  S.currentSession = {
    sessionId,
    tabId,
    state: 'capturing',
  };
  S.stoppingSessionId = null;
  S.asrProvider.reset?.();
  S.structurerProvider.reset?.();
  await callbacks.persistRuntimeState();
  let captureStarted = false;

  try {
    const capturePayload = await callbacks.buildContentScriptStartPayload();
    const response = await callbacks.sendMessageToContentScript(tabId, {
      type: 'START_CAPTURE',
      target: 'content-script',
      payload: capturePayload,
    });

    if (!response?.success) {
      throw new Error(response?.error || '内容脚本启动采集失败');
    }
    captureStarted = true;

    await callbacks.withIndexedDbRetry(() =>
      callbacks.sessionRepository.save({
      sessionId,
      sourceType: 'tab',
      createdAt: Date.now(),
      }),
    );
    await callbacks.notifySessionState('capturing');
    return { success: true, sessionId };
  } catch (error) {
    S.resetActiveRuntime();
    await callbacks.clearRuntimeState();
    if (captureStarted) {
      try {
        await chrome.tabs.sendMessage(tabId, {
          type: 'STOP_CAPTURE',
          target: 'content-script',
          payload: {},
        } as AppMessage | { type: 'STOP_CAPTURE'; target: 'content-script'; payload: {} });
      } catch (stopError) {
        console.warn('[Service Worker] 回滚采集失败:', stopError);
      }
    }

    const message =
      error instanceof Error ? error.message : '无法启动当前标签页的音频采集';
    await callbacks.notifyError('START_FAILED', message);
    return { success: false, error: message };
  }
}

export async function stopSession(
  sessionId: string,
  S: RuntimeStateContainer,
  callbacks: SessionLifecycleCallbacks,
): Promise<ServiceWorkerResponse> {
  await callbacks.ensureHydrated();

  if (!S.currentSession) {
    return { success: true };
  }

  const activeSession = S.currentSession;
  if (sessionId !== activeSession.sessionId) {
    return { success: false, error: '停止请求的 sessionId 与当前活动会话不匹配' };
  }

  S.stoppingSessionId = activeSession.sessionId;

  try {
    await chrome.tabs.sendMessage(activeSession.tabId, {
      type: 'STOP_CAPTURE',
      target: 'content-script',
      payload: {},
    } as AppMessage | { type: 'STOP_CAPTURE'; target: 'content-script'; payload: {} });
  } catch (error) {
    console.warn('[Service Worker] 停止采集时未收到内容脚本响应:', error);
  }

  S.asrProvider.reset?.();
  S.structurerProvider.reset?.();
  if (
    activeSession.state === 'structuring' ||
    S.inFlightTranscriptPromise ||
    S.inFlightChunkPromise
  ) {
    await callbacks.notifyProviderProgress(
      'structurer',
      'Stop requested | waiting for in-flight work to settle',
    );
  }
  await callbacks.waitForChunkQueueToSettle();
  await callbacks.waitForTranscriptProcessingToSettle();
  const flushResponse = await callbacks.flushPendingStructureBuffer('commit_force_flush');
  if (flushResponse && !flushResponse.success) {
    return flushResponse;
  }

  await cleanupSession(
    { sessionId: activeSession.sessionId, state: 'stopped' },
    S,
    callbacks,
  );
  return { success: true };
}

export async function cleanupSession(
  payload: {
    sessionId: string;
    state: Extract<SessionState, 'stopped'>;
  },
  S: RuntimeStateContainer,
  callbacks: SessionLifecycleCallbacks,
) {
  const endedAt = Date.now();
  const lastMergedGraph = S.mergedGraph;
  const lastTimeMs = S.currentTimeMs;
  const lastView = S.currentView;
  const lastViewPinned = S.currentViewPinned;

  // 在 reset 前持久化 assembler trace
  const assemblerRunsToSave = S.assemblerRuns;
  const structureUnitsToSave = S.structureUnits;
  if (assemblerRunsToSave.length > 0 || structureUnitsToSave.length > 0) {
    await callbacks.persistAssemblerTrace(
      payload.sessionId,
      assemblerRunsToSave,
      structureUnitsToSave,
    );
  }

  try {
    await callbacks.sessionRepository.markEnded(payload.sessionId, endedAt);
    S.pendingSessionFinalize = null;
  } catch (error) {
    console.warn('[Service Worker] 标记会话结束失败:', error);
    S.pendingSessionFinalize = {
      sessionId: payload.sessionId,
      endedAt,
    };
  } finally {
    S.resetActiveRuntime();
    S.stoppingSessionId = null;
    S.lastStructurerRun = null;
    if (S.pendingSessionFinalize) {
      await callbacks.persistRuntimeState();
    } else {
      await callbacks.clearRuntimeState();
    }

    if (lastMergedGraph) {
      try {
        await getRuntimeStorageArea().set({
          [callbacks.lastStoppedSessionKey]: {
            sessionId: payload.sessionId,
            mergedGraph: lastMergedGraph,
            currentTimeMs: lastTimeMs,
            currentView: lastView ?? lastMergedGraph.viewHints?.defaultView,
            currentViewPinned: lastViewPinned,
          } satisfies LastStoppedSessionPayload,
        });
      } catch (error) {
        console.warn('[Service Worker] 写入停止会话图谱快照失败:', error);
      }
    } else {
      try {
        await getRuntimeStorageArea().remove(callbacks.lastStoppedSessionKey);
      } catch (error) {
        console.warn('[Service Worker] 移除停止会话图谱快照失败:', error);
      }
    }

    await broadcastToSidepanel({
      type: 'SESSION_STATE_CHANGED',
      target: 'sidepanel',
      payload: {
        sessionId: payload.sessionId,
        state: payload.state,
        mergedGraph: lastMergedGraph,
        currentTimeMs: lastTimeMs,
        currentView: lastView ?? lastMergedGraph?.viewHints?.defaultView,
        currentViewPinned: lastViewPinned,
      },
    });
  }
}

export async function flushPendingSessionFinalize(
  S: RuntimeStateContainer,
  callbacks: SessionLifecycleCallbacks,
) {
  if (!S.pendingSessionFinalize) {
    return;
  }

  try {
    await callbacks.sessionRepository.markEnded(
      S.pendingSessionFinalize.sessionId,
      S.pendingSessionFinalize.endedAt,
    );
    S.pendingSessionFinalize = null;
    if (
      !S.currentSession &&
      S.transcriptWindow.length === 0 &&
      !S.mergedGraph &&
      S.transcriptSequence === 0 &&
      S.currentTimeMs === 0 &&
      !S.currentView &&
      !S.currentViewPinned
    ) {
      await callbacks.clearRuntimeState();
    } else {
      await callbacks.persistRuntimeState();
    }
  } catch (error) {
    console.warn('[Service Worker] 补偿结束会话失败:', error);
  }
}

export async function handleCaptureEnded(
  senderTabId: number | undefined,
  reason: 'share-ended' | 'pagehide' | 'beforeunload',
  S: RuntimeStateContainer,
  callbacks: SessionLifecycleCallbacks,
): Promise<ServiceWorkerResponse> {
  await callbacks.ensureHydrated();

  if (!S.currentSession) {
    return { success: true };
  }

  if (senderTabId && S.currentSession.tabId !== senderTabId) {
    return { success: false, error: '捕获结束消息来自非活动标签页' };
  }

  await cleanupSession(
    {
      sessionId: S.currentSession.sessionId,
      state: 'stopped',
    },
    S,
    callbacks,
  );
  console.info('[Service Worker] 捕获已结束:', reason);
  return { success: true };
}
