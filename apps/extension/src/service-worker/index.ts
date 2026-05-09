import { pickDefaultView } from '@listen-graphic/domain';
import {
  createDefaultProviderConfig,
  normalizeProviderConfig,
  createProviderRegistry,
  ProviderRequestError,
  redactProviderConfig,
  TencentAsrProvider,
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
  AsrProvider,
  EdgeType,
  GraphNode,
  MergedGraph,
  ProviderConfig,
  ProviderRuntimeSummary,
  SegmentGraph,
  SerializableProviderError,
  StructurerProvider,
  TranscriptChunk,
} from '@listen-graphic/schema';
import { generateId } from '@listen-graphic/shared-utils';
import type {
  AssemblerRunDebug,
  AppMessage,
  AsrStreamErrorPayload,
  AsrStreamFinalPayload,
  AsrStreamPartialPayload,
  AsrStreamStatusPayload,
  AudioChunkPayload,
  DebugSessionData,
  ExportFormat,
  ReplaySessionData,
  RuntimeSnapshot,
  SessionState,
  StructureUnitDebug,
  StructurerInjectionSeed,
  StructurerRunDebug,
} from '../shared/messages';
import { BUILD_INFO } from '../shared/build-info';
import { buildSessionExport } from './export-formatters';
import { createTencentRealtimeSessionConfig } from './tencent-realtime';
import type {
  PendingStructureBuffer,
  StructureUnit,
  StructureUnitCommitReason,
  AssemblerSignals,
  AssemblerDecision,
} from './assembler-types';
import {
  hasEnoughBootstrapContext,
  hasEnoughBatchBootstrapContext,
  hasEnoughRealtimeBootstrapContext,
  getTranscriptWindowDurationMs,
  getTranscriptWindowCharCount,
  getEffectiveTranscriptWindowCharCount,
  shouldSkipIncrementalStructuring,
  getNormalizedTranscriptCharCount,
  getEffectiveTranscriptCharCount,
  isLowInformationTranscript,
  appendToPendingStructureBuffer,
  createPendingStructureBuffer,
  decideAssemblerByScore,
  scoreAssemblerBoundary,
  isMergeWithPrevCandidate,
  looksLikeIncompleteUtterance,
  looksLikeCompletionAfterPrevious,
  materializeStructureUnit,
  expandSegmentEvidenceChunkIds,
  normalizeAssemblerText,
  hasTerminalPunctuation,
  hasIncompleteTailPattern,
  hasWeakSetupTailPattern,
} from './assembler-decision';
import {
  STRUCTURER_WINDOW_SIZE,
  STRUCTURER_BOOTSTRAP_MIN_CHUNKS,
  STRUCTURER_BOOTSTRAP_MIN_DURATION_MS,
  STRUCTURER_BOOTSTRAP_MIN_CHAR_COUNT,
  STRUCTURE_UNIT_ASSEMBLER_ENABLED,
  STRUCTURE_UNIT_SOFT_WAIT_MS,
  STRUCTURE_UNIT_HARD_WAIT_MS,
  STRUCTURE_UNIT_MIN_EFFECTIVE_CHARS_FOR_COMMIT,
  STRUCTURE_UNIT_MAX_BUFFERED_UTTERANCES,
  STRUCTURE_UNIT_MAX_BUFFERED_CHARS,
  STRUCTURE_UNIT_SCORE_COMMIT_THRESHOLD,
  STRUCTURE_UNIT_SCORE_WAIT_THRESHOLD,
  SCORE_BONUS_CHAR_THRESHOLD,
  SCORE_PENALTY_CHAR_THRESHOLD,
  SCORE_BONUS_UTTERANCE_MIN,
  INCOMPLETE_UTTERANCE_CHAR_LIMIT,
  COMPLETION_AFTER_PREV_CHAR_LIMIT,
} from './assembler-types';
import {
  isTimeoutProviderError,
  isSerializableProviderRequestError,
  serializeProviderError,
  type SerializeErrorFallbackContext,
  createProviderConfigError,
  sanitizeProviderError,
  normalizeAsrErrorCode,
  mergeProviderSecrets,
  constrainProviderConfigToDirectMode,
  stripProviderRetryOverrides,
  hasProviderRetryOverrides,
  stripProviderSecrets,
  createExtensionDefaultProviderConfig,
  toRecord,
} from './provider-config';
import {
  createStructurerRunDebug,
  finalizeStructurerRunDebug,
  attachStructurerRunDebug,
  readStructurerRunDebug,
} from './debug-trace';
import {
  mergeTopics,
  buildMergedGraphFromState,
  buildDebugTranscriptTraces,
} from './graph-building';

type ServiceWorkerResponse = {
  success: boolean;
  error?: string;
  sessionId?: string;
  alreadyRunning?: boolean;
  providerError?: SerializableProviderError;
};

type ActiveSession = {
  sessionId: string;
  tabId: number;
  state: SessionState;
};

type PersistedRuntimeState = {
  currentSession: ActiveSession | null;
  transcriptWindow: TranscriptChunk[];
  pendingStructureBuffer: PendingStructureBuffer | null;
  assemblerRuns: AssemblerRunDebug[];
  structureUnits: StructureUnitDebug[];
  mergedGraph: MergedGraph | null;
  transcriptSequence?: number;
  chunkIndex: number;
  currentTimeMs: number;
  currentView: RuntimeSnapshot['currentView'];
  currentViewPinned: boolean;
  structuringSince: number | null;
  lastTranscriptAt: number | null;
  lastGraphUpdatedAt: number | null;
  pendingSessionFinalize: { sessionId: string; endedAt: number } | null;
  providerSummary: ProviderRuntimeSummary;
  lastProviderError: SerializableProviderError | null;
  lastStructurerRun: StructurerRunDebug | null;
};

let currentSession: ActiveSession | null = null;
let recoveredSessionId: string | null = null;
let transcriptWindow: TranscriptChunk[] = [];
let pendingStructureBuffer: PendingStructureBuffer | null = null;
let assemblerRuns: AssemblerRunDebug[] = [];
let structureUnits: StructureUnitDebug[] = [];
let mergedGraph: MergedGraph | null = null;
let transcriptSequence = 0;
let currentTimeMs = 0;
let currentView: RuntimeSnapshot['currentView'];
let currentViewPinned = false;
let structuringSince: number | null = null;
let lastTranscriptAt: number | null = null;
let lastGraphUpdatedAt: number | null = null;
let pendingSessionFinalize: { sessionId: string; endedAt: number } | null = null;
let inFlightChunkPromise: Promise<ServiceWorkerResponse> | null = null;
let chunkQueueTail: Promise<void> = Promise.resolve();
let pendingChunkWorkCount = 0;
/** 与 file-chunk 队列独立：实时 ASR 的 processTranscriptChunk 必须入队，供 SESSION_STOP 等待 */
let inFlightTranscriptPromise: Promise<ServiceWorkerResponse> | null = null;
let transcriptProcessTail: Promise<void> = Promise.resolve();
let pendingTranscriptWorkCount = 0;
let stoppingSessionId: string | null = null;
let runtimeStateHydrated = false;
let hydrationPromise: Promise<void> | null = null;
let activeProviderConfig: ProviderConfig = createExtensionDefaultProviderConfig();
let providerSummary = redactProviderConfig(activeProviderConfig);
let lastProviderError: SerializableProviderError | null = null;
let lastStructurerRun: StructurerRunDebug | null = null;
let currentStructurerTarget: RuntimeSnapshot['currentStructurerTarget'] = null;
let asrProvider: AsrProvider;
let structurerProvider: StructurerProvider;

const RUNTIME_STATE_KEY = 'listen-graphic-runtime-state';
const LAST_STOPPED_SESSION_KEY = 'listen-graphic-last-stopped-session';

type LastStoppedSessionPayload = {
  sessionId: string;
  mergedGraph: MergedGraph;
  currentTimeMs: number;
  currentView: RuntimeSnapshot['currentView'];
  currentViewPinned: boolean;
};
const CONTENT_SCRIPT_FILE = 'content-script/content-script.js';
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

applyBootstrapProviderRuntime();

