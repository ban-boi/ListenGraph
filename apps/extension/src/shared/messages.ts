import type {
  GraphDisplaySettings,
  MergedGraph,
  ProviderConfig,
  ProviderRuntimeSummary,
  SerializableProviderError,
  SegmentGraph,
  StructurerResponseDiagnostics,
  TranscriptChunk,
} from '@listen-graphic/schema';
import type { ViewType } from '@listen-graphic/schema';
import type { BuildInfo } from './build-info';

export type { GraphDisplaySettings };

export type SessionState =
  | 'idle'
  | 'capturing'
  | 'transcribing'
  | 'structuring'
  | 'stopped'
  | 'error';

export interface AudioChunkPayload {
  audioData: number[];
  audioMimeType?: string;
  sampleRate?: number;
  channels?: number;
  bitDepth?: number;
  startMs: number;
  endMs: number;
}

export interface AsrStreamStartPayload {
  transport: 'batch' | 'ws';
  stream?: {
    providerType: 'tencent' | 'external';
    provider: string;
    endpoint?: string;
    protocol?: 'lg-asr-ws-v1';
    authToken?: string;
    sampleRate: number;
    frameDurationMs: number;
    vendorConfig?: Record<string, unknown>;
  };
  tencentRealtime?: {
    signedUrl: string;
    sampleRate: number;
    frameDurationMs: number;
  };
}

export interface AsrStreamVendorMetadata {
  name?: string;
  event?: string;
  voiceId?: string;
  messageId?: string;
  wordSize?: number;
}

export interface AsrStreamFinalPayload {
  text: string;
  startMs: number;
  endMs: number;
  provider: string;
  utteranceId?: string;
  revision?: number;
  kind?: 'final';
  finalReason?:
    | 'endpoint'
    | 'input_finished'
    | 'max_duration'
    | 'manual_flush'
    | 'vendor_defined'
    | 'error_recovery';
  stability?: 'stable';
  transport?: 'batch' | 'ws';
  language?: string;
  confidence?: number;
  vendor?: AsrStreamVendorMetadata;
  raw?: unknown;
}

export interface AsrStreamPartialPayload {
  text: string;
  provider?: string;
  utteranceId?: string;
  revision?: number;
  kind?: 'partial';
  stability?: 'interim';
  startMs?: number;
  endMs?: number;
  sliceType?: 0 | 1;
  vendor?: AsrStreamVendorMetadata;
  raw?: unknown;
}

export interface AsrStreamStatusPayload {
  status: 'connecting' | 'connected' | 'listening' | 'closing' | 'closed';
  provider: string;
  detail?: string;
  bridge?: {
    protocol?: 'lg-asr-ws-v1';
    endpoint?: string;
    model?: string;
  };
}

export interface AsrStreamErrorPayload {
  provider: string;
  code: string;
  message: string;
}

export interface RuntimeSnapshot {
  /** 当前会话 ID，无会话时为 null */
  sessionId: string | null;
  /** 会话状态机当前状态 */
  state: SessionState;
  /** 当前合并图谱 */
  graph: MergedGraph | null;
  /** 当前播放时间（毫秒） */
  currentTimeMs: number;
  /** 当前选中的视图类型 */
  currentView?: ViewType;
  /** 用户是否手动固定了视图 */
  currentViewPinned?: boolean;
  /** 各 provider 运行时摘要 */
  providerSummary: ProviderRuntimeSummary;
  /** 最近一次 provider 错误 */
  lastProviderError?: SerializableProviderError | null;
  /** 最近一次 structurer 运行的调试信息 */
  lastStructurerRun?: StructurerRunDebug | null;
  /** structurer 进入 structuring 状态的时间戳（毫秒），用于计算耗时 */
  structuringSince?: number | null;
  /** 最近一次收到 ASR 转写的时间戳（毫秒） */
  lastTranscriptAt?: number | null;
  /** 最近一次图谱更新的时间戳（毫秒） */
  lastGraphUpdatedAt?: number | null;
  /** 待处理的转写块数量（assembler buffer 中的 utterance 数） */
  pendingTranscriptCount?: number;
  /** 待处理的工作数量（包含转写和 structurer 任务） */
  pendingWorkCount?: number;
  /** 停止会话后待排空的工作数量 */
  stopDrainPendingCount?: number;
  /** 当前 structurer 正在处理的目标转写信息 */
  currentStructurerTarget?: {
    transcriptId: string;
    transcriptEndMs: number;
    transcriptCharCount: number;
    transcriptPreview?: string;
  } | null;
  /** 当前 assembler 缓冲区状态 */
  currentAssemblerState?: {
    /** assembler 是否启用 */
    enabled: boolean;
    /** 缓冲区中待处理的语句数量 */
    pendingUtteranceCount: number;
    /** 缓冲区中待处理的有效字符数 */
    pendingEffectiveCharCount: number;
    /** 缓冲区已等待的毫秒数 */
    pendingWaitMs: number;
    /** 缓冲区最新文本预览 */
    pendingPreview?: string;
  } | null;
  /** Service Worker 构建信息 */
  workerBuild?: BuildInfo;
}

