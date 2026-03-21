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
  text: string;
  startMs: number;
  endMs: number;
  tokens?: TranscriptToken[];
  speakerHints?: string[];
  provider: string;
  confidence?: number;
  raw?: unknown;
}
