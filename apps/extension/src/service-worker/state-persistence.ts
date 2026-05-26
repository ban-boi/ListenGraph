// state-persistence.ts — 状态持久化与 hydration
// 从 index.ts 提取：getRuntimeStorageArea、ensureHydrated、rehydrateRuntimeState、
// persistRuntimeState、clearRuntimeState、withIndexedDbRetry、isIndexedDbBackingStoreError

import type { SessionRecord } from '@listen-graphic/storage';
import type {
  MergedGraph,
  SegmentGraph,
} from '@listen-graphic/schema';
import {
  createExtensionDefaultProviderConfig,
} from './provider-config';
import type { RuntimeStateContainer, PersistedRuntimeState } from './runtime-state';

export interface PersistenceDeps {
  S: RuntimeStateContainer;
  sessionRepository: {
    listRecent(): Promise<SessionRecord[]>;
  };
  transcriptChunkRepository: {
    listBySession(sessionId: string): Promise<any[]>;
  };
  runtimeStateKey: string;
  loadProviderRuntimeFromSettings: () => Promise<void>;
  applyBootstrapProviderRuntime: () => void;
  resetAssemblerState: () => void;
  loadMergedGraphAsset: (sessionId: string, preloadedSegments?: SegmentGraph[]) => Promise<MergedGraph | null>;
}

export function getRuntimeStorageArea() {
  return chrome.storage.session ?? chrome.storage.local;
}

export async function ensureHydrated(deps: PersistenceDeps) {
  const { S } = deps;
  if (S.runtimeStateHydrated) {
    return;
  }

  if (!S.hydrationPromise) {
    S.hydrationPromise = (async () => {
      const stored = await getRuntimeStorageArea().get(deps.runtimeStateKey);
      const state = stored?.[deps.runtimeStateKey] as PersistedRuntimeState | undefined;
      if (state) {
        S.currentSession = state.currentSession;
        S.recoveredSessionId = state.currentSession?.sessionId ?? null;
        S.transcriptWindow = state.transcriptWindow ?? [];
        S.pendingStructureBuffer = state.pendingStructureBuffer ?? null;
        S.assemblerRuns = state.assemblerRuns ?? [];
        S.structureUnits = state.structureUnits ?? [];
        S.mergedGraph = state.mergedGraph;
        S.transcriptSequence = state.transcriptSequence ?? state.chunkIndex ?? 0;
        S.currentTimeMs = state.currentTimeMs ?? 0;
        S.currentView = state.currentView;
        S.currentViewPinned = state.currentViewPinned ?? false;
        S.structuringSince = state.structuringSince ?? null;
        S.lastTranscriptAt = state.lastTranscriptAt ?? null;
        S.lastGraphUpdatedAt = state.lastGraphUpdatedAt ?? null;
        S.pendingSessionFinalize = state.pendingSessionFinalize ?? null;
        S.providerSummary = state.providerSummary ?? S.providerSummary;
        S.lastProviderError = state.lastProviderError ?? null;
        S.lastStructurerRun = state.lastStructurerRun ?? null;
        S.currentStructurerTarget = null;
      } else {
        const latestSession = (await deps.sessionRepository.listRecent()).find(
          (session) => typeof session.endedAt === 'number',
        );
        if (latestSession) {
          const recoveredChunks = await deps.transcriptChunkRepository.listBySession(
            latestSession.sessionId,
          );
          const recoveredGraph = await deps.loadMergedGraphAsset(latestSession.sessionId);

          S.recoveredSessionId = latestSession.sessionId;
          S.transcriptWindow = recoveredChunks.slice(-3);
          deps.resetAssemblerState();
          S.mergedGraph = recoveredGraph ?? null;
          S.transcriptSequence = recoveredChunks.length;
          S.currentTimeMs = recoveredChunks[recoveredChunks.length - 1]?.endMs ?? 0;
          S.currentView = recoveredGraph?.viewHints?.defaultView;
          S.currentViewPinned = false;
          S.structuringSince = null;
          S.lastTranscriptAt = null;
          S.lastGraphUpdatedAt = null;
          S.pendingChunkWorkCount = 0;
          S.pendingTranscriptWorkCount = 0;
          S.currentStructurerTarget = null;
          S.lastStructurerRun = null;
        }
      }
      try {
        await deps.loadProviderRuntimeFromSettings();
      } catch (error) {
        console.warn('[Service Worker] provider 配置恢复失败，回退安全 runtime:', error);
        deps.applyBootstrapProviderRuntime();
        S.activeProviderConfig = createExtensionDefaultProviderConfig();
        const { redactProviderConfig } = await import('@listen-graphic/providers');
        S.providerSummary = redactProviderConfig(S.activeProviderConfig);
      }
      S.runtimeStateHydrated = true;
    })().finally(() => {
      S.hydrationPromise = null;
    });
  }

  await S.hydrationPromise;
}

