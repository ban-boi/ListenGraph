# 两阶段自动导览修复计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 two-stage auto-tour 实现中的 typecheck 阻塞、队列语义缺陷和遗漏项，确保可以安全合入。

**Architecture:** 最小化改动 — 恢复误删类型、修正队列从 revision 检查改为 nodeIds 存在性检查、补充强队列测试、添加 pending seed cooldown 重试。

**Tech Stack:** TypeScript, React, Vitest, React Flow v11

---

## 需修复的问题清单

| # | 严重性 | 问题 | 所在文件 |
|---|--------|------|----------|
| 1 | 阻塞 | `EdgePriority` 被误删，`constants.ts` 引用报错 | `types.ts`, `constants.ts` |
| 2 | 阻塞 | `view-mapping.test.ts` HYDRATE_SNAPSHOT 缺 `providerSummary` | `view-mapping.test.ts` |
| 3 | 功能 | 队列 revision 检查导致旧 seed 被丢弃 | `useAutoTour.ts` |
| 4 | 建议 | pending seed 在 cooldown 后无重试 | `useAutoTour.ts` |
| 5 | 杂项 | `.superpowers/` 未在 `.gitignore` 覆盖 | `.gitignore` |

## 涉及文件

| 文件 | 操作 | 说明 |
|------|------|------|
| `apps/extension/src/sidepanel/types.ts` | 修改 | 恢复 `EdgePriority` 类型导出 |
| `apps/extension/src/sidepanel/view-mapping.test.ts` | 修改 | 补充 `providerSummary` fixture |
| `apps/extension/src/sidepanel/hooks/useAutoTour.ts` | 修改 | 队列语义修复 + cooldown 重试 |
| `apps/extension/src/sidepanel/App.graph-updates.test.tsx` | 修改 | 增强 3 轮队列测试 |
| `.gitignore` | 修改 | 添加 `.superpowers/` |

---

### Task 1: 修复 typecheck 阻塞

**Files:**
- Modify: `apps/extension/src/sidepanel/types.ts:86-89` 附近
- Modify: `apps/extension/src/sidepanel/view-mapping.test.ts:18-45`

- [ ] **Step 1: 恢复 EdgePriority 类型**

在 `apps/extension/src/sidepanel/types.ts` 的 `EdgeHandleId` 定义之前（约 line 87 之前）添加：

```typescript
export type EdgePriority = 'primary' | 'secondary' | 'hidden';
```

- [ ] **Step 2: 补充 view-mapping.test.ts 的 providerSummary**

在 `apps/extension/src/sidepanel/view-mapping.test.ts` 顶部（`describe` 之前）添加最小 fixture：

```typescript
const MINIMAL_PROVIDER_SUMMARY = {
  asr: { type: 'mock', mode: 'direct' as const, apiKeyConfigured: false, sessionTokenConfigured: false },
  structurer: { type: 'mock', mode: 'direct' as const, apiKeyConfigured: false, sessionTokenConfigured: false },
};
```

在两个 HYDRATE_SNAPSHOT 的 payload 中添加 `providerSummary: MINIMAL_PROVIDER_SUMMARY`。

第一个测试（line 33-43）payload 改为：

```typescript
const action: PanelAction = {
  type: 'HYDRATE_SNAPSHOT',
  payload: {
    sessionId: 'test',
    state: 'idle',
    graph: makeGraph('timeline'),
    currentTimeMs: 0,
    preferredView: 'timeline',
    providerSummary: MINIMAL_PROVIDER_SUMMARY,
  },
};
```

第四个测试（line 65-80）循环体中的 payload 改为：

```typescript
const action: PanelAction = {
  type: 'HYDRATE_SNAPSHOT',
  payload: {
    sessionId: 'test',
    state: 'idle',
    graph: makeGraph(view),
    currentTimeMs: 0,
    preferredView: view,
    providerSummary: MINIMAL_PROVIDER_SUMMARY,
  },
};
```

- [ ] **Step 3: 运行 typecheck 验证**

```bash
pnpm --filter extension typecheck
```

Expected: 0 errors

---

### Task 2: 编写更强的队列测试（TDD RED）

**Files:**
- Modify: `apps/extension/src/sidepanel/App.graph-updates.test.tsx`

在现有队列测试 `'连续图更新会排队播放而不是合并成一轮'` 之后添加新测试。

- [ ] **Step 1: 编写 3 轮连续更新排队测试**

