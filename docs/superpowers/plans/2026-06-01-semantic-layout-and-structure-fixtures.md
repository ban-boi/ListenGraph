# 语义布局图形语法 + 结构化质量 Fixture 提交计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将当前所有未提交的修改按逻辑组织为 8 个原子提交，覆盖语义布局图形语法、语义 fixture 序列、结构化质量验收、测试基础设施改进等方面。

**Architecture:** 修改横跨 `graph-renderers`（语义模式检测）、`graph-fixtures`（fixture 生成）、`extension/sidepanel`（布局消费与测试）、`extension/service-worker`（真实 API 质量验收）、`providers`（防御性修复）共 5 个包。提交顺序遵循依赖链：类型 → 渲染器 → 布局消费 → fixture → 测试 → 文档。

**Tech Stack:** TypeScript, React Flow, Vitest, Zod

---

## 变更全景（17 个已修改文件 + 27 个新增文件）

| 类别 | 文件 | 变更量 |
|------|------|--------|
| 类型定义 | `graph-renderers/src/types.ts` | +16 |
| 语义模式检测 | `graph-renderers/src/hierarchy.ts` | +252/-7 |
| 布局消费 | `sidepanel/graph-utils.ts` | +56/-18 |
| Fixture schema | `graph-fixtures/src/schemas.ts` | +13 |
| Fixture 生成脚本 | `graph-fixtures/scripts/write-fixtures.mjs` | +271 |
| Fixture manifest | `graph-fixtures/fixtures/manifest.json` | +51 |
| Fixture 序列文件 (5) | `graph-fixtures/fixtures/sequences/seq-pattern-*.json` | 新增 |
| Fixture 注册 | `sidepanel/fixture-sequence-dev.ts` | +10 |
| Fixture 注册测试 | `sidepanel/fixture-sequence-dev.test.ts` | 新增 |
| 语义布局测试 | `sidepanel/graph-utils.test.ts` | +437 |
| 语义质量 fixture (21) | `service-worker/fixtures/structure/semantic-*.json` | 新增 |
| 语义 runner 脚本 | `scripts/run-structure-semantic.mjs` | 新增 |
| 测试脚本注册 | `extension/package.json` | +1 |
| 真实测试增强 | `service-worker/structure-focused.real.test.ts` | +149 |
| 测试 mock 重构 | `sidepanel/__test-helpers__/app-test-helpers.tsx` | +281/-139 |
| Fixture 回放修复 | `sidepanel/graph-fixtures.test-helper.ts` | +8 |
| App fitView 改造 | `sidepanel/App.tsx` | +21/-2 |
| DOMMatrix mock | `sidepanel/test/setup.ts` | +12 |
| retry 防御 | `providers/src/http/retry.ts` | +6/-1 |
| 文档 | `docs/testing/graph-layout-fixtures.md` | +22 |
| 文档 | `docs/testing/structure-regression.md` | +16 |

---

## Task 1: 防御性修复 — retry.ts timeout guard

**Files:**
- Modify: `packages/providers/src/http/retry.ts`

**说明：** `createTimeoutSignal()` 增加 `!Number.isFinite(timeoutMs) || timeoutMs <= 0` 检查，防止无效 timeout 传入 AbortController。独立于其他功能，优先合入。

- [ ] **Step 1: 提交**

```bash
git add packages/providers/src/http/retry.ts
git commit -m "fix(providers): guard createTimeoutSignal against invalid timeoutMs"
```

---

## Task 2: 测试基础设施 — mock 重构与 DOMMatrix 补丁

**Files:**
- Modify: `apps/extension/src/sidepanel/__test-helpers__/app-test-helpers.tsx`
- Modify: `apps/extension/src/sidepanel/App.tsx`
- Modify: `apps/extension/src/test/setup.ts`
- Modify: `apps/extension/src/sidepanel/graph-fixtures.test-helper.ts`

**说明：**
1. 将 `vi.mock('reactflow', ...)` 内联对象提取为 `createReactFlowMock()` 导出函数，支持跨包 mock 复用
2. App.tsx: `queueMicrotask(() => requestAutoFit())` → 同步 `requestAutoFit()`，便于测试对齐
3. App.tsx: 添加 `__listenGraphicFitViewSpy` 桥接，让测试可观察 fitView 调用
4. test/setup.ts: 补充 `DOMMatrixReadOnly` mock（jsdom 未提供）
5. graph-fixtures.test-helper.ts: GraphArea 从 EmptyState 切换到 ReactFlow 重新 mount 时，deferred 模式需再次触发 onInit

- [ ] **Step 1: 提交**

