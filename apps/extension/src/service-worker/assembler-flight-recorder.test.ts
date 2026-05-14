import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@listen-graphic/storage';
import type { AssemblerTraceRecord } from '@listen-graphic/storage';
import {
  isValidAssemblerRun,
  isValidStructureUnit,
} from './session-handlers';

describe('Assembler Flight Recorder — Dexie 存储', () => {
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

  it('应能存储包含混合合法/非法数据的记录', async () => {
    const sessionId = 'test-mixed';
    await db.assemblerTraces.put({
      sessionId,
      assemblerRuns: [
        { sessionId: 's1', sequence: 1, decision: 'commit', reason: 'commit_rule', latestTranscriptId: 't1', latestTranscriptEndMs: 1000 },
        { bad: 'data' },
        null,
        42,
      ],
      structureUnits: [
        { unitId: 'u1', sessionId: 's1', reason: 'commit_rule', text: 'text' },
        { incomplete: true },
      ],
      savedAt: Date.now(),
    });

    const loaded = await db.assemblerTraces.get(sessionId);
    expect(loaded!.assemblerRuns).toHaveLength(4);
    expect(loaded!.structureUnits).toHaveLength(2);
  });
});

describe('isValidAssemblerRun — 类型校验', () => {
  it('合法数据应通过校验', () => {
    const valid = {
      sessionId: 's1',
      sequence: 1,
      latestTranscriptId: 't1',
      latestTranscriptEndMs: 1000,
      decision: 'commit',
      reason: 'commit_rule',
      bufferTranscriptIds: ['t1'],
      bufferTranscriptCount: 1,
      bufferStartMs: 0,
      bufferEndMs: 1000,
      totalCharCount: 50,
      effectiveCharCount: 40,
      waitMs: 200,
      sawTerminalPunctuation: true,
      sawIncompleteTail: false,
      createdAt: Date.now(),
    };
    expect(isValidAssemblerRun(valid)).toBe(true);
  });

  it('缺少 sessionId 应被过滤', () => {
    expect(isValidAssemblerRun({ sequence: 1, decision: 'wait', reason: 'test' })).toBe(false);
  });

  it('缺少 decision 应被过滤', () => {
    expect(isValidAssemblerRun({ sessionId: 's1', sequence: 1, reason: 'test' })).toBe(false);
  });

  it('null 应被过滤', () => {
    expect(isValidAssemblerRun(null)).toBe(false);
  });

  it('undefined 应被过滤', () => {
    expect(isValidAssemblerRun(undefined)).toBe(false);
  });

  it('数字应被过滤', () => {
    expect(isValidAssemblerRun(42)).toBe(false);
  });

  it('字符串应被过滤', () => {
    expect(isValidAssemblerRun('not an object')).toBe(false);
  });

  it('decision 类型错误应被过滤', () => {
    expect(isValidAssemblerRun({ sessionId: 's1', sequence: 1, decision: 123, reason: 'test' })).toBe(false);
  });

  it('isValidAssemblerRun 应接受含 latestTranscriptText 的记录', () => {
    const run = {
      sessionId: 's1',
      sequence: 1,
      decision: 'wait',
      reason: '等待更多上下文',
      latestTranscriptText: '这是一段测试文本',
    };
    expect(isValidAssemblerRun(run)).toBe(true);
  });
});

describe('isValidStructureUnit — 类型校验', () => {
  it('合法数据应通过校验', () => {
    const valid = {
      unitId: 'u1',
      sessionId: 's1',
      startMs: 0,
      endMs: 1000,
      text: '测试文本',
      sourceChunkIds: ['t1'],
      reason: 'commit_rule',
      createdAt: Date.now(),
    };
    expect(isValidStructureUnit(valid)).toBe(true);
  });

  it('缺少 unitId 应被过滤', () => {
    expect(isValidStructureUnit({ sessionId: 's1', reason: 'test' })).toBe(false);
  });

  it('缺少 sessionId 应被过滤', () => {
    expect(isValidStructureUnit({ unitId: 'u1', reason: 'test' })).toBe(false);
  });

  it('null 应被过滤', () => {
    expect(isValidStructureUnit(null)).toBe(false);
  });

  it('空对象应被过滤', () => {
    expect(isValidStructureUnit({})).toBe(false);
  });
});

describe('getAssemblerTraceForSession — IDB 数据过滤', () => {
  beforeEach(async () => {
    await db.assemblerTraces.clear();
  });

  it('应过滤掉 IDB 中的非法 assemblerRun 条目', async () => {
    const sessionId = 'filter-test';
    await db.assemblerTraces.put({
      sessionId,
      assemblerRuns: [
        { sessionId: 's1', sequence: 1, decision: 'commit', reason: 'ok', latestTranscriptId: 't1', latestTranscriptEndMs: 1000 },
        { bad: true },
        null,
      ],
      structureUnits: [],
      savedAt: Date.now(),
    });

    const record = await db.assemblerTraces.get(sessionId);
    const filtered = record!.assemblerRuns.filter(isValidAssemblerRun);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].decision).toBe('commit');
  });

  it('应过滤掉 IDB 中的非法 structureUnit 条目', async () => {
    const sessionId = 'filter-units-test';
    await db.assemblerTraces.put({
      sessionId,
      assemblerRuns: [],
      structureUnits: [
        { unitId: 'u1', sessionId: 's1', reason: 'commit_rule', text: '合法' },
        { incomplete: true },
        null,
      ],
      savedAt: Date.now(),
    });

    const record = await db.assemblerTraces.get(sessionId);
    const filtered = record!.structureUnits.filter(isValidStructureUnit);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].unitId).toBe('u1');
  });

  it('全部非法数据应被过滤为空数组', async () => {
    const sessionId = 'all-invalid';
    await db.assemblerTraces.put({
      sessionId,
      assemblerRuns: [null, 42, 'string', { bad: true }],
      structureUnits: [null, undefined, {}],
      savedAt: Date.now(),
    });

    const record = await db.assemblerTraces.get(sessionId);
    expect(record!.assemblerRuns.filter(isValidAssemblerRun)).toHaveLength(0);
    expect(record!.structureUnits.filter(isValidStructureUnit)).toHaveLength(0);
  });
});
