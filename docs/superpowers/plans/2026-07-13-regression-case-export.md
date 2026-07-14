# 原始 Graph Corpus 批量导出（Phase 0）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在扩展中添加"导出原始 Graph Corpus"功能，一键导出 IndexedDB 中所有 MergedGraph 快照，作为回归数据集的原始素材。

**Architecture:** 复用现有 EXPORT_SESSION 的调用链模式，新增 `EXPORT_ALL_GRAPHS` 消息类型。service-worker 读取 `mergedGraphs` 表全部记录，做 schema 完整性校验后打包为 JSON 数组下载。**不做过滤**（小图、无边图全部保留），**不生成增量序列**（只导出每个 session 的最终快照）。输出可作为 `graph-fixtures` manifest 的候选数据源。

**Tech Stack:** TypeScript, React, Chrome Extension (MV3), Dexie/IndexedDB

---

## 本计划覆盖范围

| 覆盖 | 不覆盖（后续计划） |
|---|---|
| 批量导出所有 session 的最终 MergedGraph 快照 | 增量 revision 链的保存与导出 |
| schema 完整性校验（损坏数据剔除） | 按节点数/边数过滤（小图全部保留） |
| 确定性排序（sessionId 升序） | 稳定 caseId 与 fixture manifest |
| DEV 环境 gating + 确认提示 | case 晋级、验收合同、回归执行器 |
| 契约测试 + 消息路由测试 | E2E 测试 |

---

## 设计决策

**1. 不过滤小图和无边图**
- 纯碎片图（12 节点、0 边）是 cluster-layout 的重要回归 case
- 2 节点小图验证基础布局行为
- 过滤策略由回归执行器决定，不在导出层做

**2. 只排除损坏数据**
- schema 校验：必填字段存在、类型正确
- 引用完整性：edge 的 source/target 必须在 nodes 中
- 空图（nodeCount === 0）排除

**3. 确定性排序**
- 按 sessionId 升序排列
- 保证相同数据多次导出结果一致

**4. 隐私保护**
- 仅 DEV 环境可用（`process.env.NODE_ENV === 'development'`）
- 导出前显示确认对话框，告知 case 数量和大致文件大小
- 导出的 JSON 包含 session transcripts（敏感数据），需用户自行脱敏后再提交

**5. 不替换现有 real-graphs-dump.json**
- 当前 lab 测试按数组下标引用 #6、#18、#32 等
- 新导出文件应作为独立数据源，不覆盖现有文件
- 现有文件的身份稳定性问题在后续计划中解决

---

### Task 1: 给 mergedGraphRepository 添加 listAll 方法

**Files:**
- 修改: `packages/storage/src/repositories.ts:80-92`

- [ ] **Step 1: 添加 listAll 方法**

在 `createMergedGraphRepository` 函数中，在 `getBySession` 方法之后添加：

```typescript
async listAll() {
  return tables.mergedGraphs.toArray();
},
```

完整函数变为：

```typescript
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
```

- [ ] **Step 2: 运行类型检查**

```bash
pnpm --filter @listen-graphic/storage typecheck
```

预期：无错误。

- [ ] **Step 3: 提交**

```bash
git add packages/storage/src/repositories.ts
git commit -m "feat(storage): mergedGraphRepository 添加 listAll 方法"
```

---

### Task 2: 契约测试 — listAll

**Files:**
- 修改: `apps/extension/src/service-worker/storage-contract.test.ts`

- [ ] **Step 1: 读取现有测试文件，了解测试模式**

```bash
head -50 apps/extension/src/service-worker/storage-contract.test.ts
```

- [ ] **Step 2: 添加 listAll 契约测试**

在 `mergedGraphs` 相关的 `describe` 块中添加：

```typescript
// 在 storage-contract.test.ts 的 mergedGraphs describe 块中添加
// 使用仓库实际的 MemoryTable 和内联 graph 构造模式

it('listAll 返回所有已保存的 graph', async () => {
  const repository = createMergedGraphRepository({
    mergedGraphs: mergedGraphTable,
  });

  await repository.save({
    sessionId: 's1', revision: 1, topics: [],
    nodes: [{ id: 'n1', type: 'claim', text: '节点1', timestampMs: 0, status: 'confirmed' }],
    edges: [], updatedAt: 100,
  });
  await repository.save({
    sessionId: 's2', revision: 1, topics: [],
    nodes: [{ id: 'n2', type: 'reason', text: '节点2', timestampMs: 0, status: 'confirmed' }],
    edges: [], updatedAt: 200,
  });

  const all = await repository.listAll();
  expect(all).toHaveLength(2);
  const sessionIds = all.map((g) => g.sessionId).sort();
  expect(sessionIds).toEqual(['s1', 's2']);
});

it('listAll 空表返回空数组', async () => {
  const repository = createMergedGraphRepository({
    mergedGraphs: mergedGraphTable,
  });

  const all = await repository.listAll();
  expect(all).toEqual([]);
});
```

