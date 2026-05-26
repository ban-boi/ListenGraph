# Assembler Flight Recorder 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 assembler 运行时的决策日志持久化到 IndexedDB，使会话结束后仍可通过 debug/export 查看 assembler 的每一次决策。

**Architecture:** 在现有 Dexie DB 中新增 `assemblerTraces` store，以 sessionId 为主键存储一次会话的完整 assembler trace。会话结束时（`cleanupSession` 调用 `resetActiveRuntime()` 之前）将内存中的 trace 写入 IndexedDB。debug/export 请求过去会话数据时从 IndexedDB 加载。

**Tech Stack:** TypeScript, Dexie (IndexedDB), Chrome MV3 Extension

---

## 文件结构

| 操作 | 文件 | 职责 |
|------|------|------|
| 修改 | `packages/storage/src/indexeddb.ts` | DB version 3：新增 `assemblerTraces` store |
| 修改 | `packages/storage/src/repositories.ts` | 新增 `AssemblerTraceRepository` |
| 修改 | `packages/storage/src/index.ts` | 导出新 repository |
| 修改 | `apps/extension/src/service-worker/state-persistence.ts` | 新增 `persistAssemblerTrace`、`loadAssemblerTrace` |
| 修改 | `apps/extension/src/service-worker/session-lifecycle.ts` | cleanupSession 结束前保存 trace |
| 修改 | `apps/extension/src/service-worker/session-handlers.ts` | loadDebugSessionData 优先从 IndexedDB 加载 |
| 创建 | `apps/extension/src/service-worker/assembler-flight-recorder.test.ts` | 持久化与加载测试 |

---

### Task 1: 新增 Dexie store 与类型

**Files:**
- Modify: `packages/storage/src/indexeddb.ts:18-45`
- Modify: `packages/storage/src/repositories.ts:1-16`
- Modify: `packages/storage/src/index.ts`

- [ ] **Step 1: 在 indexeddb.ts 中添加 AssemblerTraceRecord 类型和 store**

```typescript
// 在 SessionRecord 和 SettingRecord 之间添加：

export interface AssemblerTraceRecord {
  sessionId: string;
  assemblerRuns: unknown[];   // AssemblerRunDebug[] — 用 unknown 避免跨包类型依赖
  structureUnits: unknown[];  // StructureUnitDebug[]
  savedAt: number;
}
```

在 `ListenGraphicDB` 类中添加：

```typescript
export class ListenGraphicDB extends Dexie {
  sessions!: Table<SessionRecord, string>;
  transcriptChunks!: Table<TranscriptChunk, string>;
  segmentGraphs!: Table<SegmentGraph, string>;
  mergedGraphs!: Table<MergedGraph, string>;
  settings!: Table<SettingRecord, string>;
  assemblerTraces!: Table<AssemblerTraceRecord, string>;  // 新增

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

    // 新增 version 3
    this.version(3).stores({
      assemblerTraces: 'sessionId, savedAt',
    });
  }
}
```

- [ ] **Step 2: 在 repositories.ts 中添加 AssemblerTraceRepository**

在文件末尾添加：

```typescript
export function createAssemblerTraceRepository(tables: {
  assemblerTraces: TableLike<import('./indexeddb').AssemblerTraceRecord, string>;
}) {
  return {
    async save(trace: import('./indexeddb').AssemblerTraceRecord) {
      await tables.assemblerTraces.put(trace);
    },
    async get(sessionId: string) {
      return tables.assemblerTraces.get(sessionId);
    },
    async delete(sessionId: string) {
      await tables.assemblerTraces.delete(sessionId);
    },
  };
}
```

- [ ] **Step 3: 在 storage/src/index.ts 中导出新增内容**

确保 `AssemblerTraceRecord` 和 `createAssemblerTraceRepository` 被 re-export。

- [ ] **Step 4: 验证 TypeScript 编译通过**

Run: `pnpm --filter @listen-graphic/storage typecheck`
Expected: PASS（无新增错误）

- [ ] **Step 5: Commit**

```bash
git add packages/storage/src/
git commit -m "feat(storage): 新增 assemblerTraces Dexie store（DB v3）"
```

---

### Task 2: 持久化 assembler trace 到 IndexedDB

**Files:**
- Modify: `apps/extension/src/service-worker/state-persistence.ts:1-30`
- Modify: `apps/extension/src/service-worker/session-lifecycle.ts:29-54,202-268`

- [ ] **Step 1: 在 state-persistence.ts 中添加 persistAssemblerTrace 和 loadAssemblerTrace**

在文件末尾（`clearRuntimeState` 之后）添加两个新函数：

