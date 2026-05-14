# Assembler Decision Log 独立导出 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 DebugPanel 新增按钮，导出紧凑 JSON 格式的 assembler 决策日志，用于会后复盘。

**Architecture:** 复用现有 `debugData`（已通过 `GET_DEBUG_SESSION` 获取），在 sidepanel 本地完成数据转换和下载，无需新增 SW 消息类型。仅在 `AssemblerRunDebug` 新增 `latestTranscriptText` 字段以支持 `triggerText` 输出。

**Tech Stack:** TypeScript, React, Vitest, Testing Library

**Design doc:** `docs/superpowers/specs/2026-05-14-assembler-decision-log-export-design.md`

---

## 与 spec 的偏差

Spec 原定新增 `EXPORT_ASSEMBLER_LOG` / `EXPORT_ASSEMBLER_LOG_RESULT` 消息类型。经代码分析发现 `debugData` 已包含 assembler trace 数据（通过 `GET_DEBUG_SESSION` 获取），无需额外 SW 通信。直接在 sidepanel 本地转换即可，与现有 `handleExportDebug` 模式一致。

---

## Task 1: AssemblerRunDebug 新增 `latestTranscriptText` 字段

**Files:**
- Modify: `apps/extension/src/shared/messages.ts:199`（`AssemblerRunDebug` 接口）
- Modify: `apps/extension/src/service-worker/assembler-machine.ts:345`（`recordAssemblerRunDebug()`）
- Test: `apps/extension/src/service-worker/assembler-flight-recorder.test.ts`

- [ ] **Step 1: 在 `AssemblerRunDebug` 接口新增字段**

在 `messages.ts` 的 `AssemblerRunDebug` 接口中，`latestTranscriptEndMs` 字段之后新增：

```typescript
  /** 触发本次决策的转写文本 */
  latestTranscriptText: string;
```

- [ ] **Step 2: 在 `recordAssemblerRunDebug()` 中填充该字段**

在 `assembler-machine.ts` 的 `recordAssemblerRunDebug()` 函数中，构造对象时新增：

```typescript
      latestTranscriptText: params.transcript.text,
```

位置在 `latestTranscriptEndMs` 之后。

- [ ] **Step 3: 编写测试**

在 `assembler-flight-recorder.test.ts` 中新增测试用例：

```typescript
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
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd apps/extension && pnpm test:run -- assembler-flight-recorder`
Expected: PASS

- [ ] **Step 5: Commit**

```
feat(sw): AssemblerRunDebug 新增 latestTranscriptText 字段
```

---

## Task 2: 实现 `buildAssemblerLogPayload()` 转换函数

**Files:**
- Modify: `apps/extension/src/sidepanel/debug-export-utils.ts`
- Test: `apps/extension/src/sidepanel/debug-export-utils.test.ts`（新建或追加）

- [ ] **Step 1: 定义导出类型接口**

在 `debug-export-utils.ts` 中新增类型（或放 `messages.ts`，但此类型仅 sidepanel 使用，放在 utils 文件即可）：

```typescript
export interface AssemblerDecisionLogRun {
  seq: number;
  triggerText: string;
  decision: 'skip_current' | 'wait' | 'commit';
  reason: string;
  score: number | null;
}

export interface AssemblerDecisionLogUnit {
  text: string;
  reason: string;
}

export interface AssemblerDecisionLogExport {
  schemaVersion: 1;
  meta: {
    exportedAt: string;
    sessionId: string;
    traceSource: 'memory' | 'indexeddb' | 'empty';
  };
  summary: {
    totalRuns: number;
    decisions: Record<string, number>;
    totalUnits: number;
    commitReasons: Record<string, number>;
  };
  runs: AssemblerDecisionLogRun[];
  units: AssemblerDecisionLogUnit[];
}
```

- [ ] **Step 2: 实现 `buildAssemblerLogPayload()` 函数**

在 `debug-export-utils.ts` 中新增：