在 `App.graph-updates.test.tsx` 中，紧接现有队列测试（约 line 1205 后）添加：

```typescript
it('连续 3 轮图更新排队后依次独立播放导览', async () => {
  vi.useFakeTimers();
  const listeners: Array<(message: { type?: string; target?: string; payload?: Record<string, unknown> }) => void> = [];
  (globalThis as any).chrome.runtime.onMessage.addListener.mockImplementation(
    (listener: (message: { type?: string; target?: string; payload?: Record<string, unknown> }) => void) => {
      listeners.push(listener);
    },
  );
  (globalThis as any).chrome.runtime.sendMessage.mockImplementation(
    (message: { type?: string }) => {
      if (message?.type === 'GET_RUNTIME_SNAPSHOT') {
        return Promise.resolve({
          success: true,
          snapshot: {
            sessionId: 'session_3round',
            state: 'capturing',
            currentTimeMs: 30000,
            currentView: 'causal',
            currentViewPinned: false,
            graph: {
              sessionId: 'session_3round',
              revision: 1,
              topics: [],
              nodes: [
                { id: 'n0', type: 'claim', text: '锚点节点', timestampMs: 0, status: 'confirmed' },
              ],
              edges: [],
              viewHints: { defaultView: 'causal', scores: { causal: 3 } },
              updatedAt: 100,
            },
          },
        });
      }
      return Promise.resolve({ success: true });
    },
  );

  await renderApp();
  reactFlowFitBoundsSpy.mockClear();

  // ---- 第一轮更新：添加 n1, n2, n3 ----
  const graph1 = {
    sessionId: 'session_3round',
    revision: 2,
    topics: [],
    nodes: [
      { id: 'n0', type: 'claim', text: '锚点节点', timestampMs: 0, status: 'confirmed' },
      { id: 'n1', type: 'reason', text: '第一轮一', timestampMs: 1000, status: 'confirmed' },
      { id: 'n2', type: 'reason', text: '第一轮二', timestampMs: 2000, status: 'confirmed' },
      { id: 'n3', type: 'reason', text: '第一轮三', timestampMs: 3000, status: 'confirmed' },
    ],
    edges: [
      { id: 'e01', source: 'n0', target: 'n1', type: 'supports' },
      { id: 'e12', source: 'n1', target: 'n2', type: 'supports' },
      { id: 'e23', source: 'n2', target: 'n3', type: 'supports' },
    ],
    viewHints: { defaultView: 'causal', scores: { causal: 5 } },
    updatedAt: 200,
  };

  await act(async () => {
    listeners[0]?.({
      type: 'MERGED_GRAPH_UPDATED',
      target: 'sidepanel',
      payload: { graph: graph1 },
    });
    await Promise.resolve();
  });

  // 第一轮导览已启动
  expect(reactFlowFitBoundsSpy).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId('auto-tour-status')).toHaveTextContent(/自动导览/);
  // 第一轮节点应被标记为 tour-added
  expect(screen.getByTestId('graph-node-card-n1')).toHaveAttribute('data-tour-added', 'true');

  // ---- 第二轮更新（第一轮导览仍在播放）：添加 n4, n5 ----
  const graph2 = {
    sessionId: 'session_3round',
    revision: 3,
    topics: [],
    nodes: [
      ...graph1.nodes,
      { id: 'n4', type: 'reason', text: '第二轮一', timestampMs: 4000, status: 'confirmed' },
      { id: 'n5', type: 'reason', text: '第二轮二', timestampMs: 5000, status: 'confirmed' },
    ],
    edges: [
      ...graph1.edges,
      { id: 'e34', source: 'n3', target: 'n4', type: 'supports' },
      { id: 'e45', source: 'n4', target: 'n5', type: 'supports' },
    ],
    viewHints: { defaultView: 'causal', scores: { causal: 6 } },
    updatedAt: 300,
  };

  await act(async () => {
    listeners[0]?.({
      type: 'MERGED_GRAPH_UPDATED',
      target: 'sidepanel',
      payload: { graph: graph2 },
    });
    await Promise.resolve();
  });

  // ---- 第三轮更新（第一轮导览仍在播放）：添加 n6 ----
  const graph3 = {
    sessionId: 'session_3round',
    revision: 4,
    topics: [],
    nodes: [
      ...graph2.nodes,
      { id: 'n6', type: 'reason', text: '第三轮', timestampMs: 6000, status: 'confirmed' },
    ],
    edges: [
      ...graph2.edges,
      { id: 'e56', source: 'n5', target: 'n6', type: 'supports' },
    ],
    viewHints: { defaultView: 'causal', scores: { causal: 7 } },
    updatedAt: 400,
  };

  await act(async () => {
    listeners[0]?.({
      type: 'MERGED_GRAPH_UPDATED',
      target: 'sidepanel',
      payload: { graph: graph3 },
    });
    await Promise.resolve();
  });

  // ---- 推进时间：完成第一轮导览，第二轮应自动开始 ----
  await act(async () => {
    vi.advanceTimersByTime(6000);
  });

  const callsAfterRound1 = reactFlowFitBoundsSpy.mock.calls.length;
  expect(callsAfterRound1).toBeGreaterThan(1);

  // 第二轮节点应被标记为 tour-added
  expect(screen.getByTestId('graph-node-card-n4')).toHaveAttribute('data-tour-added', 'true');
  // 第一轮节点已不再被标记
  expect(screen.getByTestId('graph-node-card-n1')).toHaveAttribute('data-tour-added', 'false');

  // ---- 推进时间：完成第二轮导览，第三轮应自动开始 ----
  await act(async () => {
    vi.advanceTimersByTime(6000);
  });

  const callsAfterRound2 = reactFlowFitBoundsSpy.mock.calls.length;
  expect(callsAfterRound2).toBeGreaterThan(callsAfterRound1);

  // 第三轮节点应被标记为 tour-added
  expect(screen.getByTestId('graph-node-card-n6')).toHaveAttribute('data-tour-added', 'true');
  // 第二轮节点已不再被标记
  expect(screen.getByTestId('graph-node-card-n4')).toHaveAttribute('data-tour-added', 'false');

  vi.useRealTimers();
});
```

