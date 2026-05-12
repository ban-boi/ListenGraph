import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@listen-graphic/storage';
import type { AssemblerTraceRecord } from '@listen-graphic/storage';

describe('Assembler Flight Recorder', () => {
  beforeEach(async () => {
    await db.assemblerTraces.clear();
  });

  it('应能持久化和加载 assembler trace', async () => {
    const sessionId = 'test-session-1';
    const record: AssemblerTraceRecord = {
      sessionId,
      assemblerRuns: [{ sequence: 1, decision: 'commit', reason: 'commit_rule' }],
      structureUnits: [{ unitId: 'u1', reason: 'commit_rule', text: '测试文本' }],
      savedAt: Date.now(),
    };

    await db.assemblerTraces.put(record);
    const loaded = await db.assemblerTraces.get(sessionId);

    expect(loaded).toBeDefined();
    expect(loaded!.assemblerRuns).toHaveLength(1);
    expect(loaded!.structureUnits).toHaveLength(1);
  });

  it('应能覆盖同一 sessionId 的旧数据', async () => {
    const sessionId = 'test-session-2';

    await db.assemblerTraces.put({
      sessionId,
      assemblerRuns: [{ sequence: 1 }],
      structureUnits: [],
      savedAt: 1,
    });

    await db.assemblerTraces.put({
      sessionId,
      assemblerRuns: [{ sequence: 1 }, { sequence: 2 }],
      structureUnits: [{ unitId: 'u1' }],
      savedAt: 2,
    });

    const loaded = await db.assemblerTraces.get(sessionId);
    expect(loaded!.assemblerRuns).toHaveLength(2);
    expect(loaded!.structureUnits).toHaveLength(1);
    expect(loaded!.savedAt).toBe(2);
  });

  it('加载不存在的 sessionId 应返回 undefined', async () => {
    const loaded = await db.assemblerTraces.get('nonexistent');
    expect(loaded).toBeUndefined();
  });
});
