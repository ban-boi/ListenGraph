// session-handlers.ts — 会话相关消息处理器
// 从 index.ts 提取：handleNodeClicked、handleViewSelected、handleExportSession、
// handleGetDebugSession、loadDebugSessionData、handleGetReplaySession、
// loadReplaySessionData、handleTestStructurerSessionRun、persistInjectedStructurerSeed

import type {
  MergedGraph,
  TranscriptChunk,
} from '@listen-graphic/schema';
import type {
  AppMessage,
  AssemblerRunDebug,
  DebugSessionData,
  ExportFormat,
  ReplaySessionData,
  RuntimeSnapshot,
  StructureUnitDebug,
  StructurerInjectionSeed,
} from '../shared/messages';
import { generateId } from '@listen-graphic/shared-utils';
import type { SessionRecord } from '@listen-graphic/storage';
import { createProviderConfigError } from './provider-config';
import { buildDebugTranscriptTraces } from './graph-building';
import type { RuntimeStateContainer } from './runtime-state';
import {
  notifyError,
  broadcastToSidepanel,
  getStructurerRunsForDebugSession,
} from './runtime-snapshot';
import {
  withIndexedDbRetry,
  isIndexedDbBackingStoreError,
  loadAssemblerTrace,
} from './state-persistence';
import { getAssemblerRunsForDebugSession, getStructureUnitsForDebugSession } from './assembler-machine';
import type { ServiceWorkerResponse } from './sw-types';

async function getAssemblerTraceForSession(
  sessionId: string,
  S: RuntimeStateContainer,
): Promise<{ assemblerRuns: AssemblerRunDebug[]; structureUnits: StructureUnitDebug[] }> {
  let assemblerRuns = getAssemblerRunsForDebugSession(sessionId, S);
  let structureUnits = getStructureUnitsForDebugSession(sessionId, S);

  if (assemblerRuns.length === 0 && structureUnits.length === 0) {
    const persisted = await loadAssemblerTrace(sessionId);
    if (persisted) {
      assemblerRuns = persisted.assemblerRuns as AssemblerRunDebug[];
      structureUnits = persisted.structureUnits as StructureUnitDebug[];
    }
  }

  return { assemblerRuns, structureUnits };
}

