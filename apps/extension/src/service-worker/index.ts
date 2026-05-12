// index.ts — Service Worker 入口
// 将各模块胶合在一起，处理 Chrome 事件监听和消息路由。
// 有状态逻辑已提取到独立模块，本文件仅负责初始化和委托。

import {
  createProviderRegistry,
} from '@listen-graphic/providers';
import {
  createMergedGraphRepository,
  createSegmentGraphRepository,
  createSessionRepository,
  createSettingsRepository,
  createTranscriptChunkRepository,
  db,
  type SessionRecord,
} from '@listen-graphic/storage';
import type {
  MergedGraph,
  ProviderConfig,
  SegmentGraph,
  TranscriptChunk,
} from '@listen-graphic/schema';
import type {
  AppMessage,
  RuntimeSnapshot,
} from '../shared/messages';
import { buildSessionExport } from './export-formatters';
import { RuntimeStateContainer, type PersistedRuntimeState } from './runtime-state';

// 提取的模块
import {
  sendMessageToContentScript,
  ensureContentScriptInjected,
  isMissingReceiverError,
  buildContentScriptStartPayload,
} from './content-script-bridge';
import {
  getRuntimeSnapshot,
  getRuntimeSnapshotForSidepanel,
  getStructurerRunsForDebugSession,
  notifyError,
  notifyProviderProgress,
  broadcastToSidepanel,
  notifySessionState,
} from './runtime-snapshot';
import {
  getRuntimeStorageArea,
  ensureHydrated,
  rehydrateRuntimeState,
  withIndexedDbRetry,
  isIndexedDbBackingStoreError,
  persistRuntimeState,
  clearRuntimeState,
  persistAssemblerTrace,
  type PersistenceDeps,
} from './state-persistence';
import {
  resetAssemblerState,
  getStructurerInvocationContextFromAssembler,
  flushPendingStructureBuffer,
  getCurrentAsrTransport,
  appendTranscriptToWindow,
} from './assembler-machine';
import {
  runStructurerForTranscriptContext,
  loadMergedGraphAsset,
  type StructurerExecutorDeps,
} from './structurer-executor';
import {
  loadProviderRuntimeFromSettings,
  applyProviderRuntime,
  applyBootstrapProviderRuntime,
  commitProviderRuntime,
  handleGetProviderSettings,
  handleSaveProviderSettings,
  handleClearProviderSecrets,
  type ProviderManagementDeps,
} from './provider-management';
import {
  startSession,
  stopSession,
  cleanupSession,
  flushPendingSessionFinalize,
  handleCaptureEnded,
  type SessionLifecycleCallbacks,
} from './session-lifecycle';
import {
  handleNodeClicked,
  handleViewSelected,
  handleExportSession,
  handleGetDebugSession,
  handleGetReplaySession,
  handleTestStructurerSessionRun,
  persistInjectedStructurerSeed,
} from './session-handlers';
import {
  handleAsrStreamFinal,
  handleAsrStreamPartial,
  handleAsrStreamStatus,
  handleAsrStreamError,
} from './asr-stream-handlers';
import {
  enqueueAudioChunk,
  handleAudioChunk,
  waitForChunkQueueToSettle,
  enqueueTranscriptProcessing,
  waitForTranscriptProcessingToSettle,
  processTranscriptChunk,
  type WorkQueueCallbacks,
} from './work-queues';
import type { ServiceWorkerResponse } from './sw-types';

// ─── 常量与单例 ─────────────────────────────────────────────────────────────

const S = new RuntimeStateContainer();

const RUNTIME_STATE_KEY = 'listen-graphic-runtime-state';
const LAST_STOPPED_SESSION_KEY = 'listen-graphic-last-stopped-session';

const providerRegistry = createProviderRegistry();
const sessionRepository = createSessionRepository({ sessions: db.sessions });
const transcriptChunkRepository = createTranscriptChunkRepository({
  transcriptChunks: db.transcriptChunks,
});
const segmentGraphRepository = createSegmentGraphRepository({
  segmentGraphs: db.segmentGraphs,
});
const mergedGraphRepository = createMergedGraphRepository({
  mergedGraphs: db.mergedGraphs,
});
const settingsRepository = createSettingsRepository({
  settings: db.settings,
});

// ─── 组装依赖 ──────────────────────────────────────────────────────────────

const providerDeps: ProviderManagementDeps = {
  S,
  settingsRepository,
  providerRegistry,
  persistRuntimeState: () => persistRuntimeState(S, RUNTIME_STATE_KEY),
};

const structurerDeps: StructurerExecutorDeps = {
  segmentGraphRepository,
  mergedGraphRepository,
};

const persistenceDeps: PersistenceDeps = {
  S,
  sessionRepository,
  transcriptChunkRepository,
  runtimeStateKey: RUNTIME_STATE_KEY,
  loadProviderRuntimeFromSettings: () => loadProviderRuntimeFromSettings(providerDeps),
  applyBootstrapProviderRuntime: () => applyBootstrapProviderRuntime(providerDeps),
  resetAssemblerState: () => resetAssemblerState(S),
  loadMergedGraphAsset: (sessionId, preloadedSegments) =>
    loadMergedGraphAsset(sessionId, structurerDeps, preloadedSegments),
};