```typescript
export function buildAssemblerLogPayload(params: {
  assemblerRuns: AssemblerRunDebug[];
  structureUnits: StructureUnitDebug[];
  sessionId: string;
  traceSource: 'memory' | 'indexeddb' | 'empty';
}): AssemblerDecisionLogExport {
  const { assemblerRuns, structureUnits, sessionId, traceSource } = params;

  const runs: AssemblerDecisionLogRun[] = assemblerRuns.map((run) => ({
    seq: run.sequence,
    triggerText: run.latestTranscriptText ?? '',
    decision: run.decision,
    reason: run.reason,
    score: run.score ?? null,
  }));

  const units: AssemblerDecisionLogUnit[] = structureUnits.map((unit) => ({
    text: unit.text,
    reason: unit.reason,
  }));

  const decisions: Record<string, number> = {};
  for (const run of assemblerRuns) {
    decisions[run.decision] = (decisions[run.decision] ?? 0) + 1;
  }

  const commitReasons: Record<string, number> = {};
  for (const run of assemblerRuns) {
    if (run.decision === 'commit') {
      commitReasons[run.reason] = (commitReasons[run.reason] ?? 0) + 1;
    }
  }

  return {
    schemaVersion: 1,
    meta: {
      exportedAt: new Date().toISOString(),
      sessionId,
      traceSource,
    },
    summary: {
      totalRuns: assemblerRuns.length,
      decisions,
      totalUnits: structureUnits.length,
      commitReasons,
    },
    runs,
    units,
  };
}
```

- [ ] **Step 3: 编写单元测试**

新建或追加 `apps/extension/src/sidepanel/debug-export-utils.test.ts`（检查是否已存在测试文件，如存在则追加）：

```typescript
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
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd apps/extension && pnpm test:run -- debug-export-utils`
Expected: PASS

- [ ] **Step 5: Commit**

```
feat(sidepanel): 新增 buildAssemblerLogPayload 转换函数
```

---

## Task 3: DebugPanel 新增导出按钮

**Files:**
- Modify: `apps/extension/src/sidepanel/DebugPanel.tsx`

- [ ] **Step 1: 扩展 `DebugPanelProps` 新增回调**

在 `DebugPanel.tsx` 的 `DebugPanelProps` 中新增：

```typescript
  onExportAssemblerLog: () => void;
```

在解构参数中新增 `onExportAssemblerLog`。

- [ ] **Step 2: 新增按钮 UI**

在「导出完整调试包」按钮之后、`</div>` 之前新增按钮：

```tsx
        <button
          data-testid="debug-export-assembler-button"
          type="button"
          onClick={onExportAssemblerLog}
          disabled={!debugData?.assemblerRuns?.length}
          style={{
            padding: '2px 8px',
            borderRadius: 4,
            border: '1px solid #cbd5e1',
            backgroundColor: debugData?.assemblerRuns?.length ? 'white' : '#e2e8f0',
            color: '#334155',
            fontSize: 11,
            cursor: debugData?.assemblerRuns?.length ? 'pointer' : 'not-allowed',
          }}
        >
          导出 Assembler 日志
        </button>
```

- [ ] **Step 3: 运行类型检查**

Run: `cd apps/extension && pnpm tsc --noEmit`
Expected: 无新增错误（`onExportAssemblerLog` 在调用处传入前会报错，此步骤仅确认 DebugPanel 自身类型正确）

- [ ] **Step 4: Commit**

```
feat(sidepanel): DebugPanel 新增导出 Assembler 日志按钮
```

---

## Task 4: App.tsx 连接 handler 与按钮

**Files:**
- Modify: `apps/extension/src/sidepanel/App.tsx`

- [ ] **Step 1: 新增 `handleExportAssemblerLog` 回调**

在 `App.tsx` 中 `handleExportDebug` 之后新增：

