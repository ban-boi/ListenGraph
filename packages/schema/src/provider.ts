import type { MergedGraph, SegmentGraph } from './graph';
import type { TranscriptChunk } from './transcript';

export type ProviderMode = 'direct' | 'relay';
export type AsrProviderType = 'mock' | 'openai' | 'tencent';
export type StructurerProviderType = 'mock' | 'openai';
export type ProviderStage = 'asr' | 'structurer';

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
  endpoint?: string;
  apiKey?: string;
  sessionToken?: string;
  model?: string;
  language?: string;
  region?: string;
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
  endpoint?: string;
  model?: string;
  language?: string;
  apiKeyConfigured: boolean;
  sessionTokenConfigured: boolean;
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

export interface SerializableProviderError {
  code: ProviderErrorCode;
  message: string;
  provider: string;
  stage: ProviderStage;
  retriable: boolean;
  status?: number;
  attemptCount?: number;
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