export async function handleNodeClicked(
  payload: {
    sessionId: string;
    nodeId: string;
    timestampMs: number;
  },
  S: RuntimeStateContainer,
  ensureHydrated: () => Promise<void>,
  persistRuntimeState: () => Promise<void>,
): Promise<ServiceWorkerResponse> {
  await ensureHydrated();

  if (!S.currentSession || S.currentSession.sessionId !== payload.sessionId) {
    return { success: false, error: '当前没有可跳转的活动会话' };
  }

  try {
    const response = await chrome.tabs.sendMessage(S.currentSession.tabId, {
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
    S.currentTimeMs = payload.timestampMs;
    await persistRuntimeState();

    return { success: true };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : '播放器跳转失败';
    await notifyError('SEEK_ERROR', message);
    return { success: false, error: message };
  }
}

export async function handleViewSelected(
  payload: {
    sessionId: string;
    view: RuntimeSnapshot['currentView'];
  },
  S: RuntimeStateContainer,
  ensureHydrated: () => Promise<void>,
  persistRuntimeState: () => Promise<void>,
): Promise<ServiceWorkerResponse> {
  await ensureHydrated();

  if (!S.currentSession || S.currentSession.sessionId !== payload.sessionId) {
    return { success: false, error: '当前没有可记录视图的活动会话' };
  }

  S.currentView = payload.view;
  S.currentViewPinned = true;
  await persistRuntimeState();
  return { success: true };
}

export async function handleExportSession(
  payload: {
    sessionId: string;
    format: ExportFormat;
  },
  S: RuntimeStateContainer,
  deps: {
    ensureHydrated: () => Promise<void>;
    sessionRepository: {
      get(sessionId: string): Promise<SessionRecord | undefined>;
    };
    transcriptChunkRepository: {
      listBySession(sessionId: string): Promise<TranscriptChunk[]>;
    };
    loadMergedGraphAsset: (sessionId: string) => Promise<MergedGraph | null>;
    buildSessionExport: (data: any, format: ExportFormat) => { filename: string; mimeType: string; content: string };
  },
): Promise<ServiceWorkerResponse> {
  await deps.ensureHydrated();

  if (
    S.currentSession &&
    S.currentSession.sessionId === payload.sessionId &&
    (S.currentSession.state !== 'capturing' || S.inFlightChunkPromise)
  ) {
    return { success: false, error: '当前会话仍在处理中，请稍后导出' };
  }

  const session = (await deps.sessionRepository.get(payload.sessionId)) as
    | SessionRecord
    | undefined;
  const transcripts = await deps.transcriptChunkRepository.listBySession(payload.sessionId);
  const graph = await deps.loadMergedGraphAsset(payload.sessionId);

  if (!graph) {
    return { success: false, error: '缺少 graph 资产，无法导出' };
  }

  const trace = await getAssemblerTraceForSession(payload.sessionId, S);

  const exportData = deps.buildSessionExport(
    {
      session,
      transcripts,
      graph,
      assemblerRuns: trace.assemblerRuns,
      structureUnits: trace.structureUnits,
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

export async function handleGetDebugSession(
  sessionId: string,
  S: RuntimeStateContainer,
  deps: {
    ensureHydrated: () => Promise<void>;
    sessionRepository: { get(sessionId: string): Promise<SessionRecord | undefined> };
    transcriptChunkRepository: { listBySession(sessionId: string): Promise<TranscriptChunk[]> };
    segmentGraphRepository: { listBySession(sessionId: string): Promise<any[]> };
    loadMergedGraphAsset: (sessionId: string, preloadedSegments?: any[]) => Promise<MergedGraph | null>;
  },
): Promise<ServiceWorkerResponse> {
  await deps.ensureHydrated();

  const debugData = await loadDebugSessionData(sessionId, S, deps);
  return {
    success: true,
    debugData,
  } as ServiceWorkerResponse & { debugData: DebugSessionData };
}

export async function loadDebugSessionData(
  sessionId: string,
  S: RuntimeStateContainer,
  deps: {
    sessionRepository: { get(sessionId: string): Promise<SessionRecord | undefined> };
    transcriptChunkRepository: { listBySession(sessionId: string): Promise<TranscriptChunk[]> };
    segmentGraphRepository: { listBySession(sessionId: string): Promise<any[]> };
    loadMergedGraphAsset: (sessionId: string, preloadedSegments?: any[]) => Promise<MergedGraph | null>;
  },
): Promise<DebugSessionData> {
  const session = (await deps.sessionRepository.get(sessionId)) as SessionRecord | undefined;
  const transcripts = await deps.transcriptChunkRepository.listBySession(sessionId);
  const segments = await deps.segmentGraphRepository.listBySession(sessionId);
  const graph = await deps.loadMergedGraphAsset(sessionId, segments);
  const sessionStructurerRuns = getStructurerRunsForDebugSession(sessionId, segments, S);
  const { assemblerRuns: sessionAssemblerRuns, structureUnits: sessionStructureUnits } =
    await getAssemblerTraceForSession(sessionId, S);

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
    providerSummary: S.providerSummary,
    lastProviderError: S.lastProviderError,
    structurerRuns: sessionStructurerRuns,
    assemblerRuns: sessionAssemblerRuns,
    structureUnits: sessionStructureUnits,
  };
}

export async function handleGetReplaySession(
  sessionId: string,
  deps: {
    ensureHydrated: () => Promise<void>;
    sessionRepository: { get(sessionId: string): Promise<SessionRecord | undefined> };
    transcriptChunkRepository: { listBySession(sessionId: string): Promise<TranscriptChunk[]> };
    loadMergedGraphAsset: (sessionId: string) => Promise<MergedGraph | null>;
  },
): Promise<ServiceWorkerResponse> {
  await deps.ensureHydrated();

  const replayData = await loadReplaySessionData(sessionId, deps);
  return {
    success: true,
    replayData,
  } as ServiceWorkerResponse & { replayData: ReplaySessionData };
}

export async function loadReplaySessionData(
  sessionId: string,
  deps: {
    sessionRepository: { get(sessionId: string): Promise<SessionRecord | undefined> };
    transcriptChunkRepository: { listBySession(sessionId: string): Promise<TranscriptChunk[]> };
    loadMergedGraphAsset: (sessionId: string) => Promise<MergedGraph | null>;
  },
): Promise<ReplaySessionData> {
  const session = (await deps.sessionRepository.get(sessionId)) as SessionRecord | undefined;
  const transcripts = await deps.transcriptChunkRepository.listBySession(sessionId);
  const graph = await deps.loadMergedGraphAsset(sessionId);
  const transcriptDuration = transcripts[transcripts.length - 1]?.endMs ?? 0;
  const graphDuration = Math.max(...(graph?.nodes.map((node) => node.timestampMs) ?? [0]));

  return {
    session: session ?? null,
    transcripts,
    graph: graph ?? null,
    durationMs: Math.max(transcriptDuration, graphDuration),
  };
}

export async function handleTestStructurerSessionRun(
  payload: {
    seed?: StructurerInjectionSeed;
    transcripts: TranscriptChunk[];
    finalizeSession?: boolean;
  },
  S: RuntimeStateContainer,
  callbacks: {
    ensureHydrated: () => Promise<void>;
    loadProviderRuntimeFromSettings: () => Promise<void>;
    notifyError: (code: string, message: string) => Promise<void>;
    persistRuntimeState: () => Promise<void>;
    resetAssemblerState: () => void;
    withIndexedDbRetry: <T>(op: () => Promise<T>) => Promise<T>;
    sessionRepository: { save(record: any): Promise<void> };
    persistInjectedStructurerSeed: (params: {
      sessionId: string;
      transcriptWindow: TranscriptChunk[];
      mergedGraph: MergedGraph | null;
    }) => Promise<void>;
    notifySessionState: (state: any) => Promise<void>;
    enqueueTranscriptProcessing: (work: () => Promise<ServiceWorkerResponse>) => Promise<ServiceWorkerResponse>;
    processTranscriptChunk: (chunk: TranscriptChunk) => Promise<ServiceWorkerResponse>;
    flushPendingStructureBuffer: (reason: any) => Promise<ServiceWorkerResponse | null>;
    cleanupSession: (payload: { sessionId: string; state: any }) => Promise<void>;
  },
): Promise<ServiceWorkerResponse> {
  if (!payload.transcripts.length) {
    return { success: false, error: '缺少 transcripts，无法执行 structure-focused 测试' };
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

  const sessionId = payload.seed?.sessionId ?? generateId('session');
  const sourceType = payload.seed?.sourceType ?? 'file';

  S.currentSession = {
    sessionId,
    tabId: -1,
    state: 'capturing',
  };
  S.recoveredSessionId = null;
  S.transcriptWindow = [...(payload.seed?.transcriptWindow ?? [])];
  callbacks.resetAssemblerState();
  S.mergedGraph = payload.seed?.mergedGraph ?? null;
  S.transcriptSequence =
    payload.seed?.transcriptSequence ??
    payload.seed?.chunkIndex ??
    S.transcriptWindow.length;
  S.currentTimeMs =
    payload.seed?.currentTimeMs ??
    S.transcriptWindow[S.transcriptWindow.length - 1]?.endMs ??
    0;
  S.currentView = S.mergedGraph?.viewHints?.defaultView;
  S.currentViewPinned = false;
  S.structuringSince = null;
  S.lastTranscriptAt = null;
  S.lastGraphUpdatedAt = null;
  S.pendingChunkWorkCount = 0;
  S.pendingTranscriptWorkCount = 0;
  S.currentStructurerTarget = null;
  S.pendingSessionFinalize = null;
  S.stoppingSessionId = null;
  S.asrProvider.reset?.();
  S.structurerProvider.reset?.();

  await callbacks.withIndexedDbRetry(() =>
    callbacks.sessionRepository.save({
      sessionId,
      sourceType,
      createdAt: Date.now(),
    }),
  );
  await callbacks.persistInjectedStructurerSeed({
    sessionId,
    transcriptWindow: S.transcriptWindow,
    mergedGraph: S.mergedGraph,
  });
  await callbacks.notifySessionState('capturing');

  for (const nextTranscript of payload.transcripts) {
    const transcript: TranscriptChunk = {
      ...nextTranscript,
      sessionId,
    };
    const response = await callbacks.enqueueTranscriptProcessing(() =>
      callbacks.processTranscriptChunk(transcript),
    );
    if (!response.success) {
      return response;
    }
  }

  if (payload.finalizeSession ?? true) {
    const flushResponse = await callbacks.flushPendingStructureBuffer('commit_force_flush');
    if (flushResponse && !flushResponse.success) {
      return flushResponse;
    }
    await callbacks.cleanupSession({
      sessionId,
      state: 'stopped',
    });
  }

  return { success: true, sessionId };
}

export async function persistInjectedStructurerSeed(
  params: {
    sessionId: string;
    transcriptWindow: TranscriptChunk[];
    mergedGraph: MergedGraph | null;
  },
  deps: {
    transcriptChunkRepository: { append(chunk: TranscriptChunk): Promise<void> };
    mergedGraphRepository: { save(graph: MergedGraph): Promise<void> };
    withIndexedDbRetry: <T>(op: () => Promise<T>) => Promise<T>;
  },
) {
  for (const transcript of params.transcriptWindow) {
    try {
      await deps.withIndexedDbRetry(() => deps.transcriptChunkRepository.append(transcript));
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
    await deps.withIndexedDbRetry(() => deps.mergedGraphRepository.save(params.mergedGraph!));
  } catch (error) {
    if (!isIndexedDbBackingStoreError(error)) {
      throw error;
    }
    console.warn('[Service Worker] seed merged graph 持久化暂不可用，保留内存态结果:', error);
  }
}
