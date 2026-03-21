import Dexie, { type Table } from 'dexie';
import type { MergedGraph, SegmentGraph, TranscriptChunk } from '@listen-graphic/schema';

export interface SessionRecord {
  sessionId: string;
  sourceType: 'tab' | 'file';
  createdAt: number;
  endedAt?: number;
  title?: string;
}

export class ListenGraphicDB extends Dexie {
  sessions!: Table<SessionRecord, string>;
  transcriptChunks!: Table<TranscriptChunk, string>;
  segmentGraphs!: Table<SegmentGraph, string>;
  mergedGraphs!: Table<MergedGraph, string>;

  constructor() {
    super('listen-graphic-db');

    this.version(1).stores({
      sessions: 'sessionId, createdAt',
      transcriptChunks: 'chunkId, sessionId, startMs, endMs',
      segmentGraphs: 'segmentId, sessionId, startMs, endMs',
      mergedGraphs: 'sessionId, revision, updatedAt',
    });
  }
}

export const db = new ListenGraphicDB();
