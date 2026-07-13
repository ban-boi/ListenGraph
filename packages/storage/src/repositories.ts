import type { GraphDisplaySettings, MergedGraph, ProviderConfig, SegmentGraph, TranscriptChunk } from '@listen-graphic/schema';
import type { SessionRecord, SettingRecord, AssemblerTraceRecord } from './indexeddb';

type TableLike<T, Key> = {
  put(value: T): Promise<unknown>;
  get(key: Key): Promise<T | undefined>;
  update?(key: Key, changes: Partial<T>): Promise<number>;
  delete?(key: Key): Promise<unknown>;
  toArray(): Promise<T[]>;
};

export type SessionRepository = ReturnType<typeof createSessionRepository>;
export type TranscriptChunkRepository = ReturnType<typeof createTranscriptChunkRepository>;
export type SegmentGraphRepository = ReturnType<typeof createSegmentGraphRepository>;
export type MergedGraphRepository = ReturnType<typeof createMergedGraphRepository>;
export type SettingsRepository = ReturnType<typeof createSettingsRepository>;

export function createSessionRepository(tables: {
  sessions: TableLike<SessionRecord, string>;
}) {
  return {
    async save(session: SessionRecord) {
      await tables.sessions.put(session);
    },
    async get(sessionId: string) {
      return tables.sessions.get(sessionId);
    },
    async markEnded(sessionId: string, endedAt: number) {
      if (tables.sessions.update) {
        await tables.sessions.update(sessionId, { endedAt });
        return;
      }

      const existing = await tables.sessions.get(sessionId);
      if (!existing) {
        return;
      }
      await tables.sessions.put({ ...existing, endedAt });
    },
    async listRecent(limit?: number) {
      const sessions = await tables.sessions.toArray();
      const sorted = sessions.sort((a, b) => b.createdAt - a.createdAt);
      return typeof limit === 'number' ? sorted.slice(0, limit) : sorted;
    },
  };
}

export function createTranscriptChunkRepository(tables: {
  transcriptChunks: TableLike<TranscriptChunk, string>;
}) {
  return {
    async append(chunk: TranscriptChunk) {
      await tables.transcriptChunks.put(chunk);
    },
    async listBySession(sessionId: string) {
      const chunks = await tables.transcriptChunks.toArray();
      return chunks
        .filter((chunk) => chunk.sessionId === sessionId)
        .sort((a, b) => a.startMs - b.startMs);
    },
  };
}

export function createSegmentGraphRepository(tables: {
  segmentGraphs: TableLike<SegmentGraph, string>;
}) {
  return {
    async append(segment: SegmentGraph) {
      await tables.segmentGraphs.put(segment);
    },
    async listBySession(sessionId: string) {
      const segments = await tables.segmentGraphs.toArray();
      return segments
        .filter((segment) => segment.sessionId === sessionId)
        .sort((a, b) => a.startMs - b.startMs);
    },
  };
}

export function createMergedGraphRepository(tables: {
  mergedGraphs: TableLike<MergedGraph, string>;
}) {
  return {
    async save(graph: MergedGraph) {
      await tables.mergedGraphs.put(graph);
    },
    async getBySession(sessionId: string) {
      const graphs = await tables.mergedGraphs.toArray();
      return graphs.find((graph) => graph.sessionId === sessionId);
    },
    async listAll() {
      return tables.mergedGraphs.toArray();
    },
  };
}

const PROVIDER_CONFIG_KEY = 'provider-config';
const GRAPH_DISPLAY_SETTINGS_KEY = 'graph-display-settings';

export function createSettingsRepository(tables: {
  settings: TableLike<SettingRecord, string>;
}) {
  return {
    async get<T = unknown>(key: string) {
      const record = await tables.settings.get(key);
      return record?.value as T | undefined;
    },
    async set<T = unknown>(key: string, value: T) {
      await tables.settings.put({
        key,
        value,
        updatedAt: Date.now(),
      });
    },
    async remove(key: string) {
      if ('delete' in tables.settings && typeof tables.settings.delete === 'function') {
        await tables.settings.delete(key);
        return;
      }

      const records = await tables.settings.toArray();
      const remaining = records.filter((record) => record.key !== key);
      for (const record of remaining) {
        await tables.settings.put(record);
      }
    },
    async getProviderConfig() {
      return this.get<ProviderConfig>(PROVIDER_CONFIG_KEY);
    },
    async saveProviderConfig(config: ProviderConfig) {
      await this.set(PROVIDER_CONFIG_KEY, config);
    },
    async clearProviderSecrets() {
      const config = await this.getProviderConfig();
      if (!config) {
        return;
      }

      await this.saveProviderConfig({
        asr: {
          ...config.asr,
          apiKey: undefined,
          sessionToken: undefined,
          secretId: undefined,
          secretKey: undefined,
        },
        structurer: {
          ...config.structurer,
          apiKey: undefined,
          sessionToken: undefined,
        },
      });
    },
    async getGraphDisplaySettings() {
      return this.get<GraphDisplaySettings>(GRAPH_DISPLAY_SETTINGS_KEY);
    },
    async saveGraphDisplaySettings(settings: GraphDisplaySettings) {
      await this.set(GRAPH_DISPLAY_SETTINGS_KEY, settings);
    },
  };
}