- [ ] **Step 2: 运行新测试确认红灯**

```bash
pnpm --filter extension exec vitest run src/sidepanel/App.graph-updates.test.tsx --reporter=verbose 2>&1 | tail -25
```

Expected: 新测试 `连续 3 轮图更新排队后依次独立播放导览` **失败** — 队列中旧 revision seed 被 `pending.revision !== graph.revision` 检查丢弃，导致第二轮导览未启动，`data-tour-added` 断言不满足。

---

### Task 3: 修复队列语义（TDD GREEN）

**Files:**
- Modify: `apps/extension/src/sidepanel/hooks/useAutoTour.ts`

- [ ] **Step 1: 将 revision 检查替换为 nodeIds 存在性检查**

在 `maybeStartAutoTour` 中（约 line 297-301），将：

```typescript
if (
  pending.sessionId !== graph.sessionId ||
  pending.revision !== graph.revision
) {
  return;
}
```

替换为：

```typescript
const currentNodeIds = new Set(graph.nodes.map((n) => n.id));
if (
  pending.sessionId !== graph.sessionId ||
  !pending.nodeIds.every((id) => currentNodeIds.has(id))
) {
  return;
}
```

- [ ] **Step 2: 更新 autoTourKey 使用 nodeIds 而非 revision**

在同一函数中（约 line 317），将：

```typescript
const autoTourKey = `${pending.sessionId}:${pending.revision}:${currentView}`;
```

替换为：

```typescript
const autoTourKey = `${pending.sessionId}:${[...pending.nodeIds].sort().join(',')}:${currentView}`;
```

- [ ] **Step 3: 更新注释**

将 `maybeStartAutoTour` 开头注释（约 line 291-293）从：

```typescript
// 取出待处理的 seed（优先直接 pending，其次从队列 shift）
// 注意：队列中的旧 revision seed 会在下方 revision 匹配检查中被丢弃，
// 这是设计意图——只有最新 revision 的 seed 有意义。
```

更新为：

```typescript
// 取出待处理的 seed（优先直接 pending，其次从队列 shift）
// 队列中的 seed 仅在 nodeIds 不再存在于当前图谱时才被丢弃，
// 允许旧 revision 的 seed 在当前布局上正常播放。
```

- [ ] **Step 4: 运行测试验证绿灯**

```bash
pnpm --filter extension exec vitest run src/sidepanel/App.graph-updates.test.tsx --reporter=verbose 2>&1 | tail -25
```

Expected: 所有测试通过，包括新的 3 轮队列测试。

---

### Task 4: 添加 pending seed cooldown 重试

