import type { MergedGraph, SegmentGraph } from './graph';
import type { TranscriptChunk } from './transcript';

export interface AsrProvider {
  name: string;
  transcribeChunk(input: {
    audio: Blob | ArrayBuffer;
    startMs: number;
    endMs: number;
    sessionId: string;
    language?: string;
  }): Promise<TranscriptChunk>;
}

export interface StructurerProvider {
  name: string;
  extractSegmentGraph(input: {
    sessionId: string;
    transcriptWindow: TranscriptChunk[];
    previousGraph?: MergedGraph;
    language?: string;
  }): Promise<SegmentGraph>;
}