```bash
git add apps/extension/src/sidepanel/__test-helpers__/app-test-helpers.tsx
git add apps/extension/src/sidepanel/App.tsx
git add apps/extension/src/test/setup.ts
git add apps/extension/src/sidepanel/graph-fixtures.test-helper.ts
git commit -m "test(ext): extract createReactFlowMock, add DOMMatrix mock and fitView spy bridge"
```

---

## Task 3: 语义布局图形语法 — 类型和模式检测

**Files:**
- Modify: `packages/graph-renderers/src/types.ts`
- Modify: `packages/graph-renderers/src/hierarchy.ts`

**说明：**
1. types.ts 新增 `RendererLayoutRole`、`SemanticLayoutPattern` 类型，`RendererNode.layoutRole`、`RendererGraph.layoutHints` 字段
2. hierarchy.ts 实现 5 个语义模式检测器：
   - `detectQuestionBranches` — question fanout 到多个 claim
   - `detectClaimReasonExample` — claim → reason → example 链
   - `detectOpposition` — opposes 边标识
   - `detectCausalChain` — causes 链式递进
   - `detectTimelineNote` — follows 链 + 补充 example
3. `detectHierarchyLayoutPattern()` 按优先级串联 5 个检测器
4. `toHierarchyRendererGraph()` 消费检测结果，将 roles 和 hints 写入 RendererGraph

- [ ] **Step 1: 提交**

```bash
git add packages/graph-renderers/src/types.ts
git add packages/graph-renderers/src/hierarchy.ts
git commit -m "feat(renderers): add semantic layout pattern detection for hierarchy view"
```

---

## Task 4: 语义布局图形语法 — 侧边栏布局消费

**Files:**
- Modify: `apps/extension/src/sidepanel/graph-utils.ts`

**说明：**
1. `isSemanticBranchNode()` — 识别 hierarchy 视图下的 branch/support/chain 角色
2. `getNodeLaneX()` — 语义模式下 root 固定主车道，branch/support/chain 偏移分支车道
3. `shouldAttachToAnchor` 条件增加语义角色判断
4. `shouldContinueFromAnchor` — chain/support 角色从 anchor 继续，不退回主干
5. Opposition 模式下 opposes 边设为 primary 优先级并强制可见

- [ ] **Step 1: 提交**

```bash
git add apps/extension/src/sidepanel/graph-utils.ts
git commit -m "feat(sidepanel): consume semantic layout roles in stable layout positioning"
```

---

## Task 5: 语义布局图形语法 — 布局测试

**Files:**
- Modify: `apps/extension/src/sidepanel/graph-utils.test.ts`

**说明：** 新增 `semantic hierarchy layout grammar` 测试套件：
1. 识别五个核心语义图形模式（模式检测断言）
2. 问题分三点 — question 主节点 + 三个 claim 分支车道展开 + 无重叠 + handle 合理
3. 观点-理由-例子 — claim 主节点 + reason/example 右侧支撑链
4. A 反对 B — opposes 边可见 + 反对方作为主节点
5. 因果链 — 节点沿链式方向递进不退回
6. 时间线补充说明 — 主链按 follows 顺序 + 补充挂在末尾

辅助工具函数：`makeGraph`、`layoutHierarchy`、`expectNoOverlaps`、`expectVisibleHandles`、`expectSameLane`、`expectYOrder`

- [ ] **Step 1: 提交**

```bash
git add apps/extension/src/sidepanel/graph-utils.test.ts
git commit -m "test(sidepanel): add semantic hierarchy layout grammar tests"
```

---

## Task 6: 语义 Pattern Fixture 序列

**Files:**
- Modify: `packages/graph-fixtures/src/schemas.ts`
- Modify: `packages/graph-fixtures/scripts/write-fixtures.mjs`
- Modify: `packages/graph-fixtures/fixtures/manifest.json`
- Create: `packages/graph-fixtures/fixtures/sequences/seq-pattern-question-three-points.json`
- Create: `packages/graph-fixtures/fixtures/sequences/seq-pattern-claim-reason-example.json`
- Create: `packages/graph-fixtures/fixtures/sequences/seq-pattern-opposition.json`
- Create: `packages/graph-fixtures/fixtures/sequences/seq-pattern-causal-chain.json`
- Create: `packages/graph-fixtures/fixtures/sequences/seq-pattern-timeline-note.json`
- Modify: `apps/extension/src/sidepanel/fixture-sequence-dev.ts`
- Create: `apps/extension/src/sidepanel/fixture-sequence-dev.test.ts`

**说明：**
1. schemas.ts 新增 `visualExpectationSchema`（rootNode, branchNodes, chainNodes, layout, noOverlap 等）
2. write-fixtures.mjs 新增 5 个 pattern builder + `hierarchyViewHints` / `causalViewHints` / `timelineViewHints` 辅助函数
3. manifest.json 注册 5 个新序列
4. fixture-sequence-dev.ts 导入并注册 5 个新序列
5. fixture-sequence-dev.test.ts 验证 registry 列表包含所有 fixture ID

