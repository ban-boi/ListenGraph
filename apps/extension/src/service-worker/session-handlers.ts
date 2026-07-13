// session-handlers.ts — 会话相关消息处理器
// 从 index.ts 提取：handleNodeClicked、handleViewSelected、handleExportSession、
// handleGetDebugSession、loadDebugSessionData、handleGetReplaySession、
// loadReplaySessionData、handleTestStructurerSessionRun、persistInjectedStructurerSeed

import { mergedGraphSchema } from '@listen-graphic/graph-fixtures';
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

// ===== IDB 数据运行时校验 =====
// 仅检查结构上必需的标识字段，用于过滤 IDB 中的损坏/垃圾数据。
// 非完整的 schema 验证——这是 IDB 过滤的务实最低要求，而非 Zod 全量校验。

function isValidAssemblerRun(item: unknown): item is AssemblerRunDebug {
  if (typeof item !== 'object' || item === null) return false;
  const obj = item as Record<string, unknown>;
  return (
    typeof obj.sessionId === 'string' &&
    typeof obj.sequence === 'number' &&
    typeof obj.decision === 'string' &&
    typeof obj.reason === 'string'
  );
}

function isValidStructureUnit(item: unknown): item is StructureUnitDebug {
  if (typeof item !== 'object' || item === null) return false;
  const obj = item as Record<string, unknown>;
  return (
    typeof obj.unitId === 'string' &&
    typeof obj.sessionId === 'string' &&
    typeof obj.reason === 'string'
  );
}

export { isValidAssemblerRun, isValidStructureUnit };

/**
 * 校验 MergedGraph 的完整性。
 * 使用 graph-fixtures 的 mergedGraphSchema 做完整 schema 校验，
 * 再补引用完整性、ID 唯一性和空图规则。
 * 只排除损坏数据，不过滤小图或无边图。
 */
function validateMergedGraph(graph: unknown): MergedGraph | null {
  const parsed = mergedGraphSchema.safeParse(graph);
  if (!parsed.success) return null;

  const g = parsed.data;

  if (g.nodes.length === 0) return null;

  const nodeIds = g.nodes.map((n) => n.id);
  if (new Set(nodeIds).size !== nodeIds.length) return null;
  const edgeIds = g.edges.map((e) => e.id);
  if (new Set(edgeIds).size !== edgeIds.length) return null;

  const nodeIdSet = new Set(nodeIds);
  for (const edge of g.edges) {
    if (!nodeIdSet.has(edge.source) || !nodeIdSet.has(edge.target)) return null;
  }

  return g as MergedGraph;
}

export async function getAssemblerTraceForSession(
  sessionId: string,
  S: RuntimeStateContainer,
): Promise<{
  assemblerRuns: AssemblerRunDebug[];
  structureUnits: StructureUnitDebug[];
  traceSource: 'memory' | 'indexeddb' | 'empty';
}> {
  let assemblerRuns = getAssemblerRunsForDebugSession(sessionId, S);
  let structureUnits = getStructureUnitsForDebugSession(sessionId, S);

  if (assemblerRuns.length > 0 || structureUnits.length > 0) {
    return { assemblerRuns, structureUnits, traceSource: 'memory' };
  }

  const persisted = await loadAssemblerTrace(sessionId);
  if (persisted) {
    assemblerRuns = persisted.assemblerRuns.filter(isValidAssemblerRun);
    structureUnits = persisted.structureUnits.filter(isValidStructureUnit);
    return { assemblerRuns, structureUnits, traceSource: 'indexeddb' };
  }

  return { assemblerRuns, structureUnits, traceSource: 'empty' };
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

  const exportData = deps.buildSessionExport(
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

/**
 * 导出所有有效 MergedGraph 快照。
 * 只做 schema 校验，不过滤小图或无边图。
 * 按 sessionId 升序排列，保证确定性。
 */
export async function handleExportAllGraphs(
  deps: {
    ensureHydrated: () => Promise<void>;
    mergedGraphRepository: {
      listAll(): Promise<MergedGraph[]>;
    };
  },
): Promise<ServiceWorkerResponse> {
  await deps.ensureHydrated();

  const allGraphs = await deps.mergedGraphRepository.listAll();
  const validGraphs = allGraphs
    .map(validateMergedGraph)
    .filter((g): g is MergedGraph => g !== null)
    .sort((a, b) => a.sessionId.localeCompare(b.sessionId));

  if (validGraphs.length === 0) {
    return { success: false, error: '没有有效的 graph 数据可导出' };
  }

  const content = JSON.stringify(validGraphs, null, 2);
  const timestamp = new Date().toISOString().slice(0, 10);
  const filename = `graph-corpus-${timestamp}.json`;

  return {
    success: true,
    exportData: { filename, mimeType: 'application/json', content },
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
  const {
    assemblerRuns: sessionAssemblerRuns,
    structureUnits: sessionStructureUnits,
    traceSource,
  } = await getAssemblerTraceForSession(sessionId, S);

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
    traceSource,
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