export type ExportFormat = 'json' | 'markdown' | 'mermaid';

export interface StructurerRunDebug {
  sessionId: string;
  sequence: number;
  mode: 'bootstrap' | 'incremental';
  transcriptEndMs: number;
  latestTranscriptId: string;
  latestChunkId: string;
  windowStartMs: number;
  windowEndMs: number;
  windowTranscriptCount: number;
  windowChunkCount: number;
  windowCharCount: number;
  latestTranscriptCharCount: number;
  latestChunkCharCount: number;
  recentNodeCount: number;
  recentEdgeCount: number;
  startedAt: number;
  completedAt: number;
  durationMs: number;
  status: 'success' | 'timeout' | 'error';
  segmentId?: string;
  topic?: string;
  nodeCount?: number;
  edgeCount?: number;
  fallbackUsed?: boolean;
  errorCode?: string;
  errorMessage?: string;
  structurerDiagnostics?: StructurerResponseDiagnostics;
}

export interface AssemblerRunDebug {
  /** 所属会话 ID */
  sessionId: string;
  /** 本次 assembler 决策的序号 */
  sequence: number;
  /** 触发本次决策的最新转写 ID */
  latestTranscriptId: string;
  /** 最新转写的结束时间（毫秒） */
  latestTranscriptEndMs: number;
  /** 触发本次决策的转写文本 */
  latestTranscriptText: string;
  /** 决策类型：跳过当前、等待更多上下文、提交 structurer */
  decision: 'skip_current' | 'wait' | 'commit';
  /** 决策原因描述 */
  reason: string;
  /** 缓冲区中包含的转写 ID 列表 */
  bufferTranscriptIds: string[];
  /** 缓冲区中的转写数量 */
  bufferTranscriptCount: number;
  /** 缓冲区起始时间（毫秒） */
  bufferStartMs: number;
  /** 缓冲区结束时间（毫秒） */
  bufferEndMs: number;
  /** 缓冲区总字符数 */
  totalCharCount: number;
  /** 缓冲区有效字符数（去除空白和标点） */
  effectiveCharCount: number;
  /** 缓冲区已等待时间（毫秒） */
  waitMs: number;
  /** 是否检测到句末标点 */
  sawTerminalPunctuation: boolean;
  /** 是否检测到未完成的尾部模式（如"因为"、"所以"等） */
  sawIncompleteTail: boolean;
  /** 评分得分（仅 commit 和 wait 时有值） */
  score?: number;
  /** commit 时生成的 structure unit ID */
  committedUnitId?: string;
  /** commit 时包含的源转写块 ID */
  committedChunkIds?: string[];
  /** commit 时提交的合并文本 */
  committedText?: string;
  /** 创建时间戳（毫秒） */
  createdAt: number;
}

export interface StructureUnitDebug {
  /** 结构单元 ID */
  unitId: string;
  /** 所属会话 ID */
  sessionId: string;
  /** 起始时间（毫秒） */
  startMs: number;
  /** 结束时间（毫秒） */
  endMs: number;
  /** 合并后的文本内容 */
  text: string;
  /** 源转写块 ID 列表 */
  sourceChunkIds: string[];
  /** 提交原因 */
  reason: string;
  /** 创建时间戳（毫秒） */
  createdAt: number;
}

export interface DebugSessionData {
  session: {
    sessionId: string;
    sourceType: 'tab' | 'file';
    createdAt: number;
    endedAt?: number;
    title?: string;
  } | null;
  transcripts: TranscriptChunk[];
  segments: SegmentGraph[];
  traces: Array<{
    sequence: number;
    transcript: TranscriptChunk;
    transcriptWindow: TranscriptChunk[];
    segment: SegmentGraph | null;
    structurerRun?: StructurerRunDebug | null;
    assemblerRun?: AssemblerRunDebug | null;
    mergedGraphAfter: MergedGraph | null;
  }>;
  graph: MergedGraph | null;
  providerSummary: ProviderRuntimeSummary;
  lastProviderError?: SerializableProviderError | null;
  structurerRuns?: StructurerRunDebug[];
  assemblerRuns?: AssemblerRunDebug[];
  structureUnits?: StructureUnitDebug[];
  /** trace 数据来源：memory=内存中，indexeddb=从 IndexedDB 恢复，empty=无数据 */
  traceSource?: 'memory' | 'indexeddb' | 'empty';
}

export interface ReplaySessionData {
  session: {
    sessionId: string;
    sourceType: 'tab' | 'file';
    createdAt: number;
    endedAt?: number;
    title?: string;
  } | null;
  transcripts: TranscriptChunk[];
  graph: MergedGraph | null;
  durationMs: number;
}

export interface StructurerInjectionSeed {
  sessionId?: string;
  sourceType?: 'tab' | 'file';
  transcriptWindow?: TranscriptChunk[];
  mergedGraph?: MergedGraph | null;
  currentTimeMs?: number;
  transcriptSequence?: number;
  chunkIndex?: number;
}