chrome.runtime.onInstalled.addListener(() => {
  console.log('[Service Worker] Listen Graphic 已安装');
});

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;
  await chrome.sidePanel.open({ tabId: tab.id });
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  await ensureHydrated();
  await flushPendingSessionFinalize();
  if (!currentSession || currentSession.tabId !== tabId) {
    return;
  }

  await cleanupSession({
    sessionId: currentSession.sessionId,
    state: 'stopped',
  });
});

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
  await ensureHydrated();
  await flushPendingSessionFinalize();

  switch (message.type) {
    case 'SESSION_START':
      return startSession(message.payload.tabId);
    case 'SESSION_STOP':
      return stopSession(message.payload.sessionId);
    case 'GET_RUNTIME_SNAPSHOT':
      return {
        success: true,
        snapshot: await getRuntimeSnapshotForSidepanel(),
      } as ServiceWorkerResponse & { snapshot: RuntimeSnapshot };
    case 'GET_PROVIDER_SETTINGS':
      return handleGetProviderSettings();
    case 'SAVE_PROVIDER_SETTINGS':
      return handleSaveProviderSettings(message.payload.config);
    case 'CLEAR_PROVIDER_SECRETS':
      return handleClearProviderSecrets();
    case 'VIEW_SELECTED':
      return handleViewSelected(message.payload);
    case 'EXPORT_SESSION':
      return handleExportSession(message.payload);
    case 'GET_DEBUG_SESSION':
      return handleGetDebugSession(message.payload.sessionId);
    case 'GET_REPLAY_SESSION':
      return handleGetReplaySession(message.payload.sessionId);
    case 'AUDIO_CHUNK_READY':
      return enqueueAudioChunk(message.payload);
    case 'ASR_STREAM_FINAL_READY':
    case 'ASR_STREAM_UTTERANCE_READY':
      return handleAsrStreamFinal(message.payload);
    case 'ASR_STREAM_PARTIAL_UPDATED':
      return handleAsrStreamPartial(message.payload);
    case 'ASR_STREAM_STATUS':
      return handleAsrStreamStatus(message.payload);
    case 'ASR_STREAM_ERROR':
      return handleAsrStreamError(message.payload);
    case 'TEST_STRUCTURER_SESSION_RUN':
      return handleTestStructurerSessionRun(message.payload);
    case 'NODE_CLICKED':
      return handleNodeClicked(message.payload);
    case 'CAPTURE_ENDED':
      return handleCaptureEnded(_sender.tab?.id, message.payload.reason);
    default:
      return { success: false, error: `未知消息类型: ${message.type}` };
  }
}

async function startSession(tabId: number): Promise<ServiceWorkerResponse> {
  await ensureHydrated();

  if (currentSession) {
    return {
      success: true,
      sessionId: currentSession.sessionId,
      alreadyRunning: true,
    };
  }

  try {
    await loadProviderRuntimeFromSettings();
    lastProviderError = null;
    lastStructurerRun = null;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : '读取 provider 配置失败';
    lastProviderError = createProviderConfigError(message);
    await notifyError('PROVIDER_CONFIG_ERROR', message);
    await persistRuntimeState();
    return { success: false, error: message };
  }

  const sessionId = generateId('session');
  try {
    await getRuntimeStorageArea().remove(LAST_STOPPED_SESSION_KEY);
  } catch (error) {
    console.warn('[Service Worker] 清理上次停止会话快照失败:', error);
  }

  currentSession = {
    sessionId,
    tabId,
    state: 'capturing',
  };
  recoveredSessionId = null;
  transcriptWindow = [];
  resetAssemblerState();
  mergedGraph = null;
  transcriptSequence = 0;
  currentTimeMs = 0;
  currentView = undefined;
  currentViewPinned = false;
  structuringSince = null;
  lastTranscriptAt = null;
  lastGraphUpdatedAt = null;
  pendingChunkWorkCount = 0;
  pendingTranscriptWorkCount = 0;
  currentStructurerTarget = null;
  stoppingSessionId = null;
  asrProvider.reset?.();
  structurerProvider.reset?.();
  await persistRuntimeState();
  let captureStarted = false;

  try {
    const capturePayload = await buildContentScriptStartPayload();
    const response = await sendMessageToContentScript(tabId, {
      type: 'START_CAPTURE',
      target: 'content-script',
      payload: capturePayload,
    });

    if (!response?.success) {
      throw new Error(response?.error || '内容脚本启动采集失败');
    }
    captureStarted = true;

    await withIndexedDbRetry(() =>
      sessionRepository.save({
      sessionId,
      sourceType: 'tab',
      createdAt: Date.now(),
      }),
    );
    await notifySessionState('capturing');
    return { success: true, sessionId };
  } catch (error) {
    currentSession = null;
    recoveredSessionId = null;
    mergedGraph = null;
    transcriptWindow = [];
    resetAssemblerState();
    transcriptSequence = 0;
    currentTimeMs = 0;
    currentView = undefined;
    currentViewPinned = false;
    structuringSince = null;
    lastTranscriptAt = null;
    lastGraphUpdatedAt = null;
    pendingChunkWorkCount = 0;
    pendingTranscriptWorkCount = 0;
    currentStructurerTarget = null;
    await clearRuntimeState();
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
    await notifyError('START_FAILED', message);
    return { success: false, error: message };
  }
}

async function stopSession(sessionId: string): Promise<ServiceWorkerResponse> {
  await ensureHydrated();

  if (!currentSession) {
    return { success: true };
  }

  const activeSession = currentSession;
  if (sessionId !== activeSession.sessionId) {
    return { success: false, error: '停止请求的 sessionId 与当前活动会话不匹配' };
  }

  stoppingSessionId = activeSession.sessionId;

  try {
    await chrome.tabs.sendMessage(activeSession.tabId, {
      type: 'STOP_CAPTURE',
      target: 'content-script',
      payload: {},
    } as AppMessage | { type: 'STOP_CAPTURE'; target: 'content-script'; payload: {} });
  } catch (error) {
    console.warn('[Service Worker] 停止采集时未收到内容脚本响应:', error);
  }

  asrProvider.reset?.();
  structurerProvider.reset?.();
  if (
    activeSession.state === 'structuring' ||
    inFlightTranscriptPromise ||
    inFlightChunkPromise
  ) {
    await notifyProviderProgress(
      'structurer',
      'Stop requested | waiting for in-flight work to settle',
    );
  }
  await waitForChunkQueueToSettle();
  await waitForTranscriptProcessingToSettle();
  const flushResponse = await flushPendingStructureBuffer('commit_force_flush');
  if (flushResponse && !flushResponse.success) {
    return flushResponse;
  }

  await cleanupSession({ sessionId: activeSession.sessionId, state: 'stopped' });
  return { success: true };
}

async function sendMessageToContentScript<TResponse = any>(
  tabId: number,
  message: Extract<AppMessage, { target: 'content-script' }>,
): Promise<TResponse> {
  try {
    return await chrome.tabs.sendMessage(tabId, message) as TResponse;
  } catch (error) {
    if (!isMissingReceiverError(error)) {
      throw error;
    }

    await ensureContentScriptInjected(tabId);
    return await chrome.tabs.sendMessage(tabId, message) as TResponse;
  }
}

async function ensureContentScriptInjected(tabId: number) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: [CONTENT_SCRIPT_FILE],
  });
}

function isMissingReceiverError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }

  return (
    error.message.includes('Receiving end does not exist') ||
    error.message.includes('Could not establish connection')
  );
}

function enqueueAudioChunk(payload: AudioChunkPayload): Promise<ServiceWorkerResponse> {
  pendingChunkWorkCount += 1;
  if (currentSession) {
    void notifySessionState(currentSession.state);
  }
  const chunkPromise = chunkQueueTail
    .catch(() => undefined)
    .then(async () => {
      const currentPromise = handleAudioChunk(payload);
      inFlightChunkPromise = currentPromise;

      try {
        return await currentPromise;
      } finally {
        if (inFlightChunkPromise === currentPromise) {
          inFlightChunkPromise = null;
        }
        pendingChunkWorkCount = Math.max(pendingChunkWorkCount - 1, 0);
        if (currentSession) {
          void notifySessionState(currentSession.state);
        }
      }
    });

  chunkQueueTail = chunkPromise.then(
    () => undefined,
    () => undefined,
  );

  return chunkPromise;
}

async function waitForChunkQueueToSettle() {
  await chunkQueueTail;

  if (inFlightChunkPromise) {
    await inFlightChunkPromise;
  }
}

function enqueueTranscriptProcessing(
  work: () => Promise<ServiceWorkerResponse>,
): Promise<ServiceWorkerResponse> {
  pendingTranscriptWorkCount += 1;
  if (currentSession) {
    void notifySessionState(currentSession.state);
  }
  const transcriptPromise = transcriptProcessTail
    .catch(() => undefined)
    .then(async () => {
      const currentPromise = work();
      inFlightTranscriptPromise = currentPromise;

      try {
        return await currentPromise;
      } finally {
        if (inFlightTranscriptPromise === currentPromise) {
          inFlightTranscriptPromise = null;
        }
        pendingTranscriptWorkCount = Math.max(pendingTranscriptWorkCount - 1, 0);
        if (currentSession) {
          void notifySessionState(currentSession.state);
        }
      }
    });

  transcriptProcessTail = transcriptPromise.then(
    () => undefined,
    () => undefined,
  );

  return transcriptPromise;
}