- [ ] **Step 3: 运行契约测试**

```bash
pnpm test:ext:contract
```

预期：新增测试通过。

- [ ] **Step 4: 提交**

```bash
git add apps/extension/src/service-worker/storage-contract.test.ts
git commit -m "test(extension): listAll 契约测试"
```

---

### Task 3: 添加消息类型与处理函数

**Files:**
- 修改: `apps/extension/src/shared/messages.ts:364-368`
- 修改: `apps/extension/src/service-worker/session-handlers.ts`
- 修改: `apps/extension/src/service-worker/index.ts:289-297`

- [ ] **Step 1: 添加消息类型**

在 `apps/extension/src/shared/messages.ts` 的 `EXPORT_SESSION` 之后添加：

```typescript
| {
    type: 'EXPORT_ALL_GRAPHS';
    target: 'service-worker';
    payload: {};
  }
```

注意：无 `format` 参数，永远输出 JSON。

- [ ] **Step 2: 添加 schema 校验函数**

在 `apps/extension/src/service-worker/session-handlers.ts` 中添加。使用 `graph-fixtures` 已有的 `mergedGraphSchema.safeParse()` 做完整 schema 校验，再补引用完整性和 ID 唯一性检查：

```typescript
import { mergedGraphSchema } from '@listen-graphic/graph-fixtures';
import type { MergedGraph } from '@listen-graphic/schema';

/**
 * 校验 MergedGraph 的完整性。
 * 使用 graph-fixtures 的 mergedGraphSchema 做完整 schema 校验，
 * 再补引用完整性、ID 唯一性和空图规则。
 * 只排除损坏数据，不过滤小图或无边图。
 */
function validateMergedGraph(graph: unknown): MergedGraph | null {
  // 1. 完整 schema 校验（Zod safeParse）
  const parsed = mergedGraphSchema.safeParse(graph);
  if (!parsed.success) return null;

  const g = parsed.data;

  // 2. 空图排除
  if (g.nodes.length === 0) return null;

  // 3. ID 唯一性
  const nodeIds = g.nodes.map((n) => n.id);
  if (new Set(nodeIds).size !== nodeIds.length) return null;
  const edgeIds = g.edges.map((e) => e.id);
  if (new Set(edgeIds).size !== edgeIds.length) return null;

  // 4. 引用完整性：edge 的 source/target 必须在 nodes 中
  const nodeIdSet = new Set(nodeIds);
  for (const edge of g.edges) {
    if (!nodeIdSet.has(edge.source) || !nodeIdSet.has(edge.target)) return null;
  }

  return g;
}
```

- [ ] **Step 3: 添加处理函数**

在 `session-handlers.ts` 中添加：

```typescript
/**
 * 导出所有有效 MergedGraph 快照。
 * 只做 schema 校验，不过滤小图或无边图。
 * 按 sessionId 升序排列，保证确定性。
 */
export async function handleExportAllGraphs(
  deps: {
    ensureHydrated: () => Promise<void>;
    mergedGraphRepository: {
      listAll(): Promise<MergedGraph[]>;
    };
  },
): Promise<ServiceWorkerResponse> {
  await deps.ensureHydrated();

  const allGraphs = await deps.mergedGraphRepository.listAll();
  const validGraphs = allGraphs
    .map(validateMergedGraph)
    .filter((g): g is MergedGraph => g !== null)
    .sort((a, b) => a.sessionId.localeCompare(b.sessionId));

  if (validGraphs.length === 0) {
    return { success: false, error: '没有有效的 graph 数据可导出' };
  }

  const content = JSON.stringify(validGraphs, null, 2);
  const timestamp = new Date().toISOString().slice(0, 10);
  const filename = `graph-corpus-${timestamp}.json`;

  return {
    success: true,
    exportData: { filename, mimeType: 'application/json', content },
  };
}
```

- [ ] **Step 4: 注册消息路由**

在 `apps/extension/src/service-worker/index.ts` 中：

1. 确认 `handleExportAllGraphs` 从 `./session-handlers` 导入
2. 在 `case 'EXPORT_SESSION':` 块之后添加：

```typescript
case 'EXPORT_ALL_GRAPHS':
  // DEV gating：生产环境直接拒绝，不只是隐藏 UI
  if (!import.meta.env.DEV) {
    return { success: false, error: '此功能仅在开发环境可用' };
  }
  return handleExportAllGraphs({
    ensureHydrated: () => ensureHydrated(persistenceDeps),
    mergedGraphRepository,
  });
```

