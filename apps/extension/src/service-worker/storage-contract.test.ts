import { beforeEach, describe, expect, it } from 'vitest';
import type { MergedGraph, TranscriptChunk } from '@listen-graphic/schema';
import type { SessionRecord } from '@listen-graphic/storage';
import {
  createMergedGraphRepository,
  createSessionRepository,
  createSettingsRepository,
  createTranscriptChunkRepository,
} from '@listen-graphic/storage';
import type { ProviderConfig } from '@listen-graphic/providers';

class MemoryTable<T extends object> {
  constructor(private readonly key: keyof T, private rows: T[] = []) {}

  async put(value: T) {
    const keyValue = value[this.key];
    const nextRows = this.rows.filter((row) => row[this.key] !== keyValue);
    nextRows.push(structuredClone(value));
    this.rows = nextRows;
  }

  async get(keyValue: T[keyof T]) {
    return this.rows.find((row) => row[this.key] === keyValue);
  }

  async update(keyValue: T[keyof T], changes: Partial<T>) {
    const target = this.rows.find((row) => row[this.key] === keyValue);
    if (!target) {
      return 0;
    }
    Object.assign(target, structuredClone(changes));
    return 1;
  }

  async toArray() {
    return this.rows.map((row) => structuredClone(row));
  }
}

type SettingRecord = {
  key: string;
  value: unknown;
  updatedAt: number;
};

describe('storage repositories contract', () => {
  let sessionsTable: MemoryTable<SessionRecord>;
  let transcriptTable: MemoryTable<TranscriptChunk>;
  let mergedGraphTable: MemoryTable<MergedGraph>;
  let settingsTable: MemoryTable<SettingRecord>;

  beforeEach(() => {
    sessionsTable = new MemoryTable<SessionRecord>('sessionId');
    transcriptTable = new MemoryTable<TranscriptChunk>('chunkId');
    mergedGraphTable = new MemoryTable<MergedGraph>('sessionId');
    settingsTable = new MemoryTable<SettingRecord>('key');
  });

  it('session repository 可以保存、结束并按时间倒序列出会话', async () => {
    const repository = createSessionRepository({
      sessions: sessionsTable,
    });

    await repository.save({
      sessionId: 'session_1',
      sourceType: 'tab',
      createdAt: 100,
      title: 'Session One',
    });
    await repository.save({
      sessionId: 'session_2',
      sourceType: 'tab',
      createdAt: 200,
      title: 'Session Two',
    });
    await repository.markEnded('session_1', 300);

    const session = await repository.get('session_1');
    const recent = await repository.listRecent();

    expect(session).toEqual(
      expect.objectContaining({
        sessionId: 'session_1',
        endedAt: 300,
      }),
    );
    expect(recent.map((item) => item.sessionId)).toEqual(['session_2', 'session_1']);
  });

  it('transcript repository 可以按时间顺序返回会话的所有 chunk', async () => {
    const repository = createTranscriptChunkRepository({
      transcriptChunks: transcriptTable,
    });

    await repository.append({
      chunkId: 'chunk_2',
      sessionId: 'session_1',
      text: '第二段',
      startMs: 30000,
      endMs: 60000,
      provider: 'mock-asr',
    });
    await repository.append({
      chunkId: 'chunk_1',
      sessionId: 'session_1',
      text: '第一段',
      startMs: 0,
      endMs: 30000,
      provider: 'mock-asr',
    });
    await repository.append({
      chunkId: 'chunk_other',
      sessionId: 'session_2',
      text: '其他会话',
      startMs: 0,
      endMs: 30000,
      provider: 'mock-asr',
    });

    const chunks = await repository.listBySession('session_1');

    expect(chunks.map((item) => item.chunkId)).toEqual(['chunk_1', 'chunk_2']);
  });

  it('merged graph repository 会按 session 返回当前最新快照', async () => {
    const repository = createMergedGraphRepository({
      mergedGraphs: mergedGraphTable,
    });

    await repository.save({
      sessionId: 'session_1',
      revision: 1,
      topics: [],
      nodes: [],
      edges: [],
      updatedAt: 100,
    });
    await repository.save({
      sessionId: 'session_2',
      revision: 1,
      topics: [],
      nodes: [],
      edges: [],
      updatedAt: 200,
    });
    await repository.save({
      sessionId: 'session_1',
      revision: 2,
      topics: [],
      nodes: [
        {
          id: 'node_1',
          type: 'claim',
          text: 'latest',
          timestampMs: 0,
          status: 'confirmed',
        },
      ],
      edges: [],
      updatedAt: 300,
    });

    const latest = await repository.getBySession('session_1');

    expect(latest?.revision).toBe(2);
    expect(latest?.nodes[0]?.text).toBe('latest');
  });

  it('settings repository 可以保存 provider 配置并单独清除密钥字段', async () => {
    const repository = createSettingsRepository({
      settings: settingsTable,
    });
    const providerConfig: ProviderConfig = {
      asr: {
        type: 'tencent',
        mode: 'direct',
        secretId: 'secret-id',
        secretKey: 'secret-key',
        region: 'ap-shanghai',
        language: 'zh',
      },
      structurer: {
        type: 'openai',
        mode: 'relay',
        endpoint: 'https://relay.listen-graphic.local/v1',
        sessionToken: 'relay-session-token',
        model: 'gpt-4.1-mini',
        language: 'zh',
      },
    };

    await repository.saveProviderConfig(providerConfig);
    await repository.clearProviderSecrets();

    const saved = await repository.getProviderConfig();

    expect(saved).toEqual({
      asr: expect.objectContaining({
        type: 'tencent',
        region: 'ap-shanghai',
        apiKey: undefined,
        secretId: undefined,
        secretKey: undefined,
      }),
      structurer: expect.objectContaining({
        type: 'openai',
        endpoint: 'https://relay.listen-graphic.local/v1',
        sessionToken: undefined,
      }),
    });
  });

  it('settings repository 可以保存图谱显示配置', async () => {
    const repository = createSettingsRepository({
      settings: settingsTable,
    });

    await repository.saveGraphDisplaySettings({
      autoFitMinReadableFontPx: 14,
    });

    await expect(repository.getGraphDisplaySettings()).resolves.toEqual({
      autoFitMinReadableFontPx: 14,
    });
  });
});