export async function rehydrateRuntimeState(deps: PersistenceDeps) {
  const { S } = deps;
  S.runtimeStateHydrated = false;
  S.hydrationPromise = null;
  await ensureHydrated(deps);
}

export async function withIndexedDbRetry<T>(operation: () => Promise<T>) {
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

export function isIndexedDbBackingStoreError(error: unknown) {
  return String(error).includes('opening backing store');
}

export async function persistRuntimeState(
  S: RuntimeStateContainer,
  runtimeStateKey: string,
) {
  S.runtimeStateHydrated = true;
  try {
    await getRuntimeStorageArea().set({
      [runtimeStateKey]: {
        currentSession: S.currentSession,
        transcriptWindow: S.transcriptWindow,
        pendingStructureBuffer: S.pendingStructureBuffer,
        // chrome.storage.session 容量有限，截断保留最近条目
        // 注意：内存中保留 200/100 条（assembler-machine.ts），此处仅保留 50/30 条
        // SW 重启后恢复的数据量会小于运行时峰值
        assemblerRuns: S.assemblerRuns.slice(-50),
        structureUnits: S.structureUnits.slice(-30),
        mergedGraph: S.mergedGraph,
        transcriptSequence: S.transcriptSequence,
        chunkIndex: S.transcriptSequence,
        currentTimeMs: S.currentTimeMs,
        currentView: S.currentView,
        currentViewPinned: S.currentViewPinned,
        structuringSince: S.structuringSince,
        lastTranscriptAt: S.lastTranscriptAt,
        lastGraphUpdatedAt: S.lastGraphUpdatedAt,
        pendingSessionFinalize: S.pendingSessionFinalize,
        providerSummary: S.providerSummary,
        lastProviderError: S.lastProviderError,
        lastStructurerRun: S.lastStructurerRun,
      } satisfies PersistedRuntimeState,
    });
  } catch (error) {
    if (!isIndexedDbBackingStoreError(error)) {
      throw error;
    }
    console.warn('[Service Worker] runtime state 持久化暂不可用，保留内存态状态:', error);
  }
}

export async function clearRuntimeState(
  S: RuntimeStateContainer,
  runtimeStateKey: string,
) {
  S.runtimeStateHydrated = true;
  try {
    await getRuntimeStorageArea().remove(runtimeStateKey);
  } catch (error) {
    if (!isIndexedDbBackingStoreError(error)) {
      throw error;
    }
    console.warn('[Service Worker] runtime state 清理暂不可用，等待下次 hydration 覆盖:', error);
  }
}

export async function persistAssemblerTrace(
  sessionId: string,
  assemblerRuns: unknown[],
  structureUnits: unknown[],
): Promise<void> {
  try {
    const { db } = await import('@listen-graphic/storage');
    // 防御：DB 升级未完成或版本回退时 table 可能不可用
    if (!db.assemblerTraces) {
      return;
    }
    await db.assemblerTraces.put({
      sessionId,
      assemblerRuns,
      structureUnits,
      savedAt: Date.now(),
    });
  } catch (error) {
    // 非致命：trace 持久化失败不影响会话清理，但 debug 导出将缺少 assembler 数据
    console.warn(
      '[Service Worker] assembler trace 持久化失败 (debug 导出将缺少 trace 数据):',
      error instanceof Error ? error.message : error,
    );
  }
}

export async function loadAssemblerTrace(
  sessionId: string,
): Promise<{ assemblerRuns: unknown[]; structureUnits: unknown[] } | null> {
  try {
    const { db } = await import('@listen-graphic/storage');
    // 防御：DB 升级未完成或版本回退时 table 可能不可用
    if (!db.assemblerTraces) {
      return null;
    }
    const record = await db.assemblerTraces.get(sessionId);
    if (!record) {
      return null;
    }
    return {
      assemblerRuns: record.assemblerRuns,
      structureUnits: record.structureUnits,
    };
  } catch (error) {
    console.warn('[Service Worker] 加载 assembler trace 失败:', error);
    return null;
  }
}
