// structurer-executor.ts — 结构化执行器
// 从 index.ts 提取：runStructurerForTranscriptContext、loadMergedGraphAsset、buildMergedGraph

import { pickDefaultView } from '@listen-graphic/domain';
import type {
  MergedGraph,
  SegmentGraph,
  TranscriptChunk,
} from '@listen-graphic/schema';
import type { AppMessage } from '../shared/messages';
import {
  createStructurerRunDebug,
  finalizeStructurerRunDebug,
  attachStructurerRunDebug,
} from './debug-trace';
import { buildMergedGraphFromState } from './graph-building';
import type { RuntimeStateContainer } from './runtime-state';
import {
  ProviderRequestError,
} from '@listen-graphic/providers';
import {
  isTimeoutProviderError,
  isSerializableProviderRequestError,
  serializeProviderError,
} from './provider-config';
import {
  withIndexedDbRetry,
  isIndexedDbBackingStoreError,
} from './state-persistence';
import {
  broadcastToSidepanel,
  notifyProviderProgress,
  notifySessionState,
  getSerializeErrorFallback,
} from './runtime-snapshot';
import { expandSegmentEvidenceChunkIds } from './assembler-decision';
import type { ServiceWorkerResponse } from './sw-types';

export interface StructurerExecutorDeps {
  segmentGraphRepository: {
    append(segment: SegmentGraph): Promise<void>;
    listBySession(sessionId: string): Promise<SegmentGraph[]>;
  };
  mergedGraphRepository: {
    save(graph: MergedGraph): Promise<void>;
    getBySession(sessionId: string): Promise<MergedGraph | null | undefined>;
  };
}

export async function runStructurerForTranscriptContext(
  params: {
    chunkSessionId: string;
    transcript: TranscriptChunk;
    structurerWindow: TranscriptChunk[];
    evidenceChunkIds?: string[];
  },
  S: RuntimeStateContainer,
  deps: StructurerExecutorDeps,
): Promise<ServiceWorkerResponse> {
  if (!S.currentSession) {
    return { success: false, error: '没有活动会话' };
  }
  await notifySessionState('structuring', S);
  const structurerRun = createStructurerRunDebug({
    sessionId: S.currentSession.sessionId,
    sequence: S.transcriptSequence,
    transcript: params.transcript,
    transcriptWindow: params.structurerWindow,
    previousGraph: S.mergedGraph,
  });
  S.structuringSince = structurerRun.startedAt;
  S.currentStructurerTarget = {
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
    segment = await S.structurerProvider.extractSegmentGraph({
      sessionId: S.currentSession.sessionId,
      transcriptWindow: params.structurerWindow,
      previousGraph: S.mergedGraph ?? undefined,
      language: 'zh',
    });
  } catch (error: unknown) {
    S.structuringSince = null;
    S.currentStructurerTarget = null;
    const providerShape = isSerializableProviderRequestError(error);
    S.lastStructurerRun = finalizeStructurerRunDebug(structurerRun, {
      status: isTimeoutProviderError(error) ? 'timeout' : 'error',
      errorCode:
        error instanceof ProviderRequestError
          ? error.code
          : providerShape
            ? (error as any).code
            : 'STRUCTURE_ERROR',
      errorMessage:
        error instanceof Error ? error.message : 'Structurer 请求失败',
      structurerDiagnostics:
        error instanceof ProviderRequestError
          ? error.structurerDiagnostics
          : providerShape
            ? (error as any).structurerDiagnostics
            : undefined,
    });
    await notifyProviderProgress(
      'structurer',
      `Structurer failed | ${S.lastStructurerRun.status} | ${S.lastStructurerRun.durationMs}ms | ${S.lastStructurerRun.errorCode ?? 'STRUCTURE_ERROR'}`,
    );
    throw error;
  }

  if (!S.currentSession || S.currentSession.sessionId !== params.chunkSessionId) {
    return { success: false, error: '会话已结束' };
  }

  if (params.evidenceChunkIds?.length) {
    segment = expandSegmentEvidenceChunkIds(
      segment,
      params.transcript.chunkId,
      params.evidenceChunkIds,
    );
  }

  S.structuringSince = null;
  S.currentStructurerTarget = null;
  S.lastStructurerRun = null;
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
    await withIndexedDbRetry(() => deps.segmentGraphRepository.append(segment));
  } catch (error) {
    if (!isIndexedDbBackingStoreError(error)) {
      throw error;
    }
    console.warn('[Service Worker] segment graph 持久化暂不可用，保留内存态结果:', error);
  }
  const nextMergedGraph = buildMergedGraphFromState(S.mergedGraph, segment);
  try {
    await withIndexedDbRetry(() => deps.mergedGraphRepository.save(nextMergedGraph));
  } catch (error) {
    if (!isIndexedDbBackingStoreError(error)) {
      throw error;
    }
    console.warn('[Service Worker] merged graph 持久化暂不可用，保留内存态结果:', error);
  }
  S.mergedGraph = nextMergedGraph;
  S.lastGraphUpdatedAt = Date.now();
  if (!S.currentViewPinned) {
    S.currentView = S.mergedGraph.viewHints?.defaultView ?? pickDefaultView(S.mergedGraph);
  }

  await broadcastToSidepanel({
    type: 'MERGED_GRAPH_UPDATED',
    target: 'sidepanel',
    payload: { graph: S.mergedGraph },
  });

  S.lastProviderError = null;
  await notifySessionState('capturing', S);
  return { success: true };
}

export async function loadMergedGraphAsset(
  sessionId: string,
  deps: StructurerExecutorDeps,
  preloadedSegments?: SegmentGraph[],
): Promise<MergedGraph | null> {
  const storedGraph = await deps.mergedGraphRepository.getBySession(sessionId);
  if (storedGraph) {
    return storedGraph;
  }

  const segments = [...(preloadedSegments ?? await deps.segmentGraphRepository.listBySession(sessionId))]
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
    await withIndexedDbRetry(() => deps.mergedGraphRepository.save(rebuiltGraph));
  } catch (error) {
    if (!isIndexedDbBackingStoreError(error)) {
      throw error;
    }
    console.warn('[Service Worker] rebuilt merged graph 持久化暂不可用，保留重建结果:', error);
  }

  return rebuiltGraph;
}