async function waitForTranscriptProcessingToSettle() {
  await transcriptProcessTail;

  if (inFlightTranscriptPromise) {
    await inFlightTranscriptPromise;
  }
}

async function handleAudioChunk(
  payload: AudioChunkPayload,
): Promise<ServiceWorkerResponse> {
  await ensureHydrated();

  if (!currentSession) {
    await rehydrateRuntimeState();
  }

  if (!currentSession) {
    return { success: false, error: '没有活动会话' };
  }

  if (
    currentSession.state === 'error' ||
    stoppingSessionId === currentSession.sessionId
  ) {
    return { success: false, error: '当前会话已停止或进入错误状态' };
  }

  const audioBytes = new Uint8Array(payload.audioData);
  const audioBlob = new Blob([audioBytes], {
    type: payload.audioMimeType ?? 'audio/wav',
  });

  try {
    await notifySessionState('transcribing');

    const transcript = await asrProvider.transcribeChunk({
      sessionId: currentSession.sessionId,
      audio: audioBlob,
      startMs: payload.startMs,
      endMs: payload.endMs,
    });
    return await enqueueTranscriptProcessing(() => processTranscriptChunk(transcript));
  } catch (error) {
    if (currentSession && stoppingSessionId === currentSession.sessionId) {
      return { success: false, error: '会话停止中' };
    }

    lastProviderError = serializeProviderError(error, getSerializeErrorFallback());
    const message = lastProviderError.message;
    currentSession.state = 'error';
    await notifySessionState('error');
    await persistRuntimeState();
    await notifyError(lastProviderError?.code ?? 'CHUNK_PROCESS_ERROR', message);
    return { success: false, error: message, providerError: lastProviderError };
  }
}