const workQueueCallbacks: WorkQueueCallbacks = {
  ensureHydrated: () => ensureHydrated(persistenceDeps),
  rehydrateRuntimeState: () => rehydrateRuntimeState(persistenceDeps),
  notifySessionState: (state) => notifySessionState(state, S),
  persistRuntimeState: () => persistRuntimeState(S, RUNTIME_STATE_KEY),
  transcriptChunkRepository,
  withIndexedDbRetry,
  isIndexedDbBackingStoreError,
  runStructurerForTranscriptContext: (params) =>
    runStructurerForTranscriptContext(params, S, structurerDeps),
  notifyProviderProgress: (stage, message) => notifyProviderProgress(stage, message),
};

const sessionLifecycleCallbacks: SessionLifecycleCallbacks = {
  ensureHydrated: () => ensureHydrated(persistenceDeps),
  persistRuntimeState: () => persistRuntimeState(S, RUNTIME_STATE_KEY),
  clearRuntimeState: () => clearRuntimeState(S, RUNTIME_STATE_KEY),
  loadProviderRuntimeFromSettings: () => loadProviderRuntimeFromSettings(providerDeps),
  applyBootstrapProviderRuntime: () => applyBootstrapProviderRuntime(providerDeps),
  sendMessageToContentScript,
  buildContentScriptStartPayload: () => buildContentScriptStartPayload(S),
  notifySessionState: (state) => notifySessionState(state, S),
  notifyError,
  waitForChunkQueueToSettle: () => waitForChunkQueueToSettle(S),
  waitForTranscriptProcessingToSettle: () => waitForTranscriptProcessingToSettle(S),
  flushPendingStructureBuffer: (reason) =>
    flushPendingStructureBuffer(S, reason, (params) =>
      runStructurerForTranscriptContext(params, S, structurerDeps)),
  resetAssemblerState: () => resetAssemblerState(S),
  withIndexedDbRetry,
  sessionRepository,
  runtimeStateKey: RUNTIME_STATE_KEY,
  lastStoppedSessionKey: LAST_STOPPED_SESSION_KEY,
  notifyProviderProgress,
  persistAssemblerTrace,
};

// ─── 初始化 ─────────────────────────────────────────────────────────────────

applyBootstrapProviderRuntime(providerDeps);

chrome.runtime.onInstalled.addListener(() => {
  console.log('[Service Worker] Listen Graphic 已安装');
});

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;
  await chrome.sidePanel.open({ tabId: tab.id });
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  await ensureHydrated(persistenceDeps);
  await flushPendingSessionFinalize(S, sessionLifecycleCallbacks);
  if (!S.currentSession || S.currentSession.tabId !== tabId) {
    return;
  }

  await cleanupSession(
    { sessionId: S.currentSession.sessionId, state: 'stopped' },
    S,
    sessionLifecycleCallbacks,
  );
});

// ─── 消息路由 ──────────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener(
  (
    message: AppMessage,
    sender,
    sendResponse: (response: ServiceWorkerResponse) => void,
  ) => {
    if (message.target && message.target !== 'service-worker') {
      return false;
    }

    handleMessage(message, sender)
      .then(sendResponse)
      .catch(async (error: Error) => {
        console.error('[Service Worker] 处理消息失败:', error);
        await notifyError('SERVICE_WORKER_ERROR', error.message);
        sendResponse({ success: false, error: error.message });
      });

    return true;
  },
);

