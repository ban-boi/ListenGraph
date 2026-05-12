// runtime-state.ts — 运行时状态容器
// 将 26 个模块级 let 变量合并为一个可注入的状态容器，
// 使状态可被原子重置、序列化和跨模块共享。

import type {
  MergedGraph,
  ProviderConfig,
  ProviderRuntimeSummary,
  SerializableProviderError,
  TranscriptChunk,
} from '@listen-graphic/schema';
import type {
  AsrProvider,
  StructurerProvider,
} from '@listen-graphic/providers';
import { redactProviderConfig } from '@listen-graphic/providers';
import type {
  AssemblerRunDebug,
  StructureUnitDebug,
  StructurerRunDebug,
  RuntimeSnapshot,
  SessionState,
} from '../shared/messages';
import type { PendingStructureBuffer } from './assembler-types';
import {
  createExtensionDefaultProviderConfig,
} from './provider-config';

export type ActiveSession = {
  sessionId: string;
  tabId: number;
  state: SessionState;
};

export type PersistedRuntimeState = {
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

export class RuntimeStateContainer {
  currentSession: ActiveSession | null = null;
  recoveredSessionId: string | null = null;
  transcriptWindow: TranscriptChunk[] = [];
  pendingStructureBuffer: PendingStructureBuffer | null = null;
  assemblerRuns: AssemblerRunDebug[] = [];
  structureUnits: StructureUnitDebug[] = [];
  mergedGraph: MergedGraph | null = null;
  transcriptSequence = 0;
  currentTimeMs = 0;
  currentView: RuntimeSnapshot['currentView'] = undefined;
  currentViewPinned = false;
  structuringSince: number | null = null;
  lastTranscriptAt: number | null = null;
  lastGraphUpdatedAt: number | null = null;
  pendingSessionFinalize: { sessionId: string; endedAt: number } | null = null;
  inFlightChunkPromise: Promise<unknown> | null = null;
  chunkQueueTail: Promise<void> = Promise.resolve();
  pendingChunkWorkCount = 0;
  inFlightTranscriptPromise: Promise<unknown> | null = null;
  transcriptProcessTail: Promise<void> = Promise.resolve();
  pendingTranscriptWorkCount = 0;
  stoppingSessionId: string | null = null;
  runtimeStateHydrated = false;
  hydrationPromise: Promise<void> | null = null;
  activeProviderConfig: ProviderConfig = createExtensionDefaultProviderConfig();
  providerSummary: ProviderRuntimeSummary = redactProviderConfig(
    createExtensionDefaultProviderConfig(),
  );
  lastProviderError: SerializableProviderError | null = null;
  lastStructurerRun: StructurerRunDebug | null = null;
  currentStructurerTarget: RuntimeSnapshot['currentStructurerTarget'] = null;
  asrProvider!: AsrProvider;
  structurerProvider!: StructurerProvider;

  /** 重置活跃会话运行时状态（三处 bulk-reset 的共同子集）。
   *  不触碰：pendingSessionFinalize、stoppingSessionId、lastStructurerRun、
   *  provider runtime 字段、hydration 字段。
   *  会重置：pendingChunkWorkCount、pendingTranscriptWorkCount（工作计数器归零）。 */
  resetActiveRuntime(): void {
    this.currentSession = null;
    this.recoveredSessionId = null;
    this.transcriptWindow = [];
    this.pendingStructureBuffer = null;
    this.assemblerRuns = [];
    this.structureUnits = [];
    this.mergedGraph = null;
    this.transcriptSequence = 0;
    this.currentTimeMs = 0;
    this.currentView = undefined;
    this.currentViewPinned = false;
    this.structuringSince = null;
    this.lastTranscriptAt = null;
    this.lastGraphUpdatedAt = null;
    this.pendingChunkWorkCount = 0;
    this.pendingTranscriptWorkCount = 0;
    this.currentStructurerTarget = null;
  }

  /** 重置队列状态（in-flight promise 和计数器） */
  resetQueues(): void {
    this.inFlightChunkPromise = null;
    this.chunkQueueTail = Promise.resolve();
    this.pendingChunkWorkCount = 0;
    this.inFlightTranscriptPromise = null;
    this.transcriptProcessTail = Promise.resolve();
    this.pendingTranscriptWorkCount = 0;
  }
}