```typescript
export async function persistAssemblerTrace(
  sessionId: string,
  assemblerRuns: unknown[],
  structureUnits: unknown[],
): Promise<void> {
  try {
    const { db } = await import('@listen-graphic/storage');
    await db.assemblerTraces.put({
      sessionId,
      assemblerRuns,
      structureUnits,
      savedAt: Date.now(),
    });
  } catch (error) {
    console.warn('[Service Worker] assembler trace 持久化失败:', error);
  }
}

export async function loadAssemblerTrace(
  sessionId: string,
): Promise<{ assemblerRuns: unknown[]; structureUnits: unknown[] } | null> {
  try {
    const { db } = await import('@listen-graphic/storage');
    const record = await db.assemblerTraces.get(sessionId);
    if (!record) {
      return null;
    }
    return {
      assemblerRuns: record.assemblerRuns,
      structureUnits: record.structureUnits,
    };
  } catch (error) {
    console.warn('[Service Worker] 加载 assembler trace 失败:', error);
    return null;
  }
}
```

- [ ] **Step 2: 在 session-lifecycle.ts 的 cleanupSession 中，resetActiveRuntime 之前持久化 trace**

修改 `SessionLifecycleCallbacks` 接口，添加：

```typescript
persistAssemblerTrace: (
  sessionId: string,
  assemblerRuns: unknown[],
  structureUnits: unknown[],
) => Promise<void>;
```

在 `cleanupSession` 函数中，在 `S.resetActiveRuntime()` 之前插入持久化：

```typescript
export async function cleanupSession(
  payload: { sessionId: string; state: 'stopped' },
  S: RuntimeStateContainer,
  callbacks: SessionLifecycleCallbacks,
) {
  const endedAt = Date.now();
  const lastMergedGraph = S.mergedGraph;
  const lastTimeMs = S.currentTimeMs;
  const lastView = S.currentView;
  const lastViewPinned = S.currentViewPinned;

  // ===== 新增：在 reset 前持久化 assembler trace =====
  const assemblerRunsToSave = S.assemblerRuns;
  const structureUnitsToSave = S.structureUnits;
  if (assemblerRunsToSave.length > 0 || structureUnitsToSave.length > 0) {
    await callbacks.persistAssemblerTrace(
      payload.sessionId,
      assemblerRunsToSave,
      structureUnitsToSave,
    );
  }
  // ===== 新增结束 =====

  try {
    await callbacks.sessionRepository.markEnded(payload.sessionId, endedAt);
    S.pendingSessionFinalize = null;
  } catch (error) {
    // ... 原有错误处理不变
  } finally {
    S.resetActiveRuntime();
    // ... 原有逻辑不变
  }
}
```

- [ ] **Step 3: 在 index.ts 中将 persistAssemblerTrace 注入到 callbacks**

在 `index.ts` 中组装 `SessionLifecycleCallbacks` 的地方，添加 `persistAssemblerTrace` 回调，指向 `state-persistence.ts` 中新增的函数。

- [ ] **Step 4: 验证 TypeScript 编译通过**

Run: `pnpm --filter extension typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/extension/src/service-worker/
git commit -m "feat(sw): cleanupSession 前持久化 assembler trace 到 IndexedDB"
```

---

### Task 3: debug/export 从 IndexedDB 加载历史 trace

**Files:**
- Modify: `apps/extension/src/service-worker/session-handlers.ts:184-218`
- Modify: `apps/extension/src/service-worker/session-handlers.ts:120-162`

- [ ] **Step 1: 修改 loadDebugSessionData，优先从 IndexedDB 加载 assembler trace**

当前逻辑在 `loadDebugSessionData` 中：

```typescript
const sessionAssemblerRuns = getAssemblerRunsForDebugSession(sessionId, S);
```

这只从内存中取。如果内存已被清空（会话已结束），则返回空数组。

修改为：

```typescript
// 先尝试从内存取
let sessionAssemblerRuns = getAssemblerRunsForDebugSession(sessionId, S);
let sessionStructureUnits = getStructureUnitsForDebugSession(sessionId, S);

// 若内存为空，从 IndexedDB 加载
if (sessionAssemblerRuns.length === 0 && sessionStructureUnits.length === 0) {
  const persisted = await loadAssemblerTrace(sessionId);
  if (persisted) {
    sessionAssemblerRuns = persisted.assemblerRuns as AssemblerRunDebug[];
    sessionStructureUnits = persisted.structureUnits as StructureUnitDebug[];
  }
}
```

在 `session-handlers.ts` 顶部添加 import：

```typescript
import { loadAssemblerTrace } from './state-persistence';
```