async function handleAsrStreamFinal(
  payload: AsrStreamFinalPayload,
): Promise<ServiceWorkerResponse> {
  await ensureHydrated();

  if (!currentSession) {
    return { success: false, error: '没有活动会话' };
  }

  if (
    currentSession.state === 'error' ||
    stoppingSessionId === currentSession.sessionId
  ) {
    return { success: false, error: '当前会话已停止或进入错误状态' };
  }

  const transcript: TranscriptChunk = {
    chunkId: generateId('chunk'),
    sessionId: currentSession.sessionId,
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

  return enqueueTranscriptProcessing(() => processTranscriptChunk(transcript));
}

async function handleAsrStreamPartial(
  payload: AsrStreamPartialPayload,
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

async function handleAsrStreamStatus(
  payload: AsrStreamStatusPayload,
): Promise<ServiceWorkerResponse> {
  await ensureHydrated();
  await notifyProviderProgress('asr', payload.detail ?? `${payload.provider} ${payload.status}`);
  return { success: true };
}

async function handleAsrStreamError(
  payload: AsrStreamErrorPayload,
): Promise<ServiceWorkerResponse> {
  await ensureHydrated();

  lastProviderError = serializeProviderError(
    new ProviderRequestError({
      code: normalizeAsrErrorCode(payload.code),
      message: payload.message,
      provider: payload.provider,
      stage: 'asr',
      retriable: false,
    }),
  );

  if (currentSession) {
    currentSession.state = 'error';
    await notifySessionState('error');
    await persistRuntimeState();
  }
  await notifyError(lastProviderError.code, lastProviderError.message);
  return { success: false, error: lastProviderError.message, providerError: lastProviderError };
}

async function processTranscriptChunk(
  transcript: TranscriptChunk,
): Promise<ServiceWorkerResponse> {
  const chunkSessionId = currentSession?.sessionId;
  if (!chunkSessionId) {
    return { success: false, error: '没有活动会话' };
  }

  try {
    try {
      await withIndexedDbRetry(() => transcriptChunkRepository.append(transcript));
    } catch (error) {
      if (!isIndexedDbBackingStoreError(error)) {
        throw error;
      }
      console.warn('[Service Worker] transcript 持久化暂不可用，保留内存态结果:', error);
    }
    appendTranscriptToWindow(transcript);
    currentTimeMs = transcript.endMs;
    lastTranscriptAt = Date.now();

    await broadcastToSidepanel({
      type: 'TRANSCRIPT_READY',
      target: 'sidepanel',
      payload: { transcript },
    });

    const assemblerContext = getStructurerInvocationContextFromAssembler(transcript);
    if (!assemblerContext) {
      lastProviderError = null;
      await notifySessionState('capturing');
      await persistRuntimeState();
      return { success: true };
    }

    return await runStructurerForTranscriptContext({
      chunkSessionId,
      transcript: assemblerContext.transcript,
      structurerWindow: assemblerContext.structurerWindow,
      evidenceChunkIds: assemblerContext.evidenceChunkIds,
    });
  } catch (error) {
    if (!currentSession || currentSession.sessionId !== chunkSessionId) {
      return { success: false, error: '会话已结束' };
    }

    if (stoppingSessionId === currentSession.sessionId) {
      return { success: false, error: '会话停止中' };
    }

    lastProviderError = serializeProviderError(error, getSerializeErrorFallback());
    const message = lastProviderError.message;
    currentSession.state = 'error';
    await notifySessionState('error');
    await persistRuntimeState();
    await notifyError(lastProviderError?.code ?? 'CHUNK_PROCESS_ERROR', message);
    return { success: false, error: message, providerError: lastProviderError };
  }
}

async function handleTestStructurerSessionRun(payload: {
  seed?: StructurerInjectionSeed;
  transcripts: TranscriptChunk[];
  finalizeSession?: boolean;
}): Promise<ServiceWorkerResponse> {
  if (!payload.transcripts.length) {
    return { success: false, error: '缺少 transcripts，无法执行 structure-focused 测试' };
  }

  try {
    await loadProviderRuntimeFromSettings();
    lastProviderError = null;
    lastStructurerRun = null;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : '读取 provider 配置失败';
    lastProviderError = createProviderConfigError(message);
    await notifyError('PROVIDER_CONFIG_ERROR', message);
    await persistRuntimeState();
    return { success: false, error: message };
  }

  const sessionId = payload.seed?.sessionId ?? generateId('session');
  const sourceType = payload.seed?.sourceType ?? 'file';

  currentSession = {
    sessionId,
    tabId: -1,
    state: 'capturing',
  };
  recoveredSessionId = null;
  transcriptWindow = [...(payload.seed?.transcriptWindow ?? [])];
  resetAssemblerState();
  mergedGraph = payload.seed?.mergedGraph ?? null;
  transcriptSequence =
    payload.seed?.transcriptSequence ??
    payload.seed?.chunkIndex ??
    transcriptWindow.length;
  currentTimeMs =
    payload.seed?.currentTimeMs ??
    transcriptWindow[transcriptWindow.length - 1]?.endMs ??
    0;
  currentView = mergedGraph?.viewHints?.defaultView;
  currentViewPinned = false;
  structuringSince = null;
  lastTranscriptAt = null;
  lastGraphUpdatedAt = null;
  pendingChunkWorkCount = 0;
  pendingTranscriptWorkCount = 0;
  currentStructurerTarget = null;
  pendingSessionFinalize = null;
  stoppingSessionId = null;
  asrProvider.reset?.();
  structurerProvider.reset?.();

  await withIndexedDbRetry(() =>
    sessionRepository.save({
      sessionId,
      sourceType,
      createdAt: Date.now(),
    }),
  );
  await persistInjectedStructurerSeed({
    sessionId,
    transcriptWindow,
    mergedGraph,
  });
  await notifySessionState('capturing');

  for (const nextTranscript of payload.transcripts) {
    const transcript: TranscriptChunk = {
      ...nextTranscript,
      sessionId,
    };
    const response = await enqueueTranscriptProcessing(() =>
      processTranscriptChunk(transcript),
    );
    if (!response.success) {
      return response;
    }
  }

  if (payload.finalizeSession ?? true) {
    const flushResponse = await flushPendingStructureBuffer('commit_force_flush');
    if (flushResponse && !flushResponse.success) {
      return flushResponse;
    }
    await cleanupSession({
      sessionId,
      state: 'stopped',
    });
  }

  return { success: true, sessionId };
}

async function persistInjectedStructurerSeed(params: {
  sessionId: string;
  transcriptWindow: TranscriptChunk[];
  mergedGraph: MergedGraph | null;
}) {
  for (const transcript of params.transcriptWindow) {
    try {
      await withIndexedDbRetry(() => transcriptChunkRepository.append(transcript));
    } catch (error) {
      if (!isIndexedDbBackingStoreError(error)) {
        throw error;
      }
      console.warn('[Service Worker] seed transcript 持久化暂不可用，保留内存态结果:', error);
    }
  }

  if (!params.mergedGraph) {
    return;
  }

  try {
    await withIndexedDbRetry(() => mergedGraphRepository.save(params.mergedGraph!));
  } catch (error) {
    if (!isIndexedDbBackingStoreError(error)) {
      throw error;
    }
    console.warn('[Service Worker] seed merged graph 持久化暂不可用，保留内存态结果:', error);
  }
}

async function handleNodeClicked(payload: {
  sessionId: string;
  nodeId: string;
  timestampMs: number;
}): Promise<ServiceWorkerResponse> {
  await ensureHydrated();

  if (!currentSession || currentSession.sessionId !== payload.sessionId) {
    return { success: false, error: '当前没有可跳转的活动会话' };
  }

  try {
    const response = await chrome.tabs.sendMessage(currentSession.tabId, {
      type: 'SEEK_TO_TIMESTAMP',
      target: 'content-script',
      payload: {
        timestampMs: payload.timestampMs,
        nodeId: payload.nodeId,
      },
    } as AppMessage);

    if (!response?.success) {
      throw new Error(response?.error || '页面播放器不支持跳转');
    }

    await broadcastToSidepanel({
      type: 'PLAYBACK_TIME_UPDATED',
      target: 'sidepanel',
      payload: { currentTimeMs: payload.timestampMs },
    });
    currentTimeMs = payload.timestampMs;
    await persistRuntimeState();

    return { success: true };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : '播放器跳转失败';
    await notifyError('SEEK_ERROR', message);
    return { success: false, error: message };
  }
}

async function handleViewSelected(payload: {
  sessionId: string;
  view: RuntimeSnapshot['currentView'];
}): Promise<ServiceWorkerResponse> {
  await ensureHydrated();

  if (!currentSession || currentSession.sessionId !== payload.sessionId) {
    return { success: false, error: '当前没有可记录视图的活动会话' };
  }

  currentView = payload.view;
  currentViewPinned = true;
  await persistRuntimeState();
  return { success: true };
}

async function handleExportSession(payload: {
  sessionId: string;
  format: ExportFormat;
}): Promise<ServiceWorkerResponse> {
  await ensureHydrated();

  if (
    currentSession &&
    currentSession.sessionId === payload.sessionId &&
    (currentSession.state !== 'capturing' || inFlightChunkPromise)
  ) {
    return { success: false, error: '当前会话仍在处理中，请稍后导出' };
  }

  const session = (await sessionRepository.get(payload.sessionId)) as
    | SessionRecord
    | undefined;
  const transcripts = await transcriptChunkRepository.listBySession(payload.sessionId);
  const graph = await loadMergedGraphAsset(payload.sessionId);

  if (!graph) {
    return { success: false, error: '缺少 graph 资产，无法导出' };
  }

  const exportData = buildSessionExport(
    {
      session,
      transcripts,
      graph,
      assemblerRuns: getAssemblerRunsForDebugSession(payload.sessionId),
      structureUnits: getStructureUnitsForDebugSession(payload.sessionId),
    },
    payload.format,
  );

  return {
    success: true,
    exportData,
  } as ServiceWorkerResponse & {
    exportData: {
      filename: string;
      mimeType: string;
      content: string;
    };
  };
}

async function handleGetDebugSession(sessionId: string): Promise<ServiceWorkerResponse> {
  await ensureHydrated();

  const debugData = await loadDebugSessionData(sessionId);
  return {
    success: true,
    debugData,
  } as ServiceWorkerResponse & { debugData: DebugSessionData };
}

async function handleGetProviderSettings(): Promise<ServiceWorkerResponse> {
  await ensureHydrated();
  const storedConfig = await settingsRepository.getProviderConfig();
  const config = stripProviderSecrets(
    constrainProviderConfigToDirectMode(
      normalizeProviderConfig(
        stripProviderRetryOverrides(storedConfig ?? createExtensionDefaultProviderConfig()),
      ),
    ),
  );
  return {
    success: true,
    config,
  } as ServiceWorkerResponse & { config: ProviderConfig };
}

async function handleSaveProviderSettings(
  config: ProviderConfig,
): Promise<ServiceWorkerResponse> {
  await ensureHydrated();
  const existingConfig = await settingsRepository.getProviderConfig();
  const normalized = stripProviderRetryOverrides(mergeProviderSecrets(
    constrainProviderConfigToDirectMode(normalizeProviderConfig(config)),
    existingConfig
      ? normalizeProviderConfig(stripProviderRetryOverrides(existingConfig))
      : undefined,
  ));
  const runtime = providerRegistry.createRuntimeProviders(normalized);
  await settingsRepository.saveProviderConfig(normalized);
  commitProviderRuntime(runtime);
  await persistRuntimeState();
  return { success: true };
}

async function handleClearProviderSecrets(): Promise<ServiceWorkerResponse> {
  await ensureHydrated();
  await settingsRepository.clearProviderSecrets();
  const fallbackConfig = stripProviderRetryOverrides(createExtensionDefaultProviderConfig());
  await settingsRepository.saveProviderConfig(fallbackConfig);
  applyBootstrapProviderRuntime();
  activeProviderConfig = fallbackConfig;
  providerSummary = redactProviderConfig(fallbackConfig);
  await persistRuntimeState();
  return { success: true };
}

async function loadDebugSessionData(sessionId: string): Promise<DebugSessionData> {
  const session = (await sessionRepository.get(sessionId)) as SessionRecord | undefined;
  const transcripts = await transcriptChunkRepository.listBySession(sessionId);
  const segments = await segmentGraphRepository.listBySession(sessionId);
  const graph = await loadMergedGraphAsset(sessionId, segments);
  const sessionStructurerRuns = getStructurerRunsForDebugSession(sessionId, segments);
  const sessionAssemblerRuns = getAssemblerRunsForDebugSession(sessionId);

  return {
    session: session ?? null,
    transcripts,
    segments,
    traces: buildDebugTranscriptTraces(
      transcripts,
      segments,
      sessionStructurerRuns,
      sessionAssemblerRuns,
    ),
    graph: graph ?? null,
    providerSummary,
    lastProviderError,
    structurerRuns: sessionStructurerRuns,
    assemblerRuns: sessionAssemblerRuns,
    structureUnits: getStructureUnitsForDebugSession(sessionId),
  };
}

async function handleGetReplaySession(sessionId: string): Promise<ServiceWorkerResponse> {
  await ensureHydrated();

  const replayData = await loadReplaySessionData(sessionId);
  return {
    success: true,
    replayData,
  } as ServiceWorkerResponse & { replayData: ReplaySessionData };
}

async function loadReplaySessionData(sessionId: string): Promise<ReplaySessionData> {
  const session = (await sessionRepository.get(sessionId)) as SessionRecord | undefined;
  const transcripts = await transcriptChunkRepository.listBySession(sessionId);
  const graph = await loadMergedGraphAsset(sessionId);
  const transcriptDuration = transcripts[transcripts.length - 1]?.endMs ?? 0;
  const graphDuration = Math.max(...(graph?.nodes.map((node) => node.timestampMs) ?? [0]));

  return {
    session: session ?? null,
    transcripts,
    graph: graph ?? null,
    durationMs: Math.max(transcriptDuration, graphDuration),
  };
}

async function handleCaptureEnded(
  senderTabId: number | undefined,
  reason: 'share-ended' | 'pagehide' | 'beforeunload',
): Promise<ServiceWorkerResponse> {
  await ensureHydrated();

  if (!currentSession) {
    return { success: true };
  }

  if (senderTabId && currentSession.tabId !== senderTabId) {
    return { success: false, error: '捕获结束消息来自非活动标签页' };
  }

  await cleanupSession({
    sessionId: currentSession.sessionId,
    state: 'stopped',
  });
  console.log('[Service Worker] 捕获已结束:', reason);
  return { success: true };
}

function appendTranscriptToWindow(transcript: TranscriptChunk) {
  transcriptSequence += 1;
  transcriptWindow = [...transcriptWindow, transcript].slice(-STRUCTURER_WINDOW_SIZE);
}

function getStructurerInvocationContextFromAssembler(transcript: TranscriptChunk): {
  transcript: TranscriptChunk;
  structurerWindow: TranscriptChunk[];
  evidenceChunkIds?: string[];
} | null {
  if (!shouldHandleWithStructureUnitAssembler(transcript)) {
    if (
      !mergedGraph &&
      !hasEnoughBootstrapContext(transcriptWindow, getCurrentAsrTransport()) &&
      !shouldForceBootstrapForExternalRealtimeWindow(transcriptWindow) &&
      !shouldForceBootstrapForCompletedRealtimeInput(transcript, transcriptWindow)
    ) {
      void notifyProviderProgress(
        'structurer',
        `等待 30 秒上下文或足够长的稳定话语 (${transcriptWindow.length}条/${getTranscriptWindowCharCount(transcriptWindow)}字)`,
      );
      return null;
    }

    if (mergedGraph && shouldSkipIncrementalStructuring(transcript)) {
      void notifyProviderProgress(
        'structurer',
        `跳过低信息量稳定话语 (${getNormalizedTranscriptCharCount(transcript)}字)`,
      );
      return null;
    }

    return {
      transcript,
      structurerWindow: transcriptWindow,
    };
  }

  const lowInformationTranscript = isLowInformationTranscript(transcript);
  if (lowInformationTranscript && !pendingStructureBuffer) {
    if (mergedGraph || !shouldForceBootstrapForCompletedRealtimeInput(transcript, transcriptWindow)) {
      recordAssemblerRunDebug({
        transcript,
        decision: 'skip_current',
        reason: `跳过低信息量稳定话语 (${getNormalizedTranscriptCharCount(transcript)}字)`,
      });
      void notifyProviderProgress(
        'structurer',
        `跳过低信息量稳定话语 (${getNormalizedTranscriptCharCount(transcript)}字)`,
      );
      return null;
    }
  }

  if (!lowInformationTranscript) {
    pendingStructureBuffer = appendToPendingStructureBuffer(pendingStructureBuffer, transcript);
  }

  const buffer = pendingStructureBuffer;
  if (!buffer) {
    return null;
  }

  const signals = deriveAssemblerSignals(buffer, transcript);
  const hardDecision = decideAssemblerByHardRules(transcript, buffer, signals);
  if (hardDecision) {
    if (hardDecision.type === 'skip_current') {
      recordAssemblerRunDebug({
        transcript,
        decision: 'skip_current',
        reason: hardDecision.reason,
      });
      return null;
    }
    if (hardDecision.type === 'wait') {
      recordAssemblerRunDebug({
        transcript,
        decision: 'wait',
        reason: hardDecision.reason,
      });
      void notifyProviderProgress('structurer', hardDecision.reason);
      return null;
    }
    if (hardDecision.type === 'commit') {
      return materializeAssemblerCommitContext(transcript, hardDecision.reason);
    }
  }

  const score = scoreAssemblerBoundary(buffer);
  const scoreDecision = decideAssemblerByScore(score);
  if (scoreDecision.type === 'wait') {
    recordAssemblerRunDebug({
      transcript,
      decision: 'wait',
      reason: scoreDecision.reason,
      score,
    });
    void notifyProviderProgress('structurer', `${scoreDecision.reason} (score=${score})`);
    return null;
  }

  if (scoreDecision.type !== 'commit') {
    return null;
  }
  const commitReason = scoreDecision.reason;
  return materializeAssemblerCommitContext(transcript, commitReason, score);
}

function resetAssemblerState(): void {
  pendingStructureBuffer = null;
  assemblerRuns = [];
  structureUnits = [];
}

function shouldHandleWithStructureUnitAssembler(transcript: TranscriptChunk) {
  return (
    STRUCTURE_UNIT_ASSEMBLER_ENABLED &&
    getCurrentAsrTransport() === 'ws' &&
    transcript.transport === 'ws'
  );
}

async function runStructurerForTranscriptContext(params: {
  chunkSessionId: string;
  transcript: TranscriptChunk;
  structurerWindow: TranscriptChunk[];
  evidenceChunkIds?: string[];
}): Promise<ServiceWorkerResponse> {
  if (!currentSession) {
    return { success: false, error: '没有活动会话' };
  }
  await notifySessionState('structuring');
  const structurerRun = createStructurerRunDebug({
    sessionId: currentSession.sessionId,
    sequence: transcriptSequence,
    transcript: params.transcript,
    transcriptWindow: params.structurerWindow,
    previousGraph: mergedGraph,
  });
  structuringSince = structurerRun.startedAt;
  currentStructurerTarget = {
    transcriptId: structurerRun.latestTranscriptId,
    transcriptEndMs: structurerRun.transcriptEndMs,
    transcriptCharCount: structurerRun.latestTranscriptCharCount,
    transcriptPreview: params.transcript.text.replace(/\s+/g, ' ').trim().slice(0, 48),
  };
  await notifyProviderProgress(
    'structurer',
    `Structurer started | ${structurerRun.mode} | window=${structurerRun.windowTranscriptCount} | latest=${structurerRun.latestTranscriptCharCount}字`,
  );

  let segment: SegmentGraph;
  try {
    segment = await structurerProvider.extractSegmentGraph({
      sessionId: currentSession.sessionId,
      transcriptWindow: params.structurerWindow,
      previousGraph: mergedGraph ?? undefined,
      language: 'zh',
    });
  } catch (error) {
    structuringSince = null;
    currentStructurerTarget = null;
    const providerShape = isSerializableProviderRequestError(error);
    lastStructurerRun = finalizeStructurerRunDebug(structurerRun, {
      status: isTimeoutProviderError(error) ? 'timeout' : 'error',
      errorCode:
        error instanceof ProviderRequestError
          ? error.code
          : providerShape
            ? error.code
            : 'STRUCTURE_ERROR',
      errorMessage:
        error instanceof Error ? error.message : 'Structurer 请求失败',
      structurerDiagnostics:
        error instanceof ProviderRequestError
          ? error.structurerDiagnostics
          : providerShape
            ? error.structurerDiagnostics
            : undefined,
    });
    await notifyProviderProgress(
      'structurer',
      `Structurer failed | ${lastStructurerRun.status} | ${lastStructurerRun.durationMs}ms | ${lastStructurerRun.errorCode ?? 'STRUCTURE_ERROR'}`,
    );
    throw error;
  }

  if (!currentSession || currentSession.sessionId !== params.chunkSessionId) {
    return { success: false, error: '会话已结束' };
  }

  if (params.evidenceChunkIds?.length) {
    segment = expandSegmentEvidenceChunkIds(
      segment,
      params.transcript.chunkId,
      params.evidenceChunkIds,
    );
  }

  structuringSince = null;
  currentStructurerTarget = null;
  lastStructurerRun = null;
  const finalizedStructurerRun = finalizeStructurerRunDebug(structurerRun, {
    status: 'success',
    segmentId: segment.segmentId,
    topic: segment.topic,
    nodeCount: segment.nodes.length,
    edgeCount: segment.edges.length,
    fallbackUsed: segment.nodes.some((node) => node.id.endsWith(':fallback')),
  });
  await notifyProviderProgress(
    'structurer',
    `Structurer finished | ${finalizedStructurerRun.durationMs}ms | nodes=${finalizedStructurerRun.nodeCount ?? 0} | edges=${finalizedStructurerRun.edgeCount ?? 0}`,
  );
  segment = attachStructurerRunDebug(segment, finalizedStructurerRun);
  try {
    await withIndexedDbRetry(() => segmentGraphRepository.append(segment));
  } catch (error) {
    if (!isIndexedDbBackingStoreError(error)) {
      throw error;
    }
    console.warn('[Service Worker] segment graph 持久化暂不可用，保留内存态结果:', error);
  }
  const nextMergedGraph = buildMergedGraph(segment);
  try {
    await withIndexedDbRetry(() => mergedGraphRepository.save(nextMergedGraph));
  } catch (error) {
    if (!isIndexedDbBackingStoreError(error)) {
      throw error;
    }
    console.warn('[Service Worker] merged graph 持久化暂不可用，保留内存态结果:', error);
  }
  mergedGraph = nextMergedGraph;
  lastGraphUpdatedAt = Date.now();
  if (!currentViewPinned) {
    currentView = mergedGraph.viewHints?.defaultView ?? pickDefaultView(mergedGraph);
  }

  await broadcastToSidepanel({
    type: 'MERGED_GRAPH_UPDATED',
    target: 'sidepanel',
    payload: { graph: mergedGraph },
  });

  lastProviderError = null;
  await notifySessionState('capturing');
  await persistRuntimeState();
  return { success: true };
}


function shouldForceBootstrapForCompletedRealtimeInput(
  transcript: TranscriptChunk,
  window: TranscriptChunk[],
) {
  if (getCurrentAsrTransport() !== 'ws' || mergedGraph) {
    return false;
  }

  if (
    transcript.finalReason !== 'input_finished' &&
    transcript.finalReason !== 'manual_flush'
  ) {
    return false;
  }

  return getEffectiveTranscriptWindowCharCount(window) > 0;
}

function shouldForceBootstrapForExternalRealtimeWindow(window: TranscriptChunk[]) {
  if (getCurrentAsrTransport() !== 'ws' || mergedGraph) {
    return false;
  }

  if (activeProviderConfig.asr.type !== 'external') {
    return false;
  }

  return (
    window.length >= STRUCTURER_WINDOW_SIZE &&
    getEffectiveTranscriptWindowCharCount(window) > 0
  );
}

function getCurrentAsrTransport() {
  return activeProviderConfig.asr.transport === 'ws' ? 'ws' : 'batch';
}

function deriveAssemblerSignals(
  buffer: PendingStructureBuffer,
  transcript: TranscriptChunk,
): AssemblerSignals {
  return {
    waitMs: Math.max(0, Date.now() - buffer.startedAt),
    hasBootstrapReadyContext: hasEnoughBootstrapContext(transcriptWindow, getCurrentAsrTransport()),
    forceBootstrapExternal: shouldForceBootstrapForExternalRealtimeWindow(transcriptWindow),
    forceBootstrapCompleted: shouldForceBootstrapForCompletedRealtimeInput(
      transcript,
      transcriptWindow,
    ),
    hitHardWait: Date.now() - buffer.startedAt >= STRUCTURE_UNIT_HARD_WAIT_MS,
    hitMaxBufferedUtterances:
      buffer.utterances.length >= STRUCTURE_UNIT_MAX_BUFFERED_UTTERANCES,
    hitMaxBufferedChars: buffer.effectiveChars >= STRUCTURE_UNIT_MAX_BUFFERED_CHARS,
  };
}

function decideAssemblerByHardRules(
  transcript: TranscriptChunk,
  buffer: PendingStructureBuffer,
  signals: AssemblerSignals,
): AssemblerDecision | null {
  if (signals.hitHardWait) {
    return { type: 'commit', reason: 'commit_timeout' };
  }

  if (
    transcript.finalReason === 'input_finished' ||
    transcript.finalReason === 'manual_flush'
  ) {
    return { type: 'commit', reason: 'commit_force_flush' };
  }

  if (mergedGraph && (signals.hitMaxBufferedUtterances || signals.hitMaxBufferedChars)) {
    return { type: 'commit', reason: 'commit_force_flush' };
  }

  if (mergedGraph && isMergeWithPrevCandidate(buffer)) {
    return { type: 'commit', reason: 'merge_with_prev' };
  }

  if (!mergedGraph) {
    if (signals.forceBootstrapExternal || signals.forceBootstrapCompleted) {
      return { type: 'commit', reason: 'commit_force_flush' };
    }

    if (!signals.hasBootstrapReadyContext) {
      return {
        type: 'wait',
        reason: `等待 30 秒上下文或足够长的稳定话语 (${transcriptWindow.length}条/${getTranscriptWindowCharCount(transcriptWindow)}字)`,
      };
    }

    if (
      getTranscriptWindowDurationMs(transcriptWindow) >= STRUCTURER_BOOTSTRAP_MIN_DURATION_MS ||
      getEffectiveTranscriptWindowCharCount(transcriptWindow) >=
        STRUCTURER_BOOTSTRAP_MIN_CHAR_COUNT
    ) {
      return { type: 'commit', reason: 'commit_rule' };
    }
  }

  if (
    buffer.sawTerminalPunctuation &&
    buffer.effectiveChars >= STRUCTURE_UNIT_MIN_EFFECTIVE_CHARS_FOR_COMMIT &&
    !buffer.sawIncompleteTail
  ) {
    return { type: 'commit', reason: 'commit_rule' };
  }

  return null;
}

function materializeAssemblerCommitContext(
  transcript: TranscriptChunk,
  reason: StructureUnitCommitReason,
  score?: number,
) {
  const buffer = pendingStructureBuffer;
  if (!buffer || buffer.utterances.length === 0) {
    return null;
  }

  pendingStructureBuffer = null;
  if (!mergedGraph || buffer.utterances.length === 1) {
    const latestTranscript = buffer.utterances[buffer.utterances.length - 1]!;
    recordAssemblerRunDebug({
      transcript,
      decision: 'commit',
      reason,
      score,
    });
    return {
      transcript: latestTranscript,
      structurerWindow: transcriptWindow,
    };
  }

  const unit = materializeStructureUnit(buffer, reason);
  recordStructureUnitDebug(unit);
  recordAssemblerRunDebug({
    transcript,
    decision: 'commit',
    reason,
    score,
    committedUnitId: unit.unitId,
    committedChunkIds: unit.sourceChunkIds,
    committedText: unit.text,
  });
  return {
    transcript: unit.transcript,
    structurerWindow: collapseTranscriptWindowWithStructureUnit(unit),
    evidenceChunkIds: unit.sourceChunkIds,
  };
}

async function flushPendingStructureBuffer(
  reason: StructureUnitCommitReason,
): Promise<ServiceWorkerResponse | null> {
  if (!pendingStructureBuffer || !currentSession) {
    return null;
  }

  if (pendingStructureBuffer.effectiveChars <= 0) {
    pendingStructureBuffer = null;
    await persistRuntimeState();
    return { success: true };
  }

  const latestTranscript =
    pendingStructureBuffer.utterances[pendingStructureBuffer.utterances.length - 1]!;
  const context = materializeAssemblerCommitContext(latestTranscript, reason);
  if (!context) {
    return { success: true };
  }

  return await runStructurerForTranscriptContext({
    chunkSessionId: currentSession.sessionId,
    transcript: context.transcript,
    structurerWindow: context.structurerWindow,
    evidenceChunkIds: context.evidenceChunkIds,
  });
}

function recordAssemblerRunDebug(params: {
  transcript: TranscriptChunk;
  decision: AssemblerRunDebug['decision'];
  reason: string;
  score?: number;
  committedUnitId?: string;
  committedChunkIds?: string[];
  committedText?: string;
}) {
  const buffer = pendingStructureBuffer;
  const bufferUtterances = buffer?.utterances ?? [params.transcript];
  assemblerRuns = [
    ...assemblerRuns,
    {
      sessionId: currentSession?.sessionId ?? params.transcript.sessionId,
      sequence: transcriptSequence,
      latestTranscriptId: params.transcript.chunkId,
      latestTranscriptEndMs: params.transcript.endMs,
      decision: params.decision,
      reason: params.reason,
      bufferTranscriptIds: bufferUtterances.map((item) => item.chunkId),
      bufferTranscriptCount: bufferUtterances.length,
      bufferStartMs: bufferUtterances[0]?.startMs ?? params.transcript.startMs,
      bufferEndMs: bufferUtterances[bufferUtterances.length - 1]?.endMs ?? params.transcript.endMs,
      totalCharCount:
        buffer?.totalChars ?? getNormalizedTranscriptCharCount(params.transcript),
      effectiveCharCount:
        buffer?.effectiveChars ?? getEffectiveTranscriptCharCount(params.transcript),
      waitMs: buffer ? Math.max(0, Date.now() - buffer.startedAt) : 0,
      sawTerminalPunctuation: buffer?.sawTerminalPunctuation ?? hasTerminalPunctuation(params.transcript.text),
      sawIncompleteTail: buffer?.sawIncompleteTail ?? hasIncompleteTailPattern(params.transcript.text),
      score: params.score,
      committedUnitId: params.committedUnitId,
      committedChunkIds: params.committedChunkIds,
      committedText: params.committedText,
      createdAt: Date.now(),
    },
  ].slice(-200);
}

function recordStructureUnitDebug(unit: StructureUnit) {
  structureUnits = [
    ...structureUnits,
    {
      unitId: unit.unitId,
      sessionId: currentSession?.sessionId ?? unit.transcript.sessionId,
      startMs: unit.startMs,
      endMs: unit.endMs,
      text: unit.text,
      sourceChunkIds: unit.sourceChunkIds,
      reason: unit.reason,
      createdAt: Date.now(),
    },
  ].slice(-100);
}

function collapseTranscriptWindowWithStructureUnit(unit: StructureUnit) {
  const collapsedPrefix = transcriptWindow.slice(
    0,
    Math.max(0, transcriptWindow.length - unit.sourceChunkIds.length),
  );
  return [...collapsedPrefix, unit.transcript];
}

async function buildContentScriptStartPayload(): Promise<Extract<AppMessage, { type: 'START_CAPTURE' }>['payload']> {
  if (activeProviderConfig.asr.transport !== 'ws') {
    return { transport: 'batch' };
  }

  if (activeProviderConfig.asr.type === 'external') {
    return {
      transport: 'ws',
      stream: {
        providerType: 'external',
        provider: 'local-asr-bridge',
        endpoint: activeProviderConfig.asr.endpoint,
        protocol: activeProviderConfig.asr.bridgeProtocol ?? 'lg-asr-ws-v1',
        authToken: activeProviderConfig.asr.bridgeAuthToken,
        sampleRate: 16_000,
        frameDurationMs: 40,
      },
    };
  }

  if (activeProviderConfig.asr.type !== 'tencent') {
    return { transport: 'batch' };
  }

  const sessionConfig = await createTencentRealtimeSessionConfig(activeProviderConfig.asr);
  return {
    transport: 'ws',
    stream: {
      providerType: 'tencent',
      provider: 'tencent-asr',
      endpoint: sessionConfig.signedUrl,
      sampleRate: 16_000,
      frameDurationMs: 40,
    },
    tencentRealtime: {
      signedUrl: sessionConfig.signedUrl,
      sampleRate: 16_000,
      frameDurationMs: 40,
    },
  };
}

async function loadMergedGraphAsset(
  sessionId: string,
  preloadedSegments?: SegmentGraph[],
): Promise<MergedGraph | null> {
  const storedGraph = await mergedGraphRepository.getBySession(sessionId);
  if (storedGraph) {
    return storedGraph;
  }

  const segments = [...(preloadedSegments ?? await segmentGraphRepository.listBySession(sessionId))]
    .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  if (segments.length === 0) {
    return null;
  }

  const rebuiltGraph = segments.reduce<MergedGraph | null>(
    (currentGraph, segment) => buildMergedGraphFromState(currentGraph, segment),
    null,
  );
  if (!rebuiltGraph) {
    return null;
  }

  try {
    await withIndexedDbRetry(() => mergedGraphRepository.save(rebuiltGraph));
  } catch (error) {
    if (!isIndexedDbBackingStoreError(error)) {
      throw error;
    }
    console.warn('[Service Worker] rebuilt merged graph 持久化暂不可用，保留重建结果:', error);
  }

  return rebuiltGraph;
}

function buildMergedGraph(segment: SegmentGraph): MergedGraph {
  return buildMergedGraphFromState(mergedGraph, segment);
}

function getAssemblerRunsForDebugSession(sessionId: string) {
  return assemblerRuns
    .filter((run) => run.sessionId === sessionId)
    .sort((a, b) => a.latestTranscriptEndMs - b.latestTranscriptEndMs || a.createdAt - b.createdAt);
}

function getStructureUnitsForDebugSession(sessionId: string) {
  return structureUnits
    .filter((unit) => unit.sessionId === sessionId)
    .sort((a, b) => a.endMs - b.endMs || a.createdAt - b.createdAt);
}

function getPendingTranscriptCount() {
  return Math.max(
    pendingTranscriptWorkCount - (inFlightTranscriptPromise ? 1 : 0),
    0,
  );
}

function getPendingWorkCount() {
  return pendingChunkWorkCount + pendingTranscriptWorkCount;
}

function getStopDrainPendingCount() {
  return stoppingSessionId ? getPendingWorkCount() : 0;
}

async function notifySessionState(state: SessionState) {
  if (currentSession) {
    currentSession.state = state;
  }

  await broadcastToSidepanel({
    type: 'SESSION_STATE_CHANGED',
    target: 'sidepanel',
    payload: {
      sessionId: currentSession?.sessionId ?? null,
      state,
      pendingTranscriptCount: getPendingTranscriptCount(),
      pendingWorkCount: getPendingWorkCount(),
      stopDrainPendingCount: getStopDrainPendingCount(),
      currentStructurerTarget,
    },
  });
}

function getRuntimeStorageArea() {
  return chrome.storage.session ?? chrome.storage.local;
}

async function ensureHydrated() {
  if (runtimeStateHydrated) {
    return;
  }

  if (!hydrationPromise) {
    hydrationPromise = (async () => {
      const stored = await getRuntimeStorageArea().get(RUNTIME_STATE_KEY);
      const state = stored?.[RUNTIME_STATE_KEY] as PersistedRuntimeState | undefined;
      if (state) {
        currentSession = state.currentSession;
        recoveredSessionId = state.currentSession?.sessionId ?? null;
        transcriptWindow = state.transcriptWindow ?? [];
        pendingStructureBuffer = state.pendingStructureBuffer ?? null;
        assemblerRuns = state.assemblerRuns ?? [];
        structureUnits = state.structureUnits ?? [];
        mergedGraph = state.mergedGraph;
        transcriptSequence = state.transcriptSequence ?? state.chunkIndex ?? 0;
        currentTimeMs = state.currentTimeMs ?? 0;
        currentView = state.currentView;
        currentViewPinned = state.currentViewPinned ?? false;
        structuringSince = state.structuringSince ?? null;
        lastTranscriptAt = state.lastTranscriptAt ?? null;
        lastGraphUpdatedAt = state.lastGraphUpdatedAt ?? null;
        pendingSessionFinalize = state.pendingSessionFinalize ?? null;
        providerSummary = state.providerSummary ?? providerSummary;
        lastProviderError = state.lastProviderError ?? null;
        lastStructurerRun = state.lastStructurerRun ?? null;
        currentStructurerTarget = null;
      } else {
        const latestSession = (await sessionRepository.listRecent()).find(
          (session) => typeof session.endedAt === 'number',
        );
        if (latestSession) {
          const recoveredChunks = await transcriptChunkRepository.listBySession(
            latestSession.sessionId,
          );
          const recoveredGraph = await loadMergedGraphAsset(latestSession.sessionId);

          recoveredSessionId = latestSession.sessionId;
          transcriptWindow = recoveredChunks.slice(-3);
          resetAssemblerState();
          mergedGraph = recoveredGraph ?? null;
          transcriptSequence = recoveredChunks.length;
          currentTimeMs = recoveredChunks[recoveredChunks.length - 1]?.endMs ?? 0;
          currentView = recoveredGraph?.viewHints?.defaultView;
          currentViewPinned = false;
          structuringSince = null;
          lastTranscriptAt = null;
          lastGraphUpdatedAt = null;
          pendingChunkWorkCount = 0;
          pendingTranscriptWorkCount = 0;
          currentStructurerTarget = null;
          lastStructurerRun = null;
        }
      }
      try {
        await loadProviderRuntimeFromSettings();
      } catch (error) {
        console.warn('[Service Worker] provider 配置恢复失败，回退安全 runtime:', error);
        applyBootstrapProviderRuntime();
        activeProviderConfig = createExtensionDefaultProviderConfig();
        providerSummary = redactProviderConfig(activeProviderConfig);
      }
      runtimeStateHydrated = true;
    })().finally(() => {
      hydrationPromise = null;
    });
  }

  await hydrationPromise;
}

async function rehydrateRuntimeState() {
  runtimeStateHydrated = false;
  hydrationPromise = null;
  await ensureHydrated();
}

async function withIndexedDbRetry<T>(operation: () => Promise<T>) {
  let lastError: unknown;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!String(error).includes('opening backing store') || attempt === 2) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  throw lastError;
}

function isIndexedDbBackingStoreError(error: unknown) {
  return String(error).includes('opening backing store');
}

async function persistRuntimeState() {
  runtimeStateHydrated = true;
  try {
    await getRuntimeStorageArea().set({
      [RUNTIME_STATE_KEY]: {
        currentSession,
        transcriptWindow,
        pendingStructureBuffer,
        assemblerRuns: assemblerRuns.slice(-50),
        structureUnits: structureUnits.slice(-30),
        mergedGraph,
        transcriptSequence,
        chunkIndex: transcriptSequence,
        currentTimeMs,
        currentView,
        currentViewPinned,
        structuringSince,
        lastTranscriptAt,
        lastGraphUpdatedAt,
        pendingSessionFinalize,
        providerSummary,
        lastProviderError,
        lastStructurerRun,
      } satisfies PersistedRuntimeState,
    });
  } catch (error) {
    if (!isIndexedDbBackingStoreError(error)) {
      throw error;
    }
    console.warn('[Service Worker] runtime state 持久化暂不可用，保留内存态状态:', error);
  }
}

async function clearRuntimeState() {
  runtimeStateHydrated = true;
  try {
    await getRuntimeStorageArea().remove(RUNTIME_STATE_KEY);
  } catch (error) {
    if (!isIndexedDbBackingStoreError(error)) {
      throw error;
    }
    console.warn('[Service Worker] runtime state 清理暂不可用，等待下次 hydration 覆盖:', error);
  }
}

async function cleanupSession(payload: {
  sessionId: string;
  state: Extract<SessionState, 'stopped'>;
}) {
  const endedAt = Date.now();
  const lastMergedGraph = mergedGraph;
  const lastTimeMs = currentTimeMs;
  const lastView = currentView;
  const lastViewPinned = currentViewPinned;
  try {
    await sessionRepository.markEnded(payload.sessionId, endedAt);
    pendingSessionFinalize = null;
  } catch (error) {
    console.warn('[Service Worker] 标记会话结束失败:', error);
    pendingSessionFinalize = {
      sessionId: payload.sessionId,
      endedAt,
    };
  } finally {
    stoppingSessionId = null;
    currentSession = null;
    recoveredSessionId = null;
    transcriptWindow = [];
    resetAssemblerState();
    mergedGraph = null;
    transcriptSequence = 0;
    currentTimeMs = 0;
    currentView = undefined;
    currentViewPinned = false;
    structuringSince = null;
    lastTranscriptAt = null;
    lastGraphUpdatedAt = null;
    pendingChunkWorkCount = 0;
    pendingTranscriptWorkCount = 0;
    currentStructurerTarget = null;
    lastStructurerRun = null;
    if (pendingSessionFinalize) {
      await persistRuntimeState();
    } else {
      await clearRuntimeState();
    }

    if (lastMergedGraph) {
      try {
        await getRuntimeStorageArea().set({
          [LAST_STOPPED_SESSION_KEY]: {
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
        await getRuntimeStorageArea().remove(LAST_STOPPED_SESSION_KEY);
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

async function flushPendingSessionFinalize() {
  if (!pendingSessionFinalize) {
    return;
  }

  try {
    await sessionRepository.markEnded(
      pendingSessionFinalize.sessionId,
      pendingSessionFinalize.endedAt,
    );
    pendingSessionFinalize = null;
    if (
      !currentSession &&
      transcriptWindow.length === 0 &&
      !mergedGraph &&
      transcriptSequence === 0 &&
      currentTimeMs === 0 &&
      !currentView &&
      !currentViewPinned
    ) {
      await clearRuntimeState();
    } else {
      await persistRuntimeState();
    }
  } catch (error) {
    console.warn('[Service Worker] 补偿结束会话失败:', error);
  }
}

function getRuntimeSnapshot(): RuntimeSnapshot {
  return {
    sessionId: currentSession?.sessionId ?? recoveredSessionId,
    state:
      currentSession?.state ??
      (recoveredSessionId || mergedGraph || transcriptWindow.length > 0
        ? 'stopped'
        : 'idle'),
    graph: mergedGraph,
    currentTimeMs,
    currentView: currentView ?? mergedGraph?.viewHints?.defaultView,
    currentViewPinned,
    providerSummary,
    lastProviderError,
    lastStructurerRun,
    structuringSince,
    lastTranscriptAt,
    lastGraphUpdatedAt,
    pendingTranscriptCount: getPendingTranscriptCount(),
    pendingWorkCount: getPendingWorkCount(),
    stopDrainPendingCount: getStopDrainPendingCount(),
    currentStructurerTarget,
    currentAssemblerState: pendingStructureBuffer
      ? {
          enabled: true,
          pendingUtteranceCount: pendingStructureBuffer.utterances.length,
          pendingEffectiveCharCount: pendingStructureBuffer.effectiveChars,
          pendingWaitMs: Math.max(0, Date.now() - pendingStructureBuffer.startedAt),
          pendingPreview: pendingStructureBuffer.utterances
            .map((item) => item.text.trim())
            .filter(Boolean)
            .join(' ')
            .slice(0, 96),
        }
      : {
          enabled: shouldHandleWithStructureUnitAssembler({
            chunkId: '',
            sessionId: currentSession?.sessionId ?? recoveredSessionId ?? '',
            text: '',
            startMs: 0,
            endMs: 0,
            provider: '',
            transport: getCurrentAsrTransport(),
          }),
          pendingUtteranceCount: 0,
          pendingEffectiveCharCount: 0,
          pendingWaitMs: 0,
          pendingPreview: '',
        },
    workerBuild: BUILD_INFO,
  };
}

async function getRuntimeSnapshotForSidepanel(): Promise<RuntimeSnapshot> {
  const base = getRuntimeSnapshot();
  if (base.graph != null || base.sessionId != null) {
    return base;
  }

  try {
    const raw = await getRuntimeStorageArea().get(LAST_STOPPED_SESSION_KEY);
    const last = raw?.[LAST_STOPPED_SESSION_KEY] as LastStoppedSessionPayload | undefined;
    if (last?.mergedGraph && last.sessionId) {
      return {
        ...base,
        state: 'idle',
        graph: last.mergedGraph,
        currentTimeMs: last.currentTimeMs,
        currentView: last.currentView,
        currentViewPinned: last.currentViewPinned,
      };
    }
  } catch (error) {
    console.warn('[Service Worker] 读取停止会话图谱快照失败:', error);
  }

  return base;
}

function getStructurerRunsForDebugSession(
  sessionId: string,
  segments: SegmentGraph[],
): StructurerRunDebug[] {
  const successfulRuns = segments
    .map((segment) => readStructurerRunDebug(segment))
    .filter((run): run is StructurerRunDebug => Boolean(run))
    .filter((run) => run.sessionId === sessionId);

  if (lastStructurerRun && lastStructurerRun.sessionId === sessionId) {
    return [...successfulRuns, lastStructurerRun].sort(
      (a, b) => a.transcriptEndMs - b.transcriptEndMs || a.startedAt - b.startedAt,
    );
  }

  return successfulRuns.sort(
    (a, b) => a.transcriptEndMs - b.transcriptEndMs || a.startedAt - b.startedAt,
  );
}

function getSerializeErrorFallback(): SerializeErrorFallbackContext {
  const stage = currentSession?.state === 'structuring' || lastStructurerRun ? 'structurer' as const : 'asr' as const;
  const providerName = stage === 'structurer'
    ? structurerProvider?.name ?? 'unknown-provider'
    : asrProvider?.name ?? 'unknown-provider';
  return { stage, providerName };
}

async function notifyError(code: string, message: string) {
  await broadcastToSidepanel({
    type: 'ERROR',
    target: 'sidepanel',
    payload: { code, message },
  });
}

async function notifyProviderProgress(
  stage: 'asr' | 'structurer',
  message: string,
  asrSliceType?: 0 | 1,
) {
  await broadcastToSidepanel({
    type: 'PROVIDER_PROGRESS',
    target: 'sidepanel',
    payload: { stage, message, asrSliceType },
  });
}

async function broadcastToSidepanel(message: AppMessage): Promise<void> {
  try {
    await chrome.runtime.sendMessage(message);
  } catch (error) {
    console.debug('[Service Worker] sidepanel 未打开，忽略广播失败:', error);
  }
}

chrome.runtime.onSuspend.addListener(() => {
  void ensureHydrated().then(() => persistRuntimeState());
});

async function loadProviderRuntimeFromSettings() {
  const storedConfig = await settingsRepository.getProviderConfig();
  applyProviderRuntime(
    constrainProviderConfigToDirectMode(
      normalizeProviderConfig(storedConfig ?? createExtensionDefaultProviderConfig()),
    ),
  );
}

function applyProviderRuntime(config: Partial<ProviderConfig> | ProviderConfig) {
  const runtime = providerRegistry.createRuntimeProviders(config);
  commitProviderRuntime(runtime);
}

function applyBootstrapProviderRuntime() {
  const runtime = providerRegistry.createRuntimeProviders(createDefaultProviderConfig());
  asrProvider = runtime.asr;
  structurerProvider = runtime.structurer;
}

function commitProviderRuntime(
  runtime: ReturnType<typeof providerRegistry.createRuntimeProviders>,
) {
  activeProviderConfig = runtime.config;
  providerSummary = redactProviderConfig(activeProviderConfig);
  asrProvider = runtime.asr;
  structurerProvider = runtime.structurer;

  if (asrProvider instanceof TencentAsrProvider) {
    asrProvider.setProgressListener((message) => {
      void notifyProviderProgress('asr', message);
    });
  }
}