- [ ] **Step 1: 提交**

```bash
git add packages/graph-fixtures/src/schemas.ts
git add packages/graph-fixtures/scripts/write-fixtures.mjs
git add packages/graph-fixtures/fixtures/manifest.json
git add packages/graph-fixtures/fixtures/sequences/seq-pattern-question-three-points.json
git add packages/graph-fixtures/fixtures/sequences/seq-pattern-claim-reason-example.json
git add packages/graph-fixtures/fixtures/sequences/seq-pattern-opposition.json
git add packages/graph-fixtures/fixtures/sequences/seq-pattern-causal-chain.json
git add packages/graph-fixtures/fixtures/sequences/seq-pattern-timeline-note.json
git add apps/extension/src/sidepanel/fixture-sequence-dev.ts
git add apps/extension/src/sidepanel/fixture-sequence-dev.test.ts
git commit -m "feat(fixtures): add 5 semantic pattern sequence fixtures with visual expectations"
```

---

## Task 7: 语义结构化质量 Fixture — 数据与增强断言

**Files:**
- Create: `apps/extension/src/service-worker/fixtures/structure/semantic-*.json` (21 个)
- Create: `apps/extension/scripts/run-structure-semantic.mjs`
- Modify: `apps/extension/package.json`
- Modify: `apps/extension/src/service-worker/structure-focused.real.test.ts`

**说明：**
1. 21 个语义质量 fixture 覆盖：观点-理由-例子、自我修正、填充/停顿、UX 示例、两人争论、因果链、时间线、结论跟进、风险缓解、类比、取舍、假设-实验、不完整想法、噪声、优先级、问题三点、歧义引用、决策标准、行动项、嵌套要点、对比
2. 每个 fixture 包含：transcripts + acceptance（minMergedNodes/maxMergedNodes、mustContainTexts/forbiddenTexts、mustHaveNodeTypes/requiredEdgeTypes、maxFallbackRuns）
3. run-structure-semantic.mjs：逐个运行 semantic fixture，汇总结果到 .tmp/semantic-structure-summary.json
4. package.json：新增 `test:structure:semantic` 脚本
5. structure-focused.real.test.ts 增强：
   - 新增 acceptance 字段：maxMergedNodes, maxFallbackRuns, forbiddenTexts, mustHaveNodeTypes, manualReviewTags
   - `fetchWithHarnessTimeout()`：独立于 provider signal 的超时保护
   - `writeRealStructurerTrace()`：可选手动 trace 输出
   - `fixtureTestTimeoutMs`：独立可配置的超时
   - `omitFetchSignal()`：避免 provider signal 干扰 harness 超时

- [ ] **Step 1: 提交**

```bash
git add apps/extension/src/service-worker/fixtures/structure/semantic-*.json
git add apps/extension/scripts/run-structure-semantic.mjs
git add apps/extension/package.json
git add apps/extension/src/service-worker/structure-focused.real.test.ts
git commit -m "feat(ext): add 21 semantic quality structure fixtures with enhanced assertions"
```

---

## Task 8: 文档更新

**Files:**
- Modify: `docs/testing/graph-layout-fixtures.md`
- Modify: `docs/testing/structure-regression.md`

**说明：**
1. graph-layout-fixtures.md：新增语义图形模式抽检示例、5 个 pattern fixture 描述行
2. structure-regression.md：新增语义质量 fixture 章节（弹性断言字段说明、新增验收条件文档）

- [ ] **Step 1: 提交**

```bash
git add docs/testing/graph-layout-fixtures.md
git add docs/testing/structure-regression.md
git commit -m "docs(testing): document semantic layout patterns and structure quality fixtures"
```

---

## 提交依赖关系

```
Task 1 (retry guard)          ─── 独立，可最先提交
Task 2 (test infra)           ─── 独立，Task 5 测试依赖此 mock
Task 3 (renderers types)      ─── Task 4 依赖此
Task 4 (sidepanel consume)    ─── 依赖 Task 3
Task 5 (layout tests)         ─── 依赖 Task 2 + Task 3 + Task 4
Task 6 (pattern fixtures)     ─── 依赖 Task 3（schema 引用 types）
Task 7 (semantic fixtures)    ─── 独立
Task 8 (docs)                 ─── 最后
```

## 未纳入提交的文件

| 文件 | 说明 |
|------|------|
| `docs/superpowers/plans/2026-05-29-cross-platform-ui-extraction.md` | 历史计划文档，与本次变更无关，单独处理或忽略 |
