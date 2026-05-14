import { describe, it, expect } from 'vitest';
import { buildAssemblerLogPayload } from './debug-export-utils';
import type { AssemblerRunDebug, StructureUnitDebug } from '../shared/messages';

function makeRun(overrides: Partial<AssemblerRunDebug> & { sequence: number; decision: AssemblerRunDebug['decision']; reason: string }): AssemblerRunDebug {
  return {
    sessionId: 's1',
    latestTranscriptId: 't1',
    latestTranscriptEndMs: 1000,
    latestTranscriptText: '测试文本',
    bufferTranscriptIds: ['t1'],
    bufferTranscriptCount: 1,
    bufferStartMs: 800,
    bufferEndMs: 1000,
    totalCharCount: 4,
    effectiveCharCount: 4,
    waitMs: 200,
    sawTerminalPunctuation: false,
    sawIncompleteTail: false,
    createdAt: Date.now(),
    ...overrides,
  };
}

function makeUnit(overrides: Partial<StructureUnitDebug>): StructureUnitDebug {
  return {
    unitId: 'u1',
    sessionId: 's1',
    startMs: 800,
    endMs: 1000,
    text: '合并后的文本',
    sourceChunkIds: ['t1'],
    reason: 'commit_rule',
    createdAt: Date.now(),
    ...overrides,
  };
}

describe('buildAssemblerLogPayload', () => {
  it('应转换空数据', () => {
    const result = buildAssemblerLogPayload({
      assemblerRuns: [],
      structureUnits: [],
      sessionId: 's1',
      traceSource: 'empty',
    });

    expect(result.schemaVersion).toBe(1);
    expect(result.meta.sessionId).toBe('s1');
    expect(result.meta.traceSource).toBe('empty');
    expect(result.runs).toEqual([]);
    expect(result.units).toEqual([]);
    expect(result.summary.totalRuns).toBe(0);
    expect(result.summary.totalUnits).toBe(0);
  });

  it('应正确转换 runs 和 units', () => {
    const result = buildAssemblerLogPayload({
      assemblerRuns: [
        makeRun({ sequence: 1, decision: 'wait', reason: '等待更多上下文' }),
        makeRun({ sequence: 2, decision: 'commit', reason: 'commit_rule', score: 4 }),
        makeRun({ sequence: 3, decision: 'skip_current', reason: '跳过低信息量' }),
      ],
      structureUnits: [
        makeUnit({ text: '第一句\n第二句', reason: 'commit_rule' }),
      ],
      sessionId: 's1',
      traceSource: 'memory',
    });

    expect(result.runs).toHaveLength(3);
    expect(result.units).toHaveLength(1);

    expect(result.runs[0]).toEqual({
      seq: 1,
      triggerText: '测试文本',
      decision: 'wait',
      reason: '等待更多上下文',
      score: null,
    });
    expect(result.runs[1]!.score).toBe(4);
    expect(result.runs[2]!.decision).toBe('skip_current');

    expect(result.units[0]).toEqual({
      text: '第一句\n第二句',
      reason: 'commit_rule',
    });
  });

  it('应正确统计 summary', () => {
    const result = buildAssemblerLogPayload({
      assemblerRuns: [
        makeRun({ sequence: 1, decision: 'wait', reason: '等待' }),
        makeRun({ sequence: 2, decision: 'wait', reason: '等待' }),
        makeRun({ sequence: 3, decision: 'commit', reason: 'commit_rule', score: 3 }),
        makeRun({ sequence: 4, decision: 'commit', reason: 'commit_timeout' }),
        makeRun({ sequence: 5, decision: 'skip_current', reason: '跳过' }),
      ],
      structureUnits: [makeUnit({}), makeUnit({ unitId: 'u2' })],
      sessionId: 's1',
      traceSource: 'memory',
    });

    expect(result.summary.totalRuns).toBe(5);
    expect(result.summary.decisions).toEqual({ wait: 2, commit: 2, skip_current: 1 });
    expect(result.summary.totalUnits).toBe(2);
    expect(result.summary.commitReasons).toEqual({ commit_rule: 1, commit_timeout: 1 });
  });

  it('缺少 latestTranscriptText 时应回退为空字符串', () => {
    const run = makeRun({ sequence: 1, decision: 'wait', reason: '等待' });
    delete (run as any).latestTranscriptText;

    const result = buildAssemblerLogPayload({
      assemblerRuns: [run],
      structureUnits: [],
      sessionId: 's1',
      traceSource: 'memory',
    });

    expect(result.runs[0]!.triggerText).toBe('');
  });
});