async function handleMessage(
  message: AppMessage,
  _sender: chrome.runtime.MessageSender,
): Promise<ServiceWorkerResponse> {
  await ensureHydrated(persistenceDeps);
  await flushPendingSessionFinalize(S, sessionLifecycleCallbacks);

  switch (message.type) {
    case 'SESSION_START':
      return startSession(message.payload.tabId, S, sessionLifecycleCallbacks);
    case 'SESSION_STOP':
      return stopSession(message.payload.sessionId, S, sessionLifecycleCallbacks);
    case 'GET_RUNTIME_SNAPSHOT':
      return {
        success: true,
        snapshot: await getRuntimeSnapshotForSidepanel(S, LAST_STOPPED_SESSION_KEY),
      } as ServiceWorkerResponse & { snapshot: RuntimeSnapshot };
    case 'GET_PROVIDER_SETTINGS':
      return handleGetProviderSettings(providerDeps);
    case 'SAVE_PROVIDER_SETTINGS':
      return handleSaveProviderSettings(message.payload.config, providerDeps);
    case 'CLEAR_PROVIDER_SECRETS':
      return handleClearProviderSecrets(providerDeps);
    case 'VIEW_SELECTED':
      return handleViewSelected(
        message.payload,
        S,
        () => ensureHydrated(persistenceDeps),
        () => persistRuntimeState(S, RUNTIME_STATE_KEY),
      );
    case 'EXPORT_SESSION':
      return handleExportSession(message.payload, S, {
        ensureHydrated: () => ensureHydrated(persistenceDeps),
        sessionRepository,
        transcriptChunkRepository,
        loadMergedGraphAsset: (sessionId) =>
          loadMergedGraphAsset(sessionId, structurerDeps),
        buildSessionExport,
      });
    case 'GET_DEBUG_SESSION':
      return handleGetDebugSession(message.payload.sessionId, S, {
        ensureHydrated: () => ensureHydrated(persistenceDeps),
        sessionRepository,
        transcriptChunkRepository,
        segmentGraphRepository,
        loadMergedGraphAsset: (sessionId, preloadedSegments) =>
          loadMergedGraphAsset(sessionId, structurerDeps, preloadedSegments),
      });
    case 'GET_REPLAY_SESSION':
      return handleGetReplaySession(message.payload.sessionId, {
        ensureHydrated: () => ensureHydrated(persistenceDeps),
        sessionRepository,
        transcriptChunkRepository,
        loadMergedGraphAsset: (sessionId) =>
          loadMergedGraphAsset(sessionId, structurerDeps),
      });
    case 'AUDIO_CHUNK_READY':
      return enqueueAudioChunk(message.payload, S, workQueueCallbacks);
    case 'ASR_STREAM_FINAL_READY':
    case 'ASR_STREAM_UTTERANCE_READY':
      return handleAsrStreamFinal(message.payload, S, {
        ensureHydrated: () => ensureHydrated(persistenceDeps),
        rehydrateRuntimeState: () => rehydrateRuntimeState(persistenceDeps),
        enqueueTranscriptProcessing: (work) =>
          enqueueTranscriptProcessing(work, S, workQueueCallbacks),
        processTranscriptChunk: (chunk) =>
          processTranscriptChunk(chunk, S, workQueueCallbacks),
        transcriptChunkRepository,
        withIndexedDbRetry,
        persistRuntimeState: () => persistRuntimeState(S, RUNTIME_STATE_KEY),
      });
    case 'ASR_STREAM_PARTIAL_UPDATED':
      return handleAsrStreamPartial(
        message.payload,
        S,
        () => ensureHydrated(persistenceDeps),
      );
    case 'ASR_STREAM_STATUS':
      return handleAsrStreamStatus(
        message.payload,
        S,
        () => ensureHydrated(persistenceDeps),
      );
    case 'ASR_STREAM_ERROR':
      return handleAsrStreamError(
        message.payload,
        S,
        () => ensureHydrated(persistenceDeps),
        notifyError,
        () => persistRuntimeState(S, RUNTIME_STATE_KEY),
      );
    case 'TEST_STRUCTURER_SESSION_RUN':
      return handleTestStructurerSessionRun(message.payload, S, {
        ensureHydrated: () => ensureHydrated(persistenceDeps),
        loadProviderRuntimeFromSettings: () => loadProviderRuntimeFromSettings(providerDeps),
        notifyError,
        persistRuntimeState: () => persistRuntimeState(S, RUNTIME_STATE_KEY),
        resetAssemblerState: () => resetAssemblerState(S),
        withIndexedDbRetry,
        sessionRepository,
        persistInjectedStructurerSeed: (params) =>
          persistInjectedStructurerSeed(params, {
            transcriptChunkRepository,
            mergedGraphRepository,
            withIndexedDbRetry,
          }),
        notifySessionState: (state) => notifySessionState(state, S),
        enqueueTranscriptProcessing: (work) =>
          enqueueTranscriptProcessing(work, S, workQueueCallbacks),
        processTranscriptChunk: (chunk) =>
          processTranscriptChunk(chunk, S, workQueueCallbacks),
        flushPendingStructureBuffer: (reason) =>
          flushPendingStructureBuffer(S, reason, (params) =>
            runStructurerForTranscriptContext(params, S, structurerDeps)),
        cleanupSession: (payload) =>
          cleanupSession(payload, S, sessionLifecycleCallbacks),
      });
    case 'NODE_CLICKED':
      return handleNodeClicked(
        message.payload,
        S,
        () => ensureHydrated(persistenceDeps),
        () => persistRuntimeState(S, RUNTIME_STATE_KEY),
      );
    case 'CAPTURE_ENDED':
      return handleCaptureEnded(
        _sender.tab?.id,
        message.payload.reason,
        S,
        sessionLifecycleCallbacks,
      );
    default:
      return { success: false, error: `未知消息类型: ${message.type}` };
  }
}

// ─── Service Worker 生命周期 ────────────────────────────────────────────────

chrome.runtime.onSuspend.addListener(() => {
  void ensureHydrated(persistenceDeps).then(() =>
    persistRuntimeState(S, RUNTIME_STATE_KEY),
  );
});

// 使 handleSaveProviderSettings 的 persistRuntimeState 在 provider 管理内生效
// 各模块的 persistRuntimeState 调用通过回调注入
