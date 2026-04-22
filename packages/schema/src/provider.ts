import type { MergedGraph, SegmentGraph } from './graph';
import type { TranscriptChunk } from './transcript';

export type ProviderMode = 'direct' | 'relay';
export type AsrProviderType = 'mock' | 'openai' | 'tencent' | 'external';
export type StructurerProviderType = 'mock' | 'openai' | 'zhipu' | 'baidu' | 'aliyun';
export type ProviderStage = 'asr' | 'structurer';
export type AsrTransport = 'batch' | 'ws';
export type AsrBridgeProtocol = 'lg-asr-ws-v1';

export interface ProviderRetryPolicy {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  timeoutMs: number;
  retryableStatusCodes: number[];
}

export interface AsrProviderConfig {
  type: AsrProviderType;
  mode: ProviderMode;
  transport?: AsrTransport;
  endpoint?: string;
  apiKey?: string;
  sessionToken?: string;
  model?: string;
  language?: string;
  region?: string;
  appId?: string;
  bridgeProtocol?: AsrBridgeProtocol;
  bridgeAuthToken?: string;
  needVad?: boolean;
  vadSilenceTimeMs?: number;
  maxSpeakTimeMs?: number;
  hotwordId?: string;
  hotwordList?: string;
  wordInfo?: number;
  // 腾讯云特有字段
  secretId?: string;
  secretKey?: string;
  retry?: Partial<ProviderRetryPolicy>;
}

export interface StructurerProviderConfig {
  type: StructurerProviderType;
  mode: ProviderMode;
  endpoint?: string;
  apiKey?: string;
  sessionToken?: string;
  model?: string;
  language?: string;
  retry?: Partial<ProviderRetryPolicy>;
}

export interface ProviderConfig {
  asr: AsrProviderConfig;
  structurer: StructurerProviderConfig;
}

export interface ProviderRuntimeEntrySummary {
  type: string;
  mode: ProviderMode;
  transport?: AsrTransport;
  endpoint?: string;
  model?: string;
  language?: string;
  apiKeyConfigured: boolean;
  sessionTokenConfigured: boolean;
  bridgeProtocol?: AsrBridgeProtocol;
  bridgeAuthTokenConfigured?: boolean;
  secretConfigured?: boolean;
}

export interface ProviderRuntimeSummary {
  asr: ProviderRuntimeEntrySummary;
  structurer: ProviderRuntimeEntrySummary;
}

export type ProviderErrorCode =
  | 'AUTH_ERROR'
  | 'RATE_LIMIT_ERROR'
  | 'NETWORK_ERROR'
  | 'TIMEOUT_ERROR'
  | 'INVALID_RESPONSE'
  | 'CONFIG_ERROR'
  | 'TRANSCRIBE_ERROR'
  | 'STRUCTURE_ERROR';

/** Debug payload when structurer response cannot be parsed (export / storage only). */
export interface StructurerResponseDiagnostics {
  responsePreview?: string;
  responseTruncated?: boolean;
  parseStage?: 'empty_content' | 'primary_json' | 'repaired_json' | 'extract_object';
  parseMessage?: string;
}

export interface SerializableProviderError {
  code: ProviderErrorCode;
  message: string;
  provider: string;
  stage: ProviderStage;
  retriable: boolean;
  status?: number;
  attemptCount?: number;
  structurerDiagnostics?: StructurerResponseDiagnostics;
}

export interface AsrProvider {
  name: string;
  transcribeChunk(input: {
    audio: Blob | ArrayBuffer;
    startMs: number;
    endMs: number;
    sessionId: string;
    language?: string;
  }): Promise<TranscriptChunk>;
  reset?(): void;
}

export interface StructurerProvider {
  name: string;
  extractSegmentGraph(input: {
    sessionId: string;
    transcriptWindow: TranscriptChunk[];
    previousGraph?: MergedGraph;
    language?: string;
  }): Promise<SegmentGraph>;
  reset?(): void;
}