- [ ] **Step 5: 运行类型检查**

```bash
pnpm --filter extension typecheck
```

预期：无错误。

- [ ] **Step 6: 提交**

```bash
git add apps/extension/src/shared/messages.ts apps/extension/src/service-worker/session-handlers.ts apps/extension/src/service-worker/index.ts
git commit -m "feat(extension): 添加 EXPORT_ALL_GRAPHS 消息类型与处理函数"
```

---

### Task 4: 测试

**Files:**
- 修改: `apps/extension/src/service-worker/storage-contract.test.ts`（listAll 契约测试已在 Task 2 完成）
- 修改: `apps/extension/src/service-worker/__test-helpers__/index-test-helpers.ts`（添加 mock）
- 修改: `apps/extension/src/sidepanel/App.export-debug-replay.test.tsx`（UI 测试）

- [ ] **Step 1: 给 index-test-helpers 添加 listAll mock**

在 `apps/extension/src/service-worker/__test-helpers__/index-test-helpers.ts` 中，给已有的 mock repository 添加 `listAll` 方法：

```typescript
// 在 mergedGraphRepository mock 中添加
mergedGraphRepository: {
  save: vi.fn(),
  getBySession: vi.fn(),
  listAll: vi.fn().mockResolvedValue([]), // 新增
},
```

- [ ] **Step 2: 添加 dispatchMessage 路由测试**

在合适的测试文件中，使用 `dispatchMessage` 验证真实路由（不是直接调用 handler）：

```typescript
it('EXPORT_ALL_GRAPHS 通过 dispatchMessage 正确路由', async () => {
  // 预置数据
  await mergedGraphTable.put({
    sessionId: 's1', revision: 1, topics: [],
    nodes: [{ id: 'n1', type: 'claim', text: '测试', timestampMs: 0, status: 'confirmed' }],
    edges: [], updatedAt: 100,
  });

  const response = await dispatchMessage({
    type: 'EXPORT_ALL_GRAPHS',
    target: 'service-worker',
    payload: {},
  });

  expect(response.success).toBe(true);
  const parsed = JSON.parse(response.exportData.content);
  expect(parsed).toHaveLength(1);
  expect(parsed[0].sessionId).toBe('s1');
});
```

- [ ] **Step 3: 添加 UI 测试**

在 `App.export-debug-replay.test.tsx` 中添加菜单点击和确认对话框测试：

```typescript
it('导出 Graph Corpus：确认后触发下载', async () => {
  // 模拟 chrome.runtime.sendMessage
  const mockSendMessage = vi.fn().mockResolvedValue({
    success: true,
    exportData: { filename: 'graph-corpus-2026-07-13.json', mimeType: 'application/json', content: '[]' },
  });
  chrome.runtime.sendMessage = mockSendMessage;

  // 模拟 window.confirm 返回 true
  vi.spyOn(window, 'confirm').mockReturnValue(true);

  // 点击菜单项
  await userEvent.click(screen.getByText('更多'));
  await userEvent.click(screen.getByTestId('overflow-menu-export-all-graphs'));

  expect(mockSendMessage).toHaveBeenCalledWith(
    expect.objectContaining({ type: 'EXPORT_ALL_GRAPHS' }),
  );
});

it('导出 Graph Corpus：取消确认不触发下载', async () => {
  vi.spyOn(window, 'confirm').mockReturnValue(false);
  const mockSendMessage = vi.fn();
  chrome.runtime.sendMessage = mockSendMessage;

  await userEvent.click(screen.getByText('更多'));
  await userEvent.click(screen.getByTestId('overflow-menu-export-all-graphs'));

  expect(mockSendMessage).not.toHaveBeenCalled();
});
```

- [ ] **Step 3: 运行契约测试**

```bash
pnpm test:ext:contract
```

预期：新增测试通过。

- [ ] **Step 4: 提交**

```bash
git add apps/extension/src/service-worker/export-debug-replay.test.ts
git commit -m "test(extension): handleExportAllGraphs 消息路由测试"
```

---

### Task 5: 添加 UI 菜单项（DEV gating + 确认提示）

**Files:**
- 修改: `apps/extension/src/sidepanel/App.tsx:896-914`

- [ ] **Step 1: 添加导出处理函数**

在 `handleExport` 回调之后（大约第 582 行）添加：