```typescript
  const handleExportAssemblerLog = useCallback(
    () => {
      const runs = debugData?.assemblerRuns ?? [];
      const units = debugData?.structureUnits ?? [];
      if (!runs.length && !units.length) {
        addLog('assembler 决策数据为空，无法导出');
        return;
      }
      const debugSessionId = debugData?.session?.sessionId ?? exportSessionId ?? 'listen-graphic';
      const traceSource = debugData?.traceSource ?? 'empty';
      const payload = buildAssemblerLogPayload({
        assemblerRuns: runs,
        structureUnits: units,
        sessionId: debugSessionId,
        traceSource,
      });
      const filename = `${debugSessionId}-assembler-log.json`;
      downloadTextFile(filename, JSON.stringify(payload, null, 2), 'application/json');
      addLog(`已导出: ${filename}`);
    },
    [addLog, debugData, exportSessionId],
  );
```

确保在文件顶部 import 中已有 `buildAssemblerLogPayload` 和 `downloadTextFile`（`downloadTextFile` 已有 import，`buildAssemblerLogPayload` 需新增）。

- [ ] **Step 2: 将回调传递给 DebugPanel**

修改 DebugPanel 调用处，新增 `onExportAssemblerLog` prop：

```tsx
          <DebugPanel debugData={debugData} sessionId={exportSessionId}
            onExportDebug={handleExportDebug}
            onExportAssemblerLog={handleExportAssemblerLog} />
```

- [ ] **Step 3: 运行类型检查确认无错误**

Run: `cd apps/extension && pnpm tsc --noEmit`
Expected: PASS（无类型错误）

- [ ] **Step 4: Commit**

```
feat(sidepanel): 连接 Assembler 日志导出按钮与转换逻辑
```

---

## Task 5: 集成测试

**Files:**
- Modify: `apps/extension/src/sidepanel/App.export-debug-replay.test.tsx`

- [ ] **Step 1: 编写集成测试**

在 `App.export-debug-replay.test.tsx` 中新增测试用例。在 `GET_DEBUG_SESSION` 的 mock 响应中确保 `assemblerRuns` 包含数据（如已有可复用），然后新增测试：

```typescript
  it('调试面板支持导出 Assembler 决策日志', async () => {
    const { unmount } = renderApp();
    const user = userEvent.setup();

    // 展开调试面板
    const toggle = await screen.findByTestId('debug-toggle');
    await user.click(toggle);

    // 等待 debug 数据加载
    await waitFor(() => {
      expect(screen.getByTestId('debug-panel')).toBeDefined();
    });

    // 点击导出 Assembler 日志按钮
    const assemblerButton = await screen.findByTestId('debug-export-assembler-button');
    expect(assemblerButton).not.toBeDisabled();
    await user.click(assemblerButton);

    // 验证下载被触发
    await waitFor(() => {
      expect(anchorClickSpy).toHaveBeenCalled();
    });

    const createCall = createObjectURLSpy.mock.calls[createObjectURLSpy.mock.calls.length - 1];
    const blob = createCall?.[0] as Blob;
    expect(blob.type).toBe('application/json');

    // 解析下载内容
    const url = createObjectURLSpy.mock.results[createObjectURLSpy.mock.results.length - 1]?.value;
    expect(url).toContain('blob:');

    unmount();
  });
```

注意：此测试依赖现有 `setupAppTests` 中的 mock 配置。`GET_DEBUG_SESSION` 的 mock 需要返回 `assemblerRuns` 数据。如果现有 mock 中 `assemblerRuns` 为空数组，需在对应 mock 中添加测试数据。

- [ ] **Step 2: 运行测试确认通过**

Run: `cd apps/extension && pnpm test:run -- export-debug-replay`
Expected: PASS

- [ ] **Step 3: 运行全部测试确认无回归**

Run: `cd apps/extension && pnpm test:run`
Expected: 全部 PASS

- [ ] **Step 4: Commit**

```
test(sidepanel): 新增 Assembler 日志导出集成测试
```