**Files:**
- Modify: `apps/extension/src/sidepanel/hooks/useAutoTour.ts`

当 `maybeStartAutoTour` 因用户 cooldown 提前返回时，如果有 pending seed，安排延迟重试。

- [ ] **Step 1: 添加 pendingSeedRetryTimerRef**

在 ref 声明区域（约 line 83 之后）添加：

```typescript
const pendingSeedRetryTimerRef = useRef<number | null>(null);
```

- [ ] **Step 2: 添加清理函数**

在 `clearAutoTourResumeTimer` 之后（约 line 98 之后）添加：

```typescript
const clearPendingSeedRetryTimer = useCallback(() => {
  if (pendingSeedRetryTimerRef.current !== null) {
    window.clearTimeout(pendingSeedRetryTimerRef.current);
    pendingSeedRetryTimerRef.current = null;
  }
}, []);
```

- [ ] **Step 3: 在 cooldown 检查中安排重试**

在 `maybeStartAutoTour` 中，找到 cooldown 检查（约 line 304-309）：

```typescript
if (
  userViewportInteractingRef.current ||
  Date.now() - lastUserViewportChangeAtRef.current < USER_VIEWPORT_COOLDOWN_MS
) {
  return;
}
```

替换为：

```typescript
if (
  userViewportInteractingRef.current ||
  Date.now() - lastUserViewportChangeAtRef.current < USER_VIEWPORT_COOLDOWN_MS
) {
  if (
    !pendingSeedRetryTimerRef.current &&
    (pendingAutoTourRef.current || pendingAutoTourSeedsRef.current.length > 0)
  ) {
    pendingSeedRetryTimerRef.current = window.setTimeout(() => {
      pendingSeedRetryTimerRef.current = null;
      maybeStartAutoTour();
    }, USER_VIEWPORT_COOLDOWN_MS + 500);
  }
  return;
}
```

- [ ] **Step 4: 在正常路径清除重试 timer**

在 cooldown 检查之后、`const inst = reactFlowInstanceRef.current;` 之前，添加：

```typescript
clearPendingSeedRetryTimer();
```

- [ ] **Step 5: 在 resetAutoTourState 中清理**

在 `resetAutoTourState` 函数体中，`clearAutoTourAdvanceTimer();` 之后添加：

```typescript
clearPendingSeedRetryTimer();
```

并将 `clearPendingSeedRetryTimer` 加入 `resetAutoTourState` 的 `useCallback` deps 数组。

- [ ] **Step 6: 在 unmount effect 中清理**

更新现有 unmount effect 为：

```typescript
useEffect(
  () => () => {
    clearAutoTourAdvanceTimer();
    clearAutoTourResumeTimer();
    clearPendingSeedRetryTimer();
  },
  [clearAutoTourAdvanceTimer, clearAutoTourResumeTimer, clearPendingSeedRetryTimer],
);
```

- [ ] **Step 7: 运行测试验证**

```bash
pnpm --filter extension exec vitest run src/sidepanel/App.graph-updates.test.tsx src/sidepanel/auto-tour-utils.test.ts --reporter=verbose 2>&1 | tail -25
```

Expected: 所有测试通过。

---

### Task 5: 添加 .superpowers/ 到 .gitignore

**Files:**
- Modify: `.gitignore`

- [ ] **Step 1: 添加 .superpowers/ 规则**

在 `.gitignore` 的 OMC 区域（`/.omc/` 行之后，约 line 23 后）添加：

```
# Superpowers (visual companion)
.superpowers/
```

- [ ] **Step 2: 验证 .superpowers/ 被忽略**

```bash
git status .superpowers/
```

Expected: 不再出现在 untracked 列表中。

---

### Task 6: 最终验证

- [ ] **Step 1: 运行 typecheck**

```bash
pnpm --filter extension typecheck
```

Expected: 0 errors

- [ ] **Step 2: 运行全部相关测试**

```bash
pnpm --filter extension exec vitest run src/sidepanel/auto-tour-utils.test.ts src/sidepanel/App.graph-updates.test.tsx src/sidepanel/view-mapping.test.ts --reporter=verbose 2>&1 | tail -30
```

Expected: 所有测试通过。

- [ ] **Step 3: 运行 settings 测试（回归检查）**

```bash
pnpm --filter extension exec vitest run src/sidepanel/App.settings.test.tsx --reporter=verbose 2>&1 | tail -10
```

Expected: 所有测试通过。