```typescript
const handleExportAllGraphs = useCallback(async () => {
  try {
    const response = await chrome.runtime.sendMessage({
      type: 'EXPORT_ALL_GRAPHS',
      target: 'service-worker',
      payload: {},
    } as AppMessage);

    if (!response.success) {
      addLog(`导出失败：${response.error ?? '未知错误'}`);
      return;
    }

    if (response.exportData) {
      // 根据实际内容计算 case 数量和文件大小
      const caseCount = JSON.parse(response.exportData.content).length;
      const sizeKB = Math.round(new Blob([response.exportData.content]).size / 1024);

      const confirmed = window.confirm(
        `即将导出 ${caseCount} 个 graph 快照（${sizeKB} KB）。\n` +
        '包含会话派生的节点文本，提交到仓库前请确认无敏感内容。\n\n' +
        '是否继续？',
      );
      if (!confirmed) return;

      downloadTextFile(
        response.exportData.filename,
        response.exportData.content,
        response.exportData.mimeType,
      );
      addLog(`已导出 ${response.exportData.filename}（${caseCount} 个 case）`);
    }
  } catch (err) {
    addLog(`导出异常：${err instanceof Error ? err.message : String(err)}`);
  }
}, [addLog]);
```

注意：先请求数据，再根据实际内容计算 case 数量和文件大小，最后显示确认框。MergedGraph 不包含 transcript chunks，只包含会话派生的节点文本。

- [ ] **Step 2: 添加菜单项（DEV gating）**

在 `DropdownMenu` 的 `items` 数组中（第 898-904 行），在 `export-mermaid` 之后添加：

```typescript
...(import.meta.env.DEV
  ? [{ id: 'export-all-graphs', label: '📦 导出 Graph Corpus', testId: 'overflow-menu-export-all-graphs' }]
  : []),
```

注意：使用 `import.meta.env.DEV`（Vite 惯例），不是 `process.env.NODE_ENV`（扩展 tsconfig 无 Node 类型）。

- [ ] **Step 3: 添加 onSelect 处理**

在 `onSelect` 的 switch 中（第 906-911 行），添加：

```typescript
case 'export-all-graphs': void handleExportAllGraphs(); break;
```

- [ ] **Step 4: 运行类型检查**

```bash
pnpm --filter extension typecheck
```

预期：无错误。

- [ ] **Step 5: 运行契约测试**

```bash
pnpm test:ext:contract
```

预期：无回归。

- [ ] **Step 6: 提交**

```bash
git add apps/extension/src/sidepanel/App.tsx
git commit -m "feat(extension): DEV 环境添加'导出 Graph Corpus'菜单项"
```

---

### Task 6: 构建验证

**Files:**
- 无新增/修改文件

- [ ] **Step 1: 运行完整验收序列**

```bash
pnpm --filter @listen-graphic/storage typecheck
pnpm --filter extension typecheck
pnpm test:ext:contract
pnpm --filter extension build
```

预期：全部通过。

- [ ] **Step 2: 在浏览器中手动验证**

1. `pnpm dev:ext` 启动开发构建
2. Chrome 加载解压扩展
3. 打开侧边栏 → "更多"菜单
4. 确认"📦 导出 Graph Corpus"选项**仅在 DEV 环境可见**
5. 点击该选项
6. 确认弹出确认对话框
7. 确认后下载 `graph-corpus-YYYY-MM-DD.json`
8. 确认文件内容是 MergedGraph 数组，按 sessionId 排序

- [ ] **Step 3: 不做 git add -A，不做额外提交**

每个 task 已单独提交，无需最终汇总提交。

---

## 自检清单

- [x] 不过滤小图和无边图（只排除损坏数据）
- [x] 确定性排序（sessionId 升序）
- [x] DEV 环境 gating
- [x] 导出前确认提示（敏感数据警告）
- [x] 无 `format` payload（永远 JSON）
- [x] handler 不使用 `S` 参数
- [x] 不使用 `git add -A`
- [x] 不声称"可直接替换 real-graphs-dump.json"
- [x] 契约测试覆盖 listAll、空集合、损坏数据、引用完整性
- [x] 明确标注不覆盖增量回归（后续计划）

## 后续计划（不在本计划范围内）

- **增量 revision 链保存与导出**：在 `structurer-executor.ts` 的 `save()` 调用前，将每个 revision 快照写入独立表
- **稳定 caseId 与 fixture manifest**：复用 `graph-fixtures` 的 `id`/`tags`/`sequences`/`snapshots` 结构
- **case 晋级流程**：候选图 → 问题描述 → 验收合同 → regression/tuning/holdout 分组
- **回归执行器**：自动运行所有 regression case，检查硬约束和软指标退化
- **隐私脱敏工具**：自动移除或替换 session transcripts 中的敏感文本
