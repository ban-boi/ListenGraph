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

export type AppMessage =
  | {
      type: 'SESSION_START';
      target: 'service-worker';
      payload: { tabId: number; sourceType?: 'tab' | 'file' };
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
