// runtime-snapshot.ts — 运行时快照与广播
// 从 index.ts 提取：getRuntimeSnapshot、getRuntimeSnapshotForSidepanel、
// getPendingTranscriptCount、getPendingWorkCount、getStopDrainPendingCount、
// getStructurerRunsForDebugSession、getSerializeErrorFallback、
// notifyError、notifyProviderProgress、broadcastToSidepanel、notifySessionState

import type {
  MergedGraph,
  SegmentGraph,
} from '@listen-graphic/schema';
import type {
  AssemblerRunDebug,
  AppMessage,
  RuntimeSnapshot,
  SessionState,
  StructurerRunDebug,
  StructureUnitDebug,
} from '../shared/messages';
import { BUILD_INFO } from '../shared/build-info';
import { readStructurerRunDebug } from './debug-trace';
import type { RuntimeStateContainer } from './runtime-state';
import {
  getTranscriptWindowDurationMs,
  getTranscriptWindowCharCount,
  getEffectiveTranscriptWindowCharCount,
  getNormalizedTranscriptCharCount,
  getEffectiveTranscriptCharCount,
} from './assembler-decision';
import {
  STRUCTURER_WINDOW_SIZE,
  STRUCTURER_BOOTSTRAP_MIN_DURATION_MS,
  STRUCTURER_BOOTSTRAP_MIN_CHAR_COUNT,
  STRUCTURE_UNIT_ASSEMBLER_ENABLED,
} from './assembler-types';
import type { SerializeErrorFallbackContext } from './provider-config';

export function getPendingTranscriptCount(S: RuntimeStateContainer) {
  return Math.max(
    S.pendingTranscriptWorkCount - (S.inFlightTranscriptPromise ? 1 : 0),
    0,
  );
}

export function getPendingWorkCount(S: RuntimeStateContainer) {
  return S.pendingChunkWorkCount + S.pendingTranscriptWorkCount;
}

export function getStopDrainPendingCount(S: RuntimeStateContainer) {
  return S.stoppingSessionId ? getPendingWorkCount(S) : 0;
}

export function getRuntimeSnapshot(S: RuntimeStateContainer): RuntimeSnapshot {
  return {
    sessionId: S.currentSession?.sessionId ?? S.recoveredSessionId,
    state:
      S.currentSession?.state ??
      (S.recoveredSessionId || S.mergedGraph || S.transcriptWindow.length > 0
        ? 'stopped'
        : 'idle'),
    graph: S.mergedGraph,
    currentTimeMs: S.currentTimeMs,
    currentView: S.currentView ?? S.mergedGraph?.viewHints?.defaultView,
    currentViewPinned: S.currentViewPinned,
    providerSummary: S.providerSummary,
    lastProviderError: S.lastProviderError,
    lastStructurerRun: S.lastStructurerRun,
    structuringSince: S.structuringSince,
    lastTranscriptAt: S.lastTranscriptAt,
    lastGraphUpdatedAt: S.lastGraphUpdatedAt,
    pendingTranscriptCount: getPendingTranscriptCount(S),
    pendingWorkCount: getPendingWorkCount(S),
    stopDrainPendingCount: getStopDrainPendingCount(S),
    currentStructurerTarget: S.currentStructurerTarget,
    currentAssemblerState: S.pendingStructureBuffer
      ? {
          enabled: true,
          pendingUtteranceCount: S.pendingStructureBuffer.utterances.length,
          pendingEffectiveCharCount: S.pendingStructureBuffer.effectiveChars,
          pendingWaitMs: Math.max(0, Date.now() - S.pendingStructureBuffer.startedAt),
          pendingPreview: S.pendingStructureBuffer.utterances
            .map((item) => item.text.trim())
            .filter(Boolean)
            .join(' ')
            .slice(0, 96),
        }
      : {
          enabled: shouldHandleWithStructureUnitAssembler(S),
          pendingUtteranceCount: 0,
          pendingEffectiveCharCount: 0,
          pendingWaitMs: 0,
          pendingPreview: '',
        },
    workerBuild: BUILD_INFO,
  };
}

function shouldHandleWithStructureUnitAssembler(S: RuntimeStateContainer) {
  const transport = S.activeProviderConfig.asr.transport === 'ws' ? 'ws' : 'batch';
  return (
    STRUCTURE_UNIT_ASSEMBLER_ENABLED &&
    transport === 'ws'
  );
}

export async function getRuntimeSnapshotForSidepanel(
  S: RuntimeStateContainer,
  lastStoppedSessionKey: string,
): Promise<RuntimeSnapshot> {
  const base = getRuntimeSnapshot(S);
  if (base.graph != null || base.sessionId != null) {
    return base;
  }

  try {
    const storageArea = chrome.storage.session ?? chrome.storage.local;
    const raw = await storageArea.get(lastStoppedSessionKey);
    type LastStoppedSessionPayload = {
      sessionId: string;
      mergedGraph: MergedGraph;
      currentTimeMs: number;
      currentView: RuntimeSnapshot['currentView'];
      currentViewPinned: boolean;
    };
    const last = raw?.[lastStoppedSessionKey] as LastStoppedSessionPayload | undefined;
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

export function getStructurerRunsForDebugSession(
  sessionId: string,
  segments: SegmentGraph[],
  S: RuntimeStateContainer,
): StructurerRunDebug[] {
  const successfulRuns = segments
    .map((segment) => readStructurerRunDebug(segment))
    .filter((run): run is StructurerRunDebug => Boolean(run))
    .filter((run) => run.sessionId === sessionId);

  if (S.lastStructurerRun && S.lastStructurerRun.sessionId === sessionId) {
    return [...successfulRuns, S.lastStructurerRun].sort(
      (a, b) => a.transcriptEndMs - b.transcriptEndMs || a.startedAt - b.startedAt,
    );
  }

  return successfulRuns.sort(
    (a, b) => a.transcriptEndMs - b.transcriptEndMs || a.startedAt - b.startedAt,
  );
}

export function getSerializeErrorFallback(S: RuntimeStateContainer): SerializeErrorFallbackContext {
  const stage = S.currentSession?.state === 'structuring' || S.lastStructurerRun ? 'structurer' as const : 'asr' as const;
  const providerName = stage === 'structurer'
    ? S.structurerProvider?.name ?? 'unknown-provider'
    : S.asrProvider?.name ?? 'unknown-provider';
  return { stage, providerName };
}

export async function notifyError(code: string, message: string) {
  await broadcastToSidepanel({
    type: 'ERROR',
    target: 'sidepanel',
    payload: { code, message },
  });
}

export async function notifyProviderProgress(
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

export async function broadcastToSidepanel(message: AppMessage): Promise<void> {
  try {
    await chrome.runtime.sendMessage(message);
  } catch (error) {
    console.debug('[Service Worker] sidepanel 未打开，忽略广播失败:', error);
  }
}

export async function notifySessionState(
  state: SessionState,
  S: RuntimeStateContainer,
) {
  if (S.currentSession) {
    S.currentSession.state = state;
  }

  await broadcastToSidepanel({
    type: 'SESSION_STATE_CHANGED',
    target: 'sidepanel',
    payload: {
      sessionId: S.currentSession?.sessionId ?? null,
      state,
      pendingTranscriptCount: getPendingTranscriptCount(S),
      pendingWorkCount: getPendingWorkCount(S),
      stopDrainPendingCount: getStopDrainPendingCount(S),
      currentStructurerTarget: S.currentStructurerTarget,
    },
  });
}
