import Dexie, { type Table } from 'dexie';
import type { MergedGraph, SegmentGraph, TranscriptChunk } from '@listen-graphic/schema';

export interface SessionRecord {
  sessionId: string;
  sourceType: 'tab' | 'file';
  createdAt: number;
  endedAt?: number;
  title?: string;
}

export interface SettingRecord<T = unknown> {
  key: string;
  value: T;
  updatedAt: number;
}

export class ListenGraphicDB extends Dexie {
  sessions!: Table<SessionRecord, string>;
  transcriptChunks!: Table<TranscriptChunk, string>;
  segmentGraphs!: Table<SegmentGraph, string>;
  mergedGraphs!: Table<MergedGraph, string>;
  settings!: Table<SettingRecord, string>;

  constructor() {
    super('listen-graphic-db');

    this.version(1).stores({
      sessions: 'sessionId, createdAt',
      transcriptChunks: 'chunkId, sessionId, startMs, endMs',
      segmentGraphs: 'segmentId, sessionId, startMs, endMs',
      mergedGraphs: 'sessionId, revision, updatedAt',
    });

    this.version(2).stores({
      sessions: 'sessionId, createdAt',
      transcriptChunks: 'chunkId, sessionId, startMs, endMs',
      segmentGraphs: 'segmentId, sessionId, startMs, endMs',
      mergedGraphs: 'sessionId, revision, updatedAt',
      settings: 'key, updatedAt',
    });
  }
}

export const db = new ListenGraphicDB();