export type AppMessage =
  | {
      type: 'SESSION_START';
      target: 'service-worker';
      payload: { tabId: number; sourceType?: 'tab' | 'file' };
    }
  | {
      type: 'START_CAPTURE';
      target: 'content-script';
      payload: AsrStreamStartPayload;
    }
  | {
      type: 'STOP_CAPTURE';
      target: 'content-script';
      payload: {};
    }
  | {
      type: 'SESSION_STOP';
      target: 'service-worker';
      payload: { sessionId: string };
    }
  | {
      type: 'GET_RUNTIME_SNAPSHOT';
      target: 'service-worker';
      payload: {};
    }
  | {
      type: 'GET_PROVIDER_SETTINGS';
      target: 'service-worker';
      payload: {};
    }
  | {
      type: 'SAVE_PROVIDER_SETTINGS';
      target: 'service-worker';
      payload: { config: ProviderConfig };
    }
  | {
      type: 'CLEAR_PROVIDER_SECRETS';
      target: 'service-worker';
      payload: {};
    }
  | {
      type: 'VIEW_SELECTED';
      target: 'service-worker';
      payload: { sessionId: string; view: ViewType };
    }
  | {
      type: 'EXPORT_SESSION';
      target: 'service-worker';
      payload: { sessionId: string; format: ExportFormat };
    }
  | {
      type: 'GET_DEBUG_SESSION';
      target: 'service-worker';
      payload: { sessionId: string };
    }
  | {
      type: 'GET_REPLAY_SESSION';
      target: 'service-worker';
      payload: { sessionId: string };
    }
  | {
      type: 'SESSION_STATE_CHANGED';
      target: 'sidepanel';
      payload: {
        sessionId: string | null;
        state: SessionState;
        /** 停止会话时附带内存中的最终图谱，避免侧栏在快照图为空时误清空 React Flow */
        mergedGraph?: MergedGraph | null;
        currentTimeMs?: number;
      } & Pick<RuntimeSnapshot,
        'currentView' | 'currentViewPinned' |
        'pendingTranscriptCount' | 'pendingWorkCount' |
        'stopDrainPendingCount' | 'currentStructurerTarget'
      >;
    }
  | {
      type: 'AUDIO_CHUNK_READY';
      target: 'service-worker';
      payload: AudioChunkPayload;
    }
  | {
      type: 'ASR_STREAM_FINAL_READY';
      target: 'service-worker';
      payload: AsrStreamFinalPayload;
    }
  | {
      type: 'ASR_STREAM_UTTERANCE_READY';
      target: 'service-worker';
      payload: AsrStreamFinalPayload;
    }
  | {
      type: 'ASR_STREAM_PARTIAL_UPDATED';
      target: 'service-worker';
      payload: AsrStreamPartialPayload;
    }
  | {
      type: 'ASR_STREAM_STATUS';
      target: 'service-worker';
      payload: AsrStreamStatusPayload;
    }
  | {
      type: 'ASR_STREAM_ERROR';
      target: 'service-worker';
      payload: AsrStreamErrorPayload;
    }
  | {
      type: 'TEST_STRUCTURER_SESSION_RUN';
      target: 'service-worker';
      payload: {
        seed?: StructurerInjectionSeed;
        transcripts: TranscriptChunk[];
        finalizeSession?: boolean;
      };
    }
  | {
      type: 'TRANSCRIPT_READY';
      target: 'sidepanel';
      payload: { transcript: TranscriptChunk };
    }
  | {
      type: 'MERGED_GRAPH_UPDATED';
      target: 'sidepanel';
      payload: { graph: MergedGraph };
    }
  | {
      type: 'NODE_CLICKED';
      target: 'service-worker';
      payload: { sessionId: string; nodeId: string; timestampMs: number };
    }
  | {
      type: 'CAPTURE_ENDED';
      target: 'service-worker';
      payload: { reason: 'share-ended' | 'pagehide' | 'beforeunload' };
    }
  | {
      type: 'SEEK_TO_TIMESTAMP';
      target: 'content-script';
      payload: { timestampMs: number; nodeId?: string };
    }
  | {
      type: 'PLAYBACK_TIME_UPDATED';
      target: 'sidepanel';
      payload: { currentTimeMs: number };
    }
  | {
      type: 'ERROR';
      target: 'sidepanel';
      payload: { code: string; message: string };
    }
  | {
      type: 'PROVIDER_PROGRESS';
      target: 'sidepanel';
      payload: { stage: 'asr' | 'structurer'; message: string; asrSliceType?: 0 | 1 };
    }
  | {
      type: 'GET_GRAPH_DISPLAY_SETTINGS';
      target: 'service-worker';
      payload: {};
    }
  | {
      type: 'SAVE_GRAPH_DISPLAY_SETTINGS';
      target: 'service-worker';
      payload: { settings: GraphDisplaySettings };
    };
