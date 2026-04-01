import { mergeSegmentGraph, pickDefaultView, scoreViews, stabilizeGraph } from '@listen-graphic/domain';
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
  AppMessage,
  AudioChunkPayload,
  DebugSessionData,
  ExportFormat,
  ReplaySessionData,
  RuntimeSnapshot,
  SessionState,
  StructurerInjectionSeed,
  StructurerRunDebug,
} from '../shared/messages';
import { BUILD_INFO } from '../shared/build-info';
import { buildSessionExport } from './export-formatters';

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
  mergedGraph: MergedGraph | null;
  chunkIndex: number;
  currentTimeMs: number;
  currentView: RuntimeSnapshot['currentView'];
  currentViewPinned: boolean;
  pendingSessionFinalize: { sessionId: string; endedAt: number } | null;
  providerSummary: ProviderRuntimeSummary;
  lastProviderError: SerializableProviderError | null;
  lastStructurerRun: StructurerRunDebug | null;
};

let currentSession: ActiveSession | null = null;
let recoveredSessionId: string | null = null;
let transcriptWindow: TranscriptChunk[] = [];
let mergedGraph: MergedGraph | null = null;
let chunkIndex = 0;
let currentTimeMs = 0;
let currentView: RuntimeSnapshot['currentView'];
let currentViewPinned = false;
let pendingSessionFinalize: { sessionId: string; endedAt: number } | null = null;
let inFlightChunkPromise: Promise<ServiceWorkerResponse> | null = null;
let chunkQueueTail: Promise<void> = Promise.resolve();
let stoppingSessionId: string | null = null;
let runtimeStateHydrated = false;
let hydrationPromise: Promise<void> | null = null;
let activeProviderConfig: ProviderConfig = createDefaultProviderConfig();
let providerSummary = redactProviderConfig(activeProviderConfig);
let lastProviderError: SerializableProviderError | null = null;
let lastStructurerRun: StructurerRunDebug | null = null;
let asrProvider: AsrProvider;
let structurerProvider: StructurerProvider;

const RUNTIME_STATE_KEY = 'listen-graphic-runtime-state';
const CONTENT_SCRIPT_FILE = 'content-script/content-script.js';
const STRUCTURER_BOOTSTRAP_WINDOW_SIZE = 3;
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

applyProviderRuntime(activeProviderConfig);

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
        snapshot: getRuntimeSnapshot(),
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
    await notifyError('PROVIDER_CONFIG_ERROR', message);
    return { success: false, error: message };
  }

  const sessionId = generateId('session');
  currentSession = {
    sessionId,
    tabId,
    state: 'capturing',
  };
  recoveredSessionId = null;
  transcriptWindow = [];
  mergedGraph = null;
  chunkIndex = 0;
  currentTimeMs = 0;
  currentView = undefined;
  currentViewPinned = false;
  stoppingSessionId = null;
  asrProvider.reset?.();
  structurerProvider.reset?.();
  await persistRuntimeState();
  let captureStarted = false;

  try {
    const response = await sendMessageToContentScript(tabId, {
      type: 'START_CAPTURE',
      target: 'content-script',
      payload: {},
    } as AppMessage | { type: 'START_CAPTURE'; target: 'content-script'; payload: {} });

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
    chunkIndex = 0;
    currentTimeMs = 0;
    currentView = undefined;
    currentViewPinned = false;
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
  await waitForChunkQueueToSettle();

  await cleanupSession({ sessionId: activeSession.sessionId, state: 'stopped' });
  return { success: true };
}

async function sendMessageToContentScript<TResponse = any>(
  tabId: number,
  message: AppMessage | { type: 'START_CAPTURE' | 'STOP_CAPTURE' | 'SEEK_TO_TIMESTAMP'; target: 'content-script'; payload: any },
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
    return await processTranscriptChunk(transcript);
  } catch (error) {
    if (currentSession && stoppingSessionId === currentSession.sessionId) {
      return { success: false, error: '会话停止中' };
    }

    lastProviderError = serializeProviderError(error);
    const message = lastProviderError.message;
    currentSession.state = 'error';
    await notifySessionState('error');
    await persistRuntimeState();
    await notifyError(lastProviderError?.code ?? 'CHUNK_PROCESS_ERROR', message);
    return { success: false, error: message, providerError: lastProviderError };
  }
}

