import type {
  MergedGraph,
  ProviderConfig,
  ProviderRuntimeSummary,
  SerializableProviderError,
  SegmentGraph,
  TranscriptChunk,
} from '@listen-graphic/schema';
import type { ViewType } from '@listen-graphic/schema';
import type { BuildInfo } from './build-info';

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
  tencentRealtime?: {
    signedUrl: string;
    sampleRate: number;
    frameDurationMs: number;
  };
}

export interface AsrStreamUtterancePayload {
  text: string;
  startMs: number;
  endMs: number;
  provider: string;
  confidence?: number;
  voiceId?: string;
  messageId?: string;
  wordSize?: number;
  raw?: unknown;
}

export interface AsrStreamPartialPayload {
  text: string;
  sliceType: 0 | 1;
  startMs?: number;
  endMs?: number;
  voiceId?: string;
  messageId?: string;
  raw?: unknown;
}

export interface AsrStreamStatusPayload {
  status: 'connecting' | 'connected' | 'closing' | 'closed';
  provider: string;
  detail?: string;
}

export interface AsrStreamErrorPayload {
  provider: string;
  code: string;
  message: string;
}

export interface RuntimeSnapshot {
  sessionId: string | null;
  state: SessionState;
  graph: MergedGraph | null;
  currentTimeMs: number;
  currentView?: ViewType;
  currentViewPinned?: boolean;
  providerSummary: ProviderRuntimeSummary;
  lastProviderError?: SerializableProviderError | null;
  workerBuild?: BuildInfo;
}

export type ExportFormat = 'json' | 'markdown' | 'mermaid';

export interface StructurerRunDebug {
  sessionId: string;
  sequence: number;
  mode: 'bootstrap' | 'incremental';
  transcriptEndMs: number;
  latestChunkId: string;
  windowStartMs: number;
  windowEndMs: number;
  windowChunkCount: number;
  windowCharCount: number;
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
    mergedGraphAfter: MergedGraph | null;
  }>;
  graph: MergedGraph | null;
  providerSummary: ProviderRuntimeSummary;
  lastProviderError?: SerializableProviderError | null;
  structurerRuns?: StructurerRunDebug[];
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
      payload: { sessionId: string | null; state: SessionState };
    }
  | {
      type: 'AUDIO_CHUNK_READY';
      target: 'service-worker';
      payload: AudioChunkPayload;
    }
  | {
      type: 'ASR_STREAM_UTTERANCE_READY';
      target: 'service-worker';
      payload: AsrStreamUtterancePayload;
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
      payload: { stage: 'asr' | 'structurer'; message: string };
    };
