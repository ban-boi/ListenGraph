export interface TranscriptToken {
  text: string;
  startMs?: number;
  endMs?: number;
  speaker?: string;
  confidence?: number;
}

export interface TranscriptChunk {
  chunkId: string;
  sessionId: string;
  utteranceId?: string;
  sequence?: number;
  kind?: 'final';
  text: string;
  startMs: number;
  endMs: number;
  finalReason?:
    | 'endpoint'
    | 'input_finished'
    | 'max_duration'
    | 'manual_flush'
    | 'vendor_defined'
    | 'error_recovery';
  transport?: 'batch' | 'ws';
  stability?: 'stable';
  language?: string;
  tokens?: TranscriptToken[];
  speakerHints?: string[];
  provider: string;
  confidence?: number;
  metrics?: {
    latencyMs?: number;
    audioDurationMs?: number;
    realtimeFactor?: number;
  };
  raw?: unknown;
}