async function processTranscriptChunk(
  transcript: TranscriptChunk,
): Promise<ServiceWorkerResponse> {
  try {
    try {
      await withIndexedDbRetry(() => transcriptChunkRepository.append(transcript));
    } catch (error) {
      if (!isIndexedDbBackingStoreError(error)) {
        throw error;
      }
      console.warn('[Service Worker] transcript 持久化暂不可用，保留内存态结果:', error);
    }
    pushTranscript(transcript);
    currentTimeMs = transcript.endMs;

    await broadcastToSidepanel({
      type: 'TRANSCRIPT_READY',
      target: 'sidepanel',
      payload: { transcript },
    });

    if (!mergedGraph && transcriptWindow.length < STRUCTURER_BOOTSTRAP_WINDOW_SIZE) {
      await notifyProviderProgress(
        'structurer',
        `等待 30 秒上下文 (${transcriptWindow.length}/${STRUCTURER_BOOTSTRAP_WINDOW_SIZE})`,
      );
      lastProviderError = null;
      await notifySessionState('capturing');
      await persistRuntimeState();
      return { success: true };
    }

    await notifySessionState('structuring');
    const structurerRun = createStructurerRunDebug({
      sessionId: currentSession!.sessionId,
      sequence: chunkIndex,
      transcript,
      transcriptWindow,
      previousGraph: mergedGraph,
    });

    let segment: SegmentGraph;
    try {
      segment = await structurerProvider.extractSegmentGraph({
        sessionId: currentSession!.sessionId,
        transcriptWindow,
        previousGraph: mergedGraph ?? undefined,
        language: 'zh',
      });
    } catch (error) {
      lastStructurerRun = finalizeStructurerRunDebug(structurerRun, {
        status: isTimeoutProviderError(error) ? 'timeout' : 'error',
        errorCode:
          error instanceof ProviderRequestError ? error.code : 'STRUCTURE_ERROR',
        errorMessage:
          error instanceof Error ? error.message : 'Structurer 请求失败',
      });
      throw error;
    }
    lastStructurerRun = null;
    segment = attachStructurerRunDebug(segment, finalizeStructurerRunDebug(structurerRun, {
      status: 'success',
      segmentId: segment.segmentId,
      topic: segment.topic,
      nodeCount: segment.nodes.length,
      edgeCount: segment.edges.length,
      fallbackUsed: segment.nodes.some((node) => node.id.endsWith(':fallback')),
    }));
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
  } catch (error) {
    if (currentSession && stoppingSessionId === currentSession.sessionId) {
      return { success: false, error: '会话停止中' };
    }

    lastProviderError = serializeProviderError(error);
    const message = lastProviderError.message;
    currentSession!.state = 'error';
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
    await notifyError('PROVIDER_CONFIG_ERROR', message);
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
  mergedGraph = payload.seed?.mergedGraph ?? null;
  chunkIndex = payload.seed?.chunkIndex ?? transcriptWindow.length;
  currentTimeMs =
    payload.seed?.currentTimeMs ??
    transcriptWindow[transcriptWindow.length - 1]?.endMs ??
    0;
  currentView = mergedGraph?.viewHints?.defaultView;
  currentViewPinned = false;
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
    const response = await processTranscriptChunk(transcript);
    if (!response.success) {
      return response;
    }
  }

  if (payload.finalizeSession ?? true) {
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
  const graph = await mergedGraphRepository.getBySession(payload.sessionId);

  if (!graph) {
    return { success: false, error: '缺少 graph 资产，无法导出' };
  }

  const exportData = buildSessionExport(
    {
      session,
      transcripts,
      graph,
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
        stripProviderRetryOverrides(storedConfig ?? activeProviderConfig),
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
  const fallbackConfig = stripProviderRetryOverrides(createDefaultProviderConfig());
  await settingsRepository.saveProviderConfig(fallbackConfig);
  applyProviderRuntime(fallbackConfig);
  await persistRuntimeState();
  return { success: true };
}

async function loadDebugSessionData(sessionId: string): Promise<DebugSessionData> {
  const session = (await sessionRepository.get(sessionId)) as SessionRecord | undefined;
  const transcripts = await transcriptChunkRepository.listBySession(sessionId);
  const segments = await segmentGraphRepository.listBySession(sessionId);
  const graph = await mergedGraphRepository.getBySession(sessionId);

    return {
      session: session ?? null,
      transcripts,
      segments,
    traces: buildDebugChunkTraces(
      transcripts,
      segments,
      getStructurerRunsForDebugSession(sessionId, segments),
    ),
    graph: graph ?? null,
    providerSummary,
    lastProviderError,
    structurerRuns: getStructurerRunsForDebugSession(sessionId, segments),
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
  const graph = await mergedGraphRepository.getBySession(sessionId);
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

function pushTranscript(transcript: TranscriptChunk) {
  chunkIndex += 1;
  transcriptWindow = [...transcriptWindow, transcript].slice(-3);
}

function buildMergedGraph(segment: SegmentGraph): MergedGraph {
  return buildMergedGraphFromState(mergedGraph, segment);
}

function buildMergedGraphFromState(
  previousGraph: MergedGraph | null,
  segment: SegmentGraph,
): MergedGraph {
  const baseGraph =
    previousGraph === null
      ? {
          sessionId: segment.sessionId,
          revision: 1,
          topics: segment.topic
            ? [
                {
                  topicId: generateId('topic'),
                  title: segment.topic,
                  startMs: segment.startMs,
                  endMs: segment.endMs,
                },
              ]
            : [],
          nodes: segment.nodes,
          edges: segment.edges,
          updatedAt: Date.now(),
        }
      : mergeSegmentGraph(mergeTopics(previousGraph, segment), segment);

  const stabilizedGraph = stabilizeGraph(baseGraph);
  const scores = scoreViews(stabilizedGraph);
  const defaultView = pickDefaultView(stabilizedGraph);

  return {
    ...stabilizedGraph,
    topics: mergeTopics(stabilizedGraph, segment).topics,
    viewHints: {
      defaultView,
      scores,
    },
    updatedAt: Date.now(),
  };
}

function buildDebugChunkTraces(
  transcripts: TranscriptChunk[],
  segments: SegmentGraph[],
  structurerRuns: StructurerRunDebug[],
): DebugSessionData['traces'] {
  const remainingSegments = [...segments].sort(
    (a, b) => a.startMs - b.startMs || a.endMs - b.endMs,
  );
  const remainingRuns = [...structurerRuns].sort(
    (a, b) => a.transcriptEndMs - b.transcriptEndMs || a.startedAt - b.startedAt,
  );
  let mergedAfter: MergedGraph | null = null;

  return transcripts.map((transcript, index) => {
    const transcriptWindow = transcripts.slice(Math.max(0, index - 2), index + 1);
    const matchedSegmentIndex = remainingSegments.findIndex(
      (segment) =>
        segment.endMs === transcript.endMs,
    );
    const segment =
      matchedSegmentIndex >= 0
        ? remainingSegments.splice(matchedSegmentIndex, 1)[0]
        : null;
    const matchedRunIndex = remainingRuns.findIndex(
      (run) => run.transcriptEndMs === transcript.endMs,
    );
    const structurerRun =
      matchedRunIndex >= 0
        ? remainingRuns.splice(matchedRunIndex, 1)[0]
        : null;

    if (segment) {
      mergedAfter = buildMergedGraphFromState(mergedAfter, segment);
    }

    return {
      sequence: index + 1,
      transcript,
      transcriptWindow,
      segment,
      structurerRun,
      mergedGraphAfter: mergedAfter,
    };
  });
}

function mergeTopics(graph: MergedGraph, segment: SegmentGraph): MergedGraph {
  const hasSameTopic =
    segment.topic &&
    graph.topics.some((topic) => topic.title === segment.topic);

  if (!segment.topic || hasSameTopic) {
    return {
      ...graph,
      topics: graph.topics.map((topic, index) =>
        index === graph.topics.length - 1
          ? { ...topic, endMs: Math.max(topic.endMs, segment.endMs) }
          : topic,
      ),
    };
  }

  return {
    ...graph,
    topics: [
      ...graph.topics,
      {
        topicId: generateId('topic'),
        title: segment.topic,
        startMs: segment.startMs,
        endMs: segment.endMs,
      },
    ],
  };
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
        mergedGraph = state.mergedGraph;
        chunkIndex = state.chunkIndex ?? 0;
        currentTimeMs = state.currentTimeMs ?? 0;
        currentView = state.currentView;
        currentViewPinned = state.currentViewPinned ?? false;
        pendingSessionFinalize = state.pendingSessionFinalize ?? null;
        providerSummary = state.providerSummary ?? providerSummary;
        lastProviderError = state.lastProviderError ?? null;
        lastStructurerRun = state.lastStructurerRun ?? null;
      } else {
        const latestSession = (await sessionRepository.listRecent()).find(
          (session) => typeof session.endedAt === 'number',
        );
        if (latestSession) {
          const recoveredChunks = await transcriptChunkRepository.listBySession(
            latestSession.sessionId,
          );
          const recoveredGraph = await mergedGraphRepository.getBySession(
            latestSession.sessionId,
          );

          recoveredSessionId = latestSession.sessionId;
          transcriptWindow = recoveredChunks.slice(-3);
          mergedGraph = recoveredGraph ?? null;
          chunkIndex = recoveredChunks.length;
          currentTimeMs = recoveredChunks[recoveredChunks.length - 1]?.endMs ?? 0;
          currentView = recoveredGraph?.viewHints?.defaultView;
          currentViewPinned = false;
          lastStructurerRun = null;
        }
      }
      try {
        await loadProviderRuntimeFromSettings();
      } catch (error) {
        console.warn('[Service Worker] provider 配置恢复失败，回退默认 mock:', error);
        applyProviderRuntime(createDefaultProviderConfig());
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
        mergedGraph,
        chunkIndex,
        currentTimeMs,
        currentView,
        currentViewPinned,
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
    mergedGraph = null;
    chunkIndex = 0;
    currentTimeMs = 0;
    currentView = undefined;
    currentViewPinned = false;
    lastStructurerRun = null;
    if (pendingSessionFinalize) {
      await persistRuntimeState();
    } else {
      await clearRuntimeState();
    }

    await broadcastToSidepanel({
      type: 'SESSION_STATE_CHANGED',
      target: 'sidepanel',
      payload,
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
      chunkIndex === 0 &&
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
    workerBuild: BUILD_INFO,
  };
}

function createStructurerRunDebug(params: {
  sessionId: string;
  sequence: number;
  transcript: TranscriptChunk;
  transcriptWindow: TranscriptChunk[];
  previousGraph: MergedGraph | null;
}): Omit<StructurerRunDebug, 'completedAt' | 'durationMs' | 'status'> {
  return {
    sessionId: params.sessionId,
    sequence: params.sequence,
    mode: params.previousGraph ? 'incremental' : 'bootstrap',
    transcriptEndMs: params.transcript.endMs,
    latestChunkId: params.transcript.chunkId,
    windowStartMs: params.transcriptWindow[0]?.startMs ?? params.transcript.startMs,
    windowEndMs:
      params.transcriptWindow[params.transcriptWindow.length - 1]?.endMs ?? params.transcript.endMs,
    windowChunkCount: params.transcriptWindow.length,
    windowCharCount: params.transcriptWindow.reduce((sum, chunk) => sum + chunk.text.length, 0),
    latestChunkCharCount: params.transcript.text.length,
    recentNodeCount: params.previousGraph?.nodes.length ?? 0,
    recentEdgeCount: params.previousGraph?.edges.length ?? 0,
    startedAt: Date.now(),
  };
}

function finalizeStructurerRunDebug(
  run: Omit<StructurerRunDebug, 'completedAt' | 'durationMs' | 'status'>,
  result: Pick<
    StructurerRunDebug,
    'status' | 'segmentId' | 'topic' | 'nodeCount' | 'edgeCount' | 'fallbackUsed' | 'errorCode' | 'errorMessage'
  >,
): StructurerRunDebug {
  const completedAt = Date.now();
  return {
    ...run,
    ...result,
    completedAt,
    durationMs: completedAt - run.startedAt,
  };
}

function attachStructurerRunDebug(segment: SegmentGraph, run: StructurerRunDebug): SegmentGraph {
  return {
    ...segment,
    raw: {
      providerResponse: segment.raw,
      debug: run,
    },
  };
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

function readStructurerRunDebug(segment: SegmentGraph): StructurerRunDebug | null {
  if (!segment.raw || typeof segment.raw !== 'object') {
    return null;
  }

  const debug = (segment.raw as { debug?: StructurerRunDebug }).debug;
  return debug ?? null;
}

function isTimeoutProviderError(error: unknown) {
  return error instanceof ProviderRequestError && error.code === 'TIMEOUT_ERROR';
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
) {
  await broadcastToSidepanel({
    type: 'PROVIDER_PROGRESS',
    target: 'sidepanel',
    payload: { stage, message },
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
  const sanitizedStoredConfig = storedConfig
    ? stripProviderRetryOverrides(storedConfig)
    : undefined;
  applyProviderRuntime(
    constrainProviderConfigToDirectMode(
      normalizeProviderConfig(sanitizedStoredConfig ?? createDefaultProviderConfig()),
    ),
  );

  if (storedConfig && sanitizedStoredConfig && hasProviderRetryOverrides(storedConfig)) {
    await settingsRepository.saveProviderConfig(sanitizedStoredConfig);
  }
}

function applyProviderRuntime(config: Partial<ProviderConfig> | ProviderConfig) {
  const runtime = providerRegistry.createRuntimeProviders(config);
  commitProviderRuntime(runtime);
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

function serializeProviderError(error: unknown): SerializableProviderError {
  if (error instanceof ProviderRequestError) {
    return sanitizeProviderError(error.toJSON());
  }

  const stage =
    currentSession?.state === 'structuring' || lastStructurerRun ? 'structurer' : 'asr';
  const provider =
    stage === 'structurer'
      ? structurerProvider?.name ?? 'unknown-provider'
      : asrProvider?.name ?? 'unknown-provider';
  const code = stage === 'structurer' ? 'STRUCTURE_ERROR' : 'TRANSCRIBE_ERROR';

  return sanitizeProviderError({
    code,
    message:
      error instanceof Error ? error.message : 'Provider 请求发生未知错误',
    provider,
    stage,
    retriable: false,
  });
}

function mergeProviderSecrets(
  nextConfig: ProviderConfig,
  existingConfig?: ProviderConfig,
): ProviderConfig {
  if (!existingConfig) {
    return nextConfig;
  }

  return {
    asr: {
      ...nextConfig.asr,
      apiKey:
        nextConfig.asr.apiKey ??
        (nextConfig.asr.type === existingConfig.asr.type ? existingConfig.asr.apiKey : undefined),
      sessionToken:
        nextConfig.asr.sessionToken ??
        (nextConfig.asr.type === existingConfig.asr.type &&
        nextConfig.asr.mode === existingConfig.asr.mode
          ? existingConfig.asr.sessionToken
          : undefined),
      secretId:
        nextConfig.asr.secretId ??
        (nextConfig.asr.type === existingConfig.asr.type &&
        nextConfig.asr.type === 'tencent' &&
        nextConfig.asr.mode === 'direct'
          ? existingConfig.asr.secretId
          : undefined),
      secretKey:
        nextConfig.asr.secretKey ??
        (nextConfig.asr.type === existingConfig.asr.type &&
        nextConfig.asr.type === 'tencent' &&
        nextConfig.asr.mode === 'direct'
          ? existingConfig.asr.secretKey
          : undefined),
    },
    structurer: {
      ...nextConfig.structurer,
      apiKey:
        nextConfig.structurer.apiKey ??
        (nextConfig.structurer.type === existingConfig.structurer.type
          ? existingConfig.structurer.apiKey
          : undefined),
      sessionToken:
        nextConfig.structurer.sessionToken ??
        (nextConfig.structurer.type === existingConfig.structurer.type &&
        nextConfig.structurer.mode === existingConfig.structurer.mode
          ? existingConfig.structurer.sessionToken
          : undefined),
    },
  };
}

function constrainProviderConfigToDirectMode(config: ProviderConfig): ProviderConfig {
  return {
    asr: {
      ...config.asr,
      mode: 'direct',
      sessionToken: undefined,
    },
    structurer: {
      ...config.structurer,
      mode: 'direct',
      sessionToken: undefined,
    },
  };
}

function stripProviderRetryOverrides(config: ProviderConfig): ProviderConfig {
  return {
    asr: {
      ...config.asr,
      retry: undefined,
    },
    structurer: {
      ...config.structurer,
      retry: undefined,
    },
  };
}

function hasProviderRetryOverrides(config: Partial<ProviderConfig> | null | undefined) {
  return Boolean(config?.asr?.retry || config?.structurer?.retry);
}

function stripProviderSecrets(config: ProviderConfig): ProviderConfig {
  return {
    asr: {
      ...config.asr,
      apiKey: undefined,
      sessionToken: undefined,
      secretId: undefined,
      secretKey: undefined,
    },
    structurer: {
      ...config.structurer,
      apiKey: undefined,
      sessionToken: undefined,
    },
  };
}

function sanitizeProviderError(error: SerializableProviderError): SerializableProviderError {
  return {
    ...error,
    message: error.message || 'Provider request failed',
  };
}