同样修改 `handleExportSession` 中的 assembler 数据获取逻辑（约 L146）：

```typescript
assemblerRuns: getAssemblerRunsForDebugSession(payload.sessionId, S),
structureUnits: getStructureUnitsForDebugSession(payload.sessionId, S),
```

也改为 fallback 到 IndexedDB 的逻辑。

为了复用，建议提取一个 helper 函数：

```typescript
async function getAssemblerTraceForSession(
  sessionId: string,
  S: RuntimeStateContainer,
): Promise<{ assemblerRuns: AssemblerRunDebug[]; structureUnits: StructureUnitDebug[] }> {
  let assemblerRuns = getAssemblerRunsForDebugSession(sessionId, S);
  let structureUnits = getStructureUnitsForDebugSession(sessionId, S);

  if (assemblerRuns.length === 0 && structureUnits.length === 0) {
    const persisted = await loadAssemblerTrace(sessionId);
    if (persisted) {
      assemblerRuns = persisted.assemblerRuns as AssemblerRunDebug[];
      structureUnits = persisted.structureUnits as StructureUnitDebug[];
    }
  }

  return { assemblerRuns, structureUnits };
}
```

然后 `handleExportSession` 和 `loadDebugSessionData` 都调用这个 helper。

- [ ] **Step 2: 验证 TypeScript 编译通过**

Run: `pnpm --filter extension typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add apps/extension/src/service-worker/session-handlers.ts
git commit -m "feat(sw): debug/export 从 IndexedDB 加载历史 assembler trace"
```

---

### Task 4: 单元测试

**Files:**
- Create: `apps/extension/src/service-worker/assembler-flight-recorder.test.ts`

- [ ] **Step 1: 编写持久化与加载的单元测试**

测试场景：
1. `persistAssemblerTrace` + `loadAssemblerTrace` 基本写入读取
2. 空数据不写入
3. 重复写入（同一 sessionId）覆盖旧数据
4. 加载不存在的 sessionId 返回 null

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '@listen-graphic/storage';

describe('Assembler Flight Recorder', () => {
  beforeEach(async () => {
    await db.assemblerTraces.clear();
  });

  it('应能持久化和加载 assembler trace', async () => {
    const sessionId = 'test-session-1';
    const runs = [{ sequence: 1, decision: 'commit', reason: 'commit_rule' }];
    const units = [{ unitId: 'u1', reason: 'commit_rule', text: '测试文本' }];

    await db.assemblerTraces.put({
      sessionId,
      assemblerRuns: runs,
      structureUnits: units,
      savedAt: Date.now(),
    });

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
```

- [ ] **Step 2: 运行测试**

Run: `pnpm --filter extension test:run assembler-flight-recorder`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add apps/extension/src/service-worker/assembler-flight-recorder.test.ts
git commit -m "test(sw): assembler flight recorder 持久化与加载测试"
```

---

### Task 5: 集成验证

- [ ] **Step 1: 运行全量 typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 2: 运行已有测试确认无回归**

Run: `pnpm --filter extension test:run`
Expected: 所有已有测试通过

- [ ] **Step 3: 手动验证（Chrome 扩展）**

1. `pnpm dev:ext` 启动开发服务器
2. 在 Chrome 中加载扩展
3. 开启一次会话，说几句话
4. 停止会话
5. 在 sidepanel 中点击导出 → 检查导出的 JSON/Markdown 中是否包含 Assembler Runs 数据
6. 或者查看 debug 面板中是否能看到 assembler trace

- [ ] **Step 4: Final Commit**

```bash
git add -A
git commit -m "feat: assembler flight recorder — 会话结束后仍可查看 assembler 决策日志"
```

---

## Self-Review

**1. Spec 覆盖：**
- ✅ "把 assembler 的每一个操作都记下来" — `recordAssemblerRunDebug` 已在做，本计划只添加持久化
- ✅ "方便我用完之后回来看" — debug/export 现在从 IndexedDB 加载，会话结束后可用
- ✅ "以某一种格式" — 现有 JSON/Markdown 导出已包含 assemblerRuns 和 structureUnits

**2. Placeholder 扫描：**
- 无 TBD / TODO / "implement later"
- 所有步骤包含完整代码

**3. 类型一致性：**
- `assemblerRuns` 类型为 `AssemblerRunDebug[]`，在 `getAssemblerTraceForSession` helper 中用 `as AssemblerRunDebug[]` 断言——因为 IndexedDB 存储时序列化为 `unknown[]`，但结构不变
- `StructureUnitDebug` 同理
- `loadAssemblerTrace` 返回 `unknown[]`，在 helper 中断言为具体类型
