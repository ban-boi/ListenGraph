# 状态架构重构 — index.ts 与 App.tsx 拆分至 800 行

> **For agentic workers:** 使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 按任务逐一实施。每个步骤使用 checkbox (`- [ ]`) 语法跟踪进度。

**目标:** 将 `service-worker/index.ts`（2225 行）和 `sidepanel/App.tsx`（2056 行）通过状态架构改造拆分至 800 行以下。第一轮已提取了所有纯函数；本轮聚焦于有状态逻辑的模块化。

**架构:**
- **service-worker**: 将 26 个模块级 `let` 变量整合为 `RuntimeStateContainer` 类。reset 方法按语义拆分为 `resetActiveRuntime()`（仅重置活跃会话运行时）和 `resetQueues()`，**绝不触碰** `pendingSessionFinalize`、provider runtime、hydration 状态。各处理模块通过接收容器实例来访问状态，index.ts 仅保留消息路由和 Chrome 事件监听。
- **sidepanel**: 分两步走——先用 `useReducer` 将消息驱动状态（session/graph/provider/progress 等 ~20 个 useState）收敛为单一 `panelReducer`；再在此基础上提取关注点分离的自定义 hooks。`currentTimeMs` 由 reducer 唯一拥有，replay 只 dispatch action。

**技术栈:** TypeScript, React 18, Chrome MV3 Extension, Vitest

**前提:** 第一轮纯函数提取已完成（`assembler-types.ts`, `assembler-decision.ts`, `provider-config.ts`, `debug-trace.ts`, `graph-building.ts`, `export-formatters.ts`, `tencent-realtime.ts` 均已存在）。

---

## 文件结构总览

### service-worker/ 新增文件

```
apps/extension/src/service-worker/
├── runtime-state.ts        (~200 行) RuntimeStateContainer 类 + 类型定义
├── state-persistence.ts    (~160 行) hydration / persist / clear
├── work-queues.ts          (~150 行) audio chunk + transcript 序列化队列
├── assembler-machine.ts    (~280 行) assembler 状态机（有状态部分）
├── asr-stream-handlers.ts  (~120 行) ASR 流消息处理
├── structurer-executor.ts  (~150 行) structurer 执行与图谱更新
├── session-lifecycle.ts    (~260 行) session start / stop / cleanup
├── provider-management.ts  (~100 行) provider 配置管理
├── session-handlers.ts     (~130 行) export / debug / replay 查询
├── runtime-snapshot.ts     (~150 行) 快照构建 / 通知广播
├── content-script-bridge.ts (~70 行)  content script 通信
├── index.ts                (~350 行) 消息路由 + Chrome 事件监听 + 组合根
```

### sidepanel/ 新增文件

```
apps/extension/src/sidepanel/
├── panel-reducer.ts           (~250 行) reducer + action 类型 + 初始状态
├── hooks/
│   ├── useTimeline.ts          (~130 行) 时间线事件管理
│   ├── useAutoTour.ts          (~250 行) 自动导览逻辑
│   ├── useProviderSettings.ts  (~200 行) provider 配置 CRUD
│   ├── useStatusCards.ts       (~150 行) 状态卡片派生
│   ├── useChromeMessages.ts    (~100 行) Chrome 消息监听 → 仅 dispatch action
│   ├── useReplay.ts            (~110 行) 回放控制
│   └── useLogResize.ts         (~80 行)  日志面板拖拽
├── App.tsx                     (~400 行) useReducer + hooks 编排 + JSX 骨架
```

---

## Phase 1: Service Worker — 状态容器基础设施

### Task 1: 创建 `runtime-state.ts` — RuntimeStateContainer

**Files:**
- 创建: `apps/extension/src/service-worker/runtime-state.ts`
- 修改: `apps/extension/src/service-worker/index.ts`

这是整个重构的关键。将 26 个模块级 `let` 变量合并为一个可注入的状态容器。

**重要：reset 方法必须精确还原现有三处 bulk-reset 的原语义，不能合并。**

当前代码中有三处 bulk-reset，每处的重置字段范围不同：

| 位置 | 额外重置 | 不重置 |
|------|----------|--------|
| startSession 成功（L355-374） | `stoppingSessionId=null` | `pendingSessionFinalize`、`lastStructurerRun` |
| startSession 失败（L403-417） | — | `pendingSessionFinalize`、`lastStructurerRun`、`stoppingSessionId` |
| cleanupSession finally（L1963-1979） | `stoppingSessionId=null`、`lastStructurerRun=null` | `pendingSessionFinalize` |

三者的共同子集（14 个字段）提取为 `resetActiveRuntime()`，各调用处在此基础上追加自己的额外重置。**`pendingSessionFinalize` 在任何 reset 方法中都不被清除**——它只在 `markEnded` 成功时显式置 null（L1955），或通过 `flushPendingSessionFinalize` 补偿消费。

- [ ] **Step 1: 创建 `runtime-state.ts`，定义 RuntimeStateContainer 类**

```typescript
// runtime-state.ts — 运行时状态容器

import type {
  MergedGraph,
  ProviderConfig,
  ProviderRuntimeSummary,
  SerializableProviderError,
  TranscriptChunk,
} from '@listen-graphic/schema';
import type {
  AsrProvider,
  StructurerProvider,
} from '@listen-graphic/providers';
import type {
  AssemblerRunDebug,
  StructureUnitDebug,
  StructurerRunDebug,
  RuntimeSnapshot,
} from '../shared/messages';
import type { PendingStructureBuffer } from './assembler-types';
import {
  createExtensionDefaultProviderConfig,
  redactProviderConfig,
} from './provider-config';

export type ActiveSession = {
  sessionId: string;
  tabId: number;
  state: import('../shared/messages').SessionState;
};

export type PersistedRuntimeState = {
  currentSession: ActiveSession | null;
  transcriptWindow: TranscriptChunk[];
  pendingStructureBuffer: PendingStructureBuffer | null;
  assemblerRuns: AssemblerRunDebug[];
  structureUnits: StructureUnitDebug[];
  mergedGraph: MergedGraph | null;
  transcriptSequence?: number;
  chunkIndex: number;
  currentTimeMs: number;
  currentView: RuntimeSnapshot['currentView'];
  currentViewPinned: boolean;
  structuringSince: number | null;
  lastTranscriptAt: number | null;
  lastGraphUpdatedAt: number | null;
  pendingSessionFinalize: { sessionId: string; endedAt: number } | null;
  providerSummary: ProviderRuntimeSummary;
  lastProviderError: SerializableProviderError | null;
  lastStructurerRun: StructurerRunDebug | null;
};

export class RuntimeStateContainer {
  currentSession: ActiveSession | null = null;
  recoveredSessionId: string | null = null;
  transcriptWindow: TranscriptChunk[] = [];
  pendingStructureBuffer: PendingStructureBuffer | null = null;
  assemblerRuns: AssemblerRunDebug[] = [];
  structureUnits: StructureUnitDebug[] = [];
  mergedGraph: MergedGraph | null = null;
  transcriptSequence = 0;
  currentTimeMs = 0;
  currentView: RuntimeSnapshot['currentView'] = undefined;
  currentViewPinned = false;
  structuringSince: number | null = null;
  lastTranscriptAt: number | null = null;
  lastGraphUpdatedAt: number | null = null;
  pendingSessionFinalize: { sessionId: string; endedAt: number } | null = null;
  inFlightChunkPromise: Promise<unknown> | null = null;
  chunkQueueTail: Promise<void> = Promise.resolve();
  pendingChunkWorkCount = 0;
  inFlightTranscriptPromise: Promise<unknown> | null = null;
  transcriptProcessTail: Promise<void> = Promise.resolve();
  pendingTranscriptWorkCount = 0;
  stoppingSessionId: string | null = null;
  runtimeStateHydrated = false;
  hydrationPromise: Promise<void> | null = null;
  activeProviderConfig: ProviderConfig = createExtensionDefaultProviderConfig();
  providerSummary: ProviderRuntimeSummary = redactProviderConfig(createExtensionDefaultProviderConfig());
  lastProviderError: SerializableProviderError | null = null;
  lastStructurerRun: StructurerRunDebug | null = null;
  currentStructurerTarget: RuntimeSnapshot['currentStructurerTarget'] = null;
  asrProvider!: AsrProvider;
  structurerProvider!: StructurerProvider;

  /** 重置活跃会话运行时状态（三处 bulk-reset 的共同子集）。
   *  不触碰：pendingSessionFinalize、stoppingSessionId、lastStructurerRun、
   *  provider runtime 字段、hydration 字段。 */
  resetActiveRuntime(): void {
    this.currentSession = null;
    this.recoveredSessionId = null;
    this.transcriptWindow = [];
    this.pendingStructureBuffer = null;
    this.assemblerRuns = [];
    this.structureUnits = [];
    this.mergedGraph = null;
    this.transcriptSequence = 0;
    this.currentTimeMs = 0;
    this.currentView = undefined;
    this.currentViewPinned = false;
    this.structuringSince = null;
    this.lastTranscriptAt = null;
    this.lastGraphUpdatedAt = null;
    this.pendingChunkWorkCount = 0;
    this.pendingTranscriptWorkCount = 0;
    this.currentStructurerTarget = null;
  }

  /** 重置队列状态（in-flight promise 和计数器） */
  resetQueues(): void {
    this.inFlightChunkPromise = null;
    this.chunkQueueTail = Promise.resolve();
    this.pendingChunkWorkCount = 0;
    this.inFlightTranscriptPromise = null;
    this.transcriptProcessTail = Promise.resolve();
    this.pendingTranscriptWorkCount = 0;
  }
}
```

- [ ] **Step 2: 在 index.ts 中用容器替换 26 个 let 变量**

在 `index.ts` 中：
- 删除 `type ActiveSession` 和 `type PersistedRuntimeState` 定义（已移到 runtime-state.ts）
- 删除第 166-197 行的全部 26 个 `let` 声明
- 添加: `import { RuntimeStateContainer, type ActiveSession, type PersistedRuntimeState } from './runtime-state';`
- 添加: `const S = new RuntimeStateContainer();`
- 全局替换所有变量引用为 `S.xxx`（例如 `currentSession` → `S.currentSession`，`mergedGraph` → `S.mergedGraph`）

**三处 bulk-reset 必须逐字还原原语义，不做任何合并：**

**位置 1 — startSession 成功路径（原 L355-374）：**
```typescript
// 在 S.resetActiveRuntime() 之后追加：
S.stoppingSessionId = null;
// 注意：不重置 pendingSessionFinalize、lastStructurerRun
```

**位置 2 — startSession 失败路径（原 L403-417）：**
```typescript
S.resetActiveRuntime();
// 注意：不重置 stoppingSessionId、pendingSessionFinalize、lastStructurerRun
```

**位置 3 — cleanupSession finally（原 L1963-1979）：**
```typescript
S.resetActiveRuntime();
S.stoppingSessionId = null;
S.lastStructurerRun = null;
// 注意：不重置 pendingSessionFinalize（它的值决定后续 persist/clear 路径）
```

**禁止在本步骤中改变任何控制流或条件逻辑。** 仅做变量引用替换 + 调用 reset 方法。

- [ ] **Step 3: 运行 contract 测试验证**

```bash
pnpm run test:ext:contract
pnpm typecheck
```

预期：所有现有测试通过，无类型错误。contract 测试覆盖了 start/stop 状态流和 persist/hydrate 行为，能捕获 reset 语义回归。

- [ ] **Step 4: 提交**

```bash
git add apps/extension/src/service-worker/runtime-state.ts apps/extension/src/service-worker/index.ts
git commit -m "refactor(sw): 引入 RuntimeStateContainer 替换 26 个模块级变量"
```

---

## Phase 2: Service Worker — 逐模块提取

每个 Task 提取一个模块。模式相同：
1. 创建新文件，将函数从 index.ts 移入
2. 函数签名添加 `S: RuntimeStateContainer` 作为第一个参数（如果需要状态）
3. index.ts 改为 import + 委托
4. 运行测试验证
5. 提交

**测试策略（service-worker 重构）：**

每次提取模块后执行递进验证：
- **必做**：`pnpm run test:ext:contract` — 覆盖运行时状态机、消息编排、persist/hydrate、provider 配置
- **必做**：`pnpm typecheck` — 类型安全
- **触碰到 session start/stop/cleanup 或 flush 逻辑时追加**：`pnpm run test:ext:replay` — 验证 transcript 输入后的结构化和 ASR 行为稳定
- **Phase 2 完成后追加**：`pnpm run test:ext:e2e` — 验证完整闭环

### Task 2: 提取 `state-persistence.ts`

**Files:**
- 创建: `apps/extension/src/service-worker/state-persistence.ts`
- 修改: `apps/extension/src/service-worker/index.ts`

**提取函数（~160 行）:**
- `getRuntimeStorageArea()`
- `ensureHydrated()`
- `rehydrateRuntimeState()`
- `persistRuntimeState()`
- `clearRuntimeState()`
- `withIndexedDbRetry()`
- `isIndexedDbBackingStoreError()`

**注入依赖:** 函数接收 `S: RuntimeStateContainer` 以及 repository 实例。`ensureHydrated` 还需要调用 `loadProviderRuntimeFromSettings` 和 `applyBootstrapProviderRuntime`（通过回调或接口注入）。

```typescript
// state-persistence.ts 关键接口
export interface PersistenceDeps {
  S: RuntimeStateContainer;
  sessionRepository: import('@listen-graphic/storage').SessionRepository;
  transcriptChunkRepository: import('@listen-graphic/storage').TranscriptChunkRepository;
  runtimeStateKey: string;
  lastStoppedSessionKey: string;
  loadProviderRuntime: () => Promise<void>;
  applyBootstrapProvider: () => void;
  resetAssemblerState: () => void;
  loadMergedGraphAsset: (sessionId: string) => Promise<import('@listen-graphic/schema').MergedGraph | null>;
}

export async function ensureHydrated(deps: PersistenceDeps): Promise<void> { ... }
export async function persistRuntimeState(deps: PersistenceDeps): Promise<void> { ... }
export async function clearRuntimeState(deps: PersistenceDeps): Promise<void> { ... }
export async function rehydrateRuntimeState(deps: PersistenceDeps): Promise<void> { ... }
```

index.ts 中改为：
```typescript
import { ensureHydrated, persistRuntimeState, clearRuntimeState, rehydrateRuntimeState } from './state-persistence';

const persistenceDeps: PersistenceDeps = { S, sessionRepository, transcriptChunkRepository, ... };
// 所有调用处改为: ensureHydrated(persistenceDeps)
```

- [ ] **Step 1: 创建 state-persistence.ts，移入函数并参数化**
- [ ] **Step 2: 更新 index.ts 导入和调用**
- [ ] **Step 3: 运行 `pnpm run test:ext:contract && pnpm typecheck`**
- [ ] **Step 4: 提交: `refactor(sw): 提取 state-persistence 模块`**

**Files:**
- 创建: `apps/extension/src/service-worker/content-script-bridge.ts`
- 修改: `apps/extension/src/service-worker/index.ts`

**提取函数（~70 行）:**
- `sendMessageToContentScript(tabId, message)`
- `ensureContentScriptInjected(tabId)`
- `isMissingReceiverError(error)`
- `buildContentScriptStartPayload(sessionId, providerConfig)`

这些函数仅依赖 `chrome.tabs` API 和 `activeProviderConfig`（从 `S` 读取），无复杂状态交互。

- [ ] **Step 1: 创建 content-script-bridge.ts**
- [ ] **Step 2: 更新 index.ts 导入和调用**
- [ ] **Step 3: 运行 `pnpm run test:ext:contract && pnpm typecheck`**
- [ ] **Step 4: 提交: `refactor(sw): 提取 content-script-bridge 模块`**

---

### Task 4: 提取 `runtime-snapshot.ts`

**Files:**
- 创建: `apps/extension/src/service-worker/runtime-snapshot.ts`
- 修改: `apps/extension/src/service-worker/index.ts`

**提取函数（~150 行）:**
- `getRuntimeSnapshot()`
- `getRuntimeSnapshotForSidepanel()`
- `getPendingTranscriptCount(S)`
- `getPendingWorkCount(S)`
- `getStopDrainPendingCount(S)`
- `getStructurerRunsForDebugSession()`
- `getSerializeErrorFallback(S)`
- `notifyError()`
- `notifyProviderProgress()`
- `broadcastToSidepanel()`
- `notifySessionState()`

依赖：`S: RuntimeStateContainer`，`broadcastToSidepanel` 使用 `chrome.runtime.sendMessage`。

- [ ] **Step 1: 创建 runtime-snapshot.ts**
- [ ] **Step 2: 更新 index.ts 导入和调用**
- [ ] **Step 3: 运行 `pnpm run test:ext:contract && pnpm typecheck`**
- [ ] **Step 4: 提交: `refactor(sw): 提取 runtime-snapshot 模块`**

---

### Task 5: 提取 `work-queues.ts`

**Files:**
- 创建: `apps/extension/src/service-worker/work-queues.ts`
- 修改: `apps/extension/src/service-worker/index.ts`

**提取函数（~150 行）:**
- `enqueueAudioChunk(payload, S, onChunkProcessed)`
- `handleAudioChunk(payload, S, onChunkProcessed)`
- `waitForChunkQueueToSettle(S)`
- `enqueueTranscriptProcessing(payload, S, onTranscriptProcessed)`
- `waitForTranscriptProcessingToSettle(S)`

`processTranscriptChunk` 也提取到这里（~60 行），因为它是 transcript 队列的核心回调。

依赖：`S: RuntimeStateContainer`，以及 `asrProvider`/`structurerProvider`（从 S 读取）和回调函数注入。

- [ ] **Step 1: 创建 work-queues.ts**
- [ ] **Step 2: 更新 index.ts 导入和调用**
- [ ] **Step 3: 运行 `pnpm run test:ext:contract && pnpm run test:ext:replay && pnpm typecheck`**
- [ ] **Step 4: 提交: `refactor(sw): 提取 work-queues 模块`**

---

### Task 6: 提取 `assembler-machine.ts`

**Files:**
- 创建: `apps/extension/src/service-worker/assembler-machine.ts`
- 修改: `apps/extension/src/service-worker/index.ts`

**提取函数（~280 行）:**
- `resetAssemblerState(S)`
- `appendTranscriptToWindow(chunk, S)`
- `getStructurerInvocationContextFromAssembler(context, S)`
- `shouldHandleWithStructureUnitAssembler(providerConfig)`
- `deriveAssemblerSignals(buffer, window, mergedGraph)`
- `decideAssemblerByHardRules(signals, buffer)`
- `materializeAssemblerCommitContext(buffer, S)`
- `flushPendingStructureBuffer(S)`
- `recordAssemblerRunDebug(...)`
- `recordStructureUnitDebug(...)`
- `collapseTranscriptWindowWithStructureUnit(...)`
- `shouldForceBootstrapForCompletedRealtimeInput(...)`
- `shouldForceBootstrapForExternalRealtimeWindow(...)`
- `getCurrentAsrTransport(providerConfig)`

**注意:** `deriveAssemblerSignals`、`decideAssemblerByHardRules` 等已经是纯函数，但之前留在 index.ts 中与有状态函数紧密耦合。现在一起提取。

- [ ] **Step 1: 创建 assembler-machine.ts**
- [ ] **Step 2: 更新 index.ts 导入和调用**
- [ ] **Step 3: 运行 `pnpm run test:ext:contract && pnpm run test:ext:replay && pnpm typecheck`**
- [ ] **Step 4: 提交: `refactor(sw): 提取 assembler-machine 模块`**

---

### Task 7: 提取 `asr-stream-handlers.ts`

**Files:**
- 创建: `apps/extension/src/service-worker/asr-stream-handlers.ts`
- 修改: `apps/extension/src/service-worker/index.ts`

**提取函数（~120 行）:**
- `handleAsrStreamFinal(payload, S, callbacks)`
- `handleAsrStreamPartial(payload, S)`
- `handleAsrStreamStatus(payload, S)`
- `handleAsrStreamError(payload, S, notifyError)`

依赖：`S: RuntimeStateContainer`，回调注入 `enqueueTranscriptProcessing`、`notifySessionState`。

- [ ] **Step 1: 创建 asr-stream-handlers.ts**
- [ ] **Step 2: 更新 index.ts 导入和调用**
- [ ] **Step 3: 运行 `pnpm run test:ext:contract && pnpm typecheck`**
- [ ] **Step 4: 提交: `refactor(sw): 提取 asr-stream-handlers 模块`**

---

### Task 8: 提取 `structurer-executor.ts`

**Files:**
- 创建: `apps/extension/src/service-worker/structurer-executor.ts`
- 修改: `apps/extension/src/service-worker/index.ts`

**提取函数（~150 行）:**
- `runStructurerForTranscriptContext(context, S, callbacks)`
- `loadMergedGraphAsset(sessionId, repositories)`
- `buildMergedGraph(params)`

依赖：`S: RuntimeStateContainer`，`structurerProvider`（从 S 读取），`mergeTopics`/`buildMergedGraphFromState`（已提取的 graph-building），回调注入 `notifySessionState`、`persistRuntimeState`。

- [ ] **Step 1: 创建 structurer-executor.ts**
- [ ] **Step 2: 更新 index.ts 导入和调用**
- [ ] **Step 3: 运行 `pnpm run test:ext:contract && pnpm run test:ext:replay && pnpm typecheck`**
- [ ] **Step 4: 提交: `refactor(sw): 提取 structurer-executor 模块`**

---

### Task 9: 提取 `provider-management.ts`

**Files:**
- 创建: `apps/extension/src/service-worker/provider-management.ts`
- 修改: `apps/extension/src/service-worker/index.ts`

**提取函数（~100 行）:**
- `loadProviderRuntimeFromSettings(S, repositories, providerRegistry)`
- `applyProviderRuntime(config, S, providerRegistry)`
- `applyBootstrapProviderRuntime(S, providerRegistry)`
- `commitProviderRuntime(runtime, S)`
- `handleGetProviderSettings(S)`
- `handleSaveProviderSettings(config, S, repositories)`
- `handleClearProviderSecrets(S, repositories)`

依赖：`S: RuntimeStateContainer`，`providerRegistry`，`settingsRepository`。

- [ ] **Step 1: 创建 provider-management.ts**
- [ ] **Step 2: 更新 index.ts 导入和调用**
- [ ] **Step 3: 运行 `pnpm run test:ext:contract && pnpm typecheck`**
- [ ] **Step 4: 提交: `refactor(sw): 提取 provider-management 模块`**

---

### Task 10: 提取 `session-lifecycle.ts`

**Files:**
- 创建: `apps/extension/src/service-worker/session-lifecycle.ts`
- 修改: `apps/extension/src/service-worker/index.ts`

**提取函数（~260 行）:**
- `startSession(tabId, S, callbacks)`
- `stopSession(sessionId, S, callbacks)`
- `cleanupSession(payload, S, callbacks)`
- `flushPendingSessionFinalize(S, callbacks)`
- `handleCaptureEnded(tabId, payload, S, callbacks)`

**这是最复杂的提取**，因为 startSession/stopSession/cleanupSession 依赖几乎所有其他模块。通过回调注入解决：

```typescript
export interface SessionLifecycleCallbacks {
  ensureHydrated: () => Promise<void>;
  flushPendingSessionFinalize: () => Promise<void>;
  persistRuntimeState: () => Promise<void>;
  clearRuntimeState: () => Promise<void>;
  notifySessionState: (state: SessionState) => Promise<void>;
  resetAssemblerState: () => void;
  buildContentScriptStartPayload: (sessionId: string, providerConfig: ProviderConfig) => AppMessage;
  sendMessageToContentScript: (tabId: number, message: AppMessage) => Promise<void>;
  enqueueAudioChunk: (payload: AudioChunkPayload) => Promise<ServiceWorkerResponse>;
  waitForChunkQueueToSettle: () => Promise<void>;
  waitForTranscriptProcessingToSettle: () => Promise<void>;
  broadcastToSidepanel: (message: AppMessage) => Promise<void>;
}
```

- [ ] **Step 1: 创建 session-lifecycle.ts**
- [ ] **Step 2: 更新 index.ts — 构造 callbacks 对象并委托调用**
- [ ] **Step 3: 运行 `pnpm run test:ext:contract && pnpm run test:ext:replay && pnpm typecheck`**
- [ ] **Step 4: 提交: `refactor(sw): 提取 session-lifecycle 模块`**

---

### Task 11: 提取 `session-handlers.ts`

**Files:**
- 创建: `apps/extension/src/service-worker/session-handlers.ts`
- 修改: `apps/extension/src/service-worker/index.ts`

**提取函数（~130 行）:**
- `handleNodeClicked(payload, S)`
- `handleViewSelected(payload, S, persistRuntimeState)`
- `handleExportSession(payload, repositories)`
- `handleGetDebugSession(sessionId, S, repositories)`
- `loadDebugSessionData(sessionId, S, repositories)`
- `handleGetReplaySession(sessionId, repositories)`
- `loadReplaySessionData(sessionId, repositories)`
- `handleTestStructurerSessionRun(payload, S, callbacks)`
- `persistInjectedStructurerSeed(payload, S)`

依赖：`S: RuntimeStateContainer`，repository 实例，少量回调。

- [ ] **Step 1: 创建 session-handlers.ts**
- [ ] **Step 2: 更新 index.ts 导入和调用**
- [ ] **Step 3: 运行 `pnpm run test:ext:contract && pnpm typecheck`**
- [ ] **Step 4: 提交: `refactor(sw): 提取 session-handlers 模块`**

---

### Task 12: 清理 index.ts — 验证行数

**Files:**
- 修改: `apps/extension/src/service-worker/index.ts`

此时 index.ts 应只包含：
- imports（~30 行）
- `const S = new RuntimeStateContainer()` + repository 单例 + providerRegistry（~20 行）
- `persistenceDeps` + `callbacks` 对象构造（~40 行）
- `handleMessage` 路由函数（~50 行）
- Chrome 事件监听器（onInstalled, onClicked, onRemoved, onMessage, onSuspend）（~30 行）
- `nodeTypes` 等常量（~5 行）
- `applyBootstrapProviderRuntime()` 调用（~5 行）

- [ ] **Step 1: 确认 index.ts 行数 < 800**

```bash
wc -l apps/extension/src/service-worker/index.ts
```

预期：< 350 行。

- [ ] **Step 2: 运行全量三层测试**

```bash
pnpm run test:ext:contract && pnpm run test:ext:replay && pnpm typecheck && pnpm lint
```

- [ ] **Step 3: 提交: `refactor(sw): 完成架构重构，index.ts 降至 < 350 行`**

---

## Phase 3: Sidepanel — PanelReducer 收敛消息驱动状态

**核心问题：** App.tsx 有 ~20 个 useState 直接被 Chrome 消息 useEffect 的 6 个 case 逐个 set。如果直接提取 hooks，`useChromeMessages` 会变成一个接收 30 个 setter 的大函数，只是把复杂度搬了个位置。

**解决方案：** 先用 `useReducer` 将所有消息驱动的状态收敛到一个 `panelReducer`，然后 `useChromeMessages` 只需要 `dispatch` 一个 action。后续 hooks 从 reducer state 读取、通过 dispatch 修改，不再传递 setter 函数。

**状态归属原则：**
- `currentTimeMs` 由 reducer 唯一拥有（通过 `PLAYBACK_TIME_UPDATED` 和 `HYDRATE_SNAPSHOT` action 设置）
- replay 只 dispatch `REPLAY_SEEK` action，不直接 setCurrentTimeMs
- `statusNowMs` 独立于 reducer（它是 UI 本地 tick，非消息驱动），保留在 App.tsx 的 useState 中

### Task 13: 创建 `panel-reducer.ts` — 收敛消息驱动状态

**Files:**
- 创建: `apps/extension/src/sidepanel/panel-reducer.ts`
- 修改: `apps/extension/src/sidepanel/App.tsx`

**从 App.tsx 收敛到 reducer 的 useState（~20 个）：**

```
sessionState, sessionId, stopPending,
graph, currentView, currentTimeMs,
recentProviderError, lastStructurerRun, structuringSince,
lastTranscriptAt, lastGraphUpdatedAt,
pendingTranscriptCount, pendingWorkCount, stopDrainPendingCount,
currentStructurerTarget, workerBuildLabel, bridgeHealth,
selectedNodeId
```

**保留在 App.tsx 中的 useState（非消息驱动，UI 本地状态）：**

```
settingsOpen, settingsSaving, debugOpen, debugData,
replayOpen, replayPlaying, replayData,
logPanelHeight, autoTourStatus, autoTourProgress,
providerConfig, providerSummary, statusNowMs
```

- [ ] **Step 1: 创建 `panel-reducer.ts`**

```typescript
// panel-reducer.ts — 消息驱动的 panel 状态

import type { MergedGraph, ViewType } from '@listen-graphic/schema';
import type {
  RuntimeSnapshot,
  SessionState,
} from '../shared/messages';
import type { TimelineEvent } from './types';
import { createEmptyGraph } from './constants';

export interface PanelState {
  sessionState: SessionState;
  sessionId: string | null;
  stopPending: boolean;
  graph: MergedGraph;
  currentView: ViewType;
  currentTimeMs: number;
  selectedNodeId: string | null;
  recentProviderError: RuntimeSnapshot['lastProviderError'];
  lastStructurerRun: RuntimeSnapshot['lastStructurerRun'];
  structuringSince: number | null;
  lastTranscriptAt: number | null;
  lastGraphUpdatedAt: number | null;
  pendingTranscriptCount: number;
  pendingWorkCount: number;
  stopDrainPendingCount: number;
  currentStructurerTarget: RuntimeSnapshot['currentStructurerTarget'];
  workerBuildLabel: string;
  bridgeHealth: { status: string; detail?: string };
  timelineEvents: TimelineEvent[];
}

export const initialPanelState: PanelState = {
  sessionState: 'idle',
  sessionId: null,
  stopPending: false,
  graph: createEmptyGraph(),
  currentView: 'causal',
  currentTimeMs: 0,
  selectedNodeId: null,
  recentProviderError: null,
  lastStructurerRun: null,
  structuringSince: null,
  lastTranscriptAt: null,
  lastGraphUpdatedAt: null,
  pendingTranscriptCount: 0,
  pendingWorkCount: 0,
  stopDrainPendingCount: 0,
  currentStructurerTarget: null,
  workerBuildLabel: 'waiting',
  bridgeHealth: { status: 'idle' },
  timelineEvents: [],
};

// Action 类型：每个 Chrome 消息类型对应一个 action，加上 UI 本地 action
export type PanelAction =
  | { type: 'SESSION_STATE_CHANGED'; payload: { ... } }
  | { type: 'TRANSCRIPT_READY'; payload: { ... } }
  | { type: 'PROVIDER_PROGRESS'; payload: { ... } }
  | { type: 'MERGED_GRAPH_UPDATED'; payload: { ... } }
  | { type: 'PLAYBACK_TIME_UPDATED'; payload: { currentTimeMs: number } }
  | { type: 'ERROR'; payload: { code: string; message: string } }
  | { type: 'HYDRATE_SNAPSHOT'; payload: RuntimeSnapshot }
  | { type: 'RESET_CONTEXT' }
  | { type: 'PUSH_TIMELINE_EVENT'; payload: TimelineEvent }
  | { type: 'CLEAR_TIMELINE_TRANSIENT'; payload: { key: string } }
  | { type: 'FINALIZE_TIMELINE_TRANSIENT'; payload: { key: string; updates: Partial<TimelineEvent> } }
  | { type: 'SET_STOP_PENDING'; payload: boolean }
  | { type: 'SELECT_NODE'; payload: string | null }
  | { type: 'REPLAY_SEEK'; payload: { currentTimeMs: number } };

export function panelReducer(state: PanelState, action: PanelAction): PanelState {
  switch (action.type) {
    case 'SESSION_STATE_CHANGED': { ... }
    case 'TRANSCRIPT_READY': { ... }
    case 'PROVIDER_PROGRESS': { ... }
    case 'MERGED_GRAPH_UPDATED': { ... }
    case 'PLAYBACK_TIME_UPDATED': { ... }
    case 'ERROR': { ... }
    case 'HYDRATE_SNAPSHOT': { ... }
    case 'RESET_CONTEXT': { ... }
    case 'PUSH_TIMELINE_EVENT': { ... }
    case 'CLEAR_TIMELINE_TRANSIENT': { ... }
    case 'FINALIZE_TIMELINE_TRANSIENT': { ... }
    case 'SET_STOP_PENDING': { ... }
    case 'SELECT_NODE': { ... }
    case 'REPLAY_SEEK': { ... }
    default: return state;
  }
}
```

每个 case 的逻辑**精确复制**自 App.tsx 消息处理 useEffect（第 391-577 行）中对应 case 的 setState 调用。使用不可变更新模式（`{ ...state, field: newValue }`）。

- [ ] **Step 2: 在 App.tsx 中引入 useReducer，替换 ~20 个 useState**

```typescript
import { panelReducer, initialPanelState, type PanelState } from './panel-reducer';

// 替换 ~20 个 useState 为：
const [panel, dispatch] = useReducer(panelReducer, initialPanelState);

// 所有 panel.sessionState、panel.graph 等引用替换原来的裸变量
// 消息处理 useEffect 中的 20+ 个 setXxx 调用替换为 dispatch({ type: '...', payload: ... })
```

- [ ] **Step 3: 运行 `pnpm run test:ext:contract && pnpm typecheck`**

- [ ] **Step 4: 提交: `refactor(panel): 引入 panelReducer 收敛消息驱动状态`**

---

### Task 14: 提取 `useChromeMessages.ts` — 仅 dispatch action

**Files:**
- 创建: `apps/extension/src/sidepanel/hooks/useChromeMessages.ts`
- 修改: `apps/extension/src/sidepanel/App.tsx`

现在 `useChromeMessages` 只需要 `dispatch` 函数，不再需要 30 个 setter。消息处理 useEffect（第 391-577 行）的 6 个 case 变成 6 个 dispatch 调用。

**但注意：** 当前消息处理 effect 中还做了以下需要 ref 的操作：
- `userPinnedViewRef.current = ...`（SESSION_STATE_CHANGED 和 MERGED_GRAPH_UPDATED）
- `activeViewSessionRef.current = ...`（SESSION_STATE_CHANGED）
- `graphRef.current = ...`（通过 useEffect 同步，保留在 App.tsx）
- auto-tour seed 触发（MERGED_GRAPH_UPDATED → `pendingAutoTourRef`）
- replay 状态重置（SESSION_STATE_CHANGED stopped → dispatch action 已覆盖）

refs 通过 deps 注入：

```typescript
export function useChromeMessages(deps: {
  isDevMode: boolean;
  dispatch: React.Dispatch<PanelAction>;
  userPinnedViewRef: React.MutableRefObject<boolean>;
  activeViewSessionRef: React.MutableRefObject<string | null>;
  getPreferredView: (graph: MergedGraph, view?: ViewType | null) => ViewType;
  onAutoTourSeed?: (seed: AutoTourSeed) => void;  // 可选回调
}) { ... }
```

deps 列表从 30 个 setter 降到 6 个——这是引入 reducer 的直接收益。

- [ ] **Step 1: 创建 `hooks/useChromeMessages.ts`**
- [ ] **Step 2: 更新 App.tsx — 移除消息处理 useEffect，调用 hook**
- [ ] **Step 3: 运行 `pnpm run test:ext:contract && pnpm typecheck`**
- [ ] **Step 4: 提交: `refactor(panel): 提取 useChromeMessages hook`**

---

### Task 15: 提取 `useTimeline.ts`

**Files:**
- 创建: `apps/extension/src/sidepanel/hooks/useTimeline.ts`
- 修改: `apps/extension/src/sidepanel/App.tsx`

**提取逻辑（~130 行）:**

状态（从 reducer state 读取，通过 dispatch 修改）：
- `timelineEvents` → `panel.timelineEvents`

Ref（移入 hook）：
- `previousPendingTranscriptCountRef`
- `structurerSlowEventKeyRef`

回调：
- `pushTimelineEvent` → `dispatch({ type: 'PUSH_TIMELINE_EVENT', payload: event })`
- `clearTimelineTransient` → `dispatch({ type: 'CLEAR_TIMELINE_TRANSIENT', payload: { key } })`
- `finalizeTimelineTransient` → `dispatch({ type: 'FINALIZE_TIMELINE_TRANSIENT', payload: { key, updates } })`
- `addLog` → 内部调用 `pushTimelineEvent(createTimelineEvent(...))`

Effect：
- structurer 慢速检测（第 264-283 行）
- transcript backlog 追踪（第 285-306 行）

Hook 签名：
```typescript
export function useTimeline(deps: {
  dispatch: React.Dispatch<PanelAction>;
  panel: { sessionState: SessionState; sessionId: string | null; statusNowMs: number;
           structuringSince: number | null; pendingTranscriptCount: number;
           currentStructurerTarget: RuntimeSnapshot['currentStructurerTarget'];
           timelineEvents: TimelineEvent[] };
}) {
  return {
    pushTimelineEvent,
    clearTimelineTransient,
    finalizeTimelineTransient,
    addLog,
  };
}
```

- [ ] **Step 1: 创建 `hooks/useTimeline.ts`**
- [ ] **Step 2: 更新 App.tsx**
- [ ] **Step 3: 运行 `pnpm run test:ext:contract && pnpm typecheck`**
- [ ] **Step 4: 提交: `refactor(panel): 提取 useTimeline hook`**

---

### Task 16: 提取 `useAutoTour.ts`

**Files:**
- 创建: `apps/extension/src/sidepanel/hooks/useAutoTour.ts`
- 修改: `apps/extension/src/sidepanel/App.tsx`

**提取逻辑（~250 行）:** 与原计划相同——auto-tour 有自己的 7 个 ref 和 2 个 useState，逻辑自包含，不依赖 reducer。

- [ ] **Step 1: 创建 `hooks/useAutoTour.ts`**
- [ ] **Step 2: 更新 App.tsx**
- [ ] **Step 3: 运行 `pnpm run test:ext:contract && pnpm typecheck`**
- [ ] **Step 4: 提交: `refactor(panel): 提取 useAutoTour hook`**

---

### Task 17: 提取 `useProviderSettings.ts`

**Files:**
- 创建: `apps/extension/src/sidepanel/hooks/useProviderSettings.ts`
- 修改: `apps/extension/src/sidepanel/App.tsx`

**提取逻辑（~200 行）:** 与原计划相同——4 个 useState + 6 个回调，自包含。

- [ ] **Step 1: 创建 `hooks/useProviderSettings.ts`**
- [ ] **Step 2: 更新 App.tsx**
- [ ] **Step 3: 运行 `pnpm run test:ext:contract && pnpm typecheck`**
- [ ] **Step 4: 提交: `refactor(panel): 提取 useProviderSettings hook`**

---

### Task 18: 提取 `useStatusCards.ts`

**Files:**
- 创建: `apps/extension/src/sidepanel/hooks/useStatusCards.ts`
- 修改: `apps/extension/src/sidepanel/App.tsx`

**提取逻辑（~150 行）:** 纯派生函数，从 `panel` state 计算。不再需要单独 hook——可以直接作为 `deriveStatusCards(panel, viewScores, statusNowMs)` 纯函数调用。

- [ ] **Step 1: 创建 `hooks/useStatusCards.ts`（或直接作为 `status-cards.ts` 纯函数导出）**
- [ ] **Step 2: 更新 App.tsx**
- [ ] **Step 3: 运行 `pnpm run test:ext:contract && pnpm typecheck`**
- [ ] **Step 4: 提交: `refactor(panel): 提取 deriveStatusCards 纯函数`**

---

### Task 19: 提取 `useReplay.ts` + `useLogResize.ts`

**Files:**
- 创建: `apps/extension/src/sidepanel/hooks/useReplay.ts`
- 创建: `apps/extension/src/sidepanel/hooks/useLogResize.ts`
- 修改: `apps/extension/src/sidepanel/App.tsx`

**useReplay（~110 行）:**
- 状态：`replayOpen`, `replayPlaying`, `replayData`（本地 useState）
- `currentTimeMs`：由 reducer 拥有。replay 的 `handleReplayScrub` 改为 `dispatch({ type: 'REPLAY_SEEK', payload: { currentTimeMs } })`，不再直接 setCurrentTimeMs
- Memo：`activeReplayTranscript`
- Effect：replay reset on sessionId change（读 `panel.sessionId`），replay timer（dispatch REPLAY_SEEK）

**useLogResize（~80 行）:** 自包含，与原计划相同。

- [ ] **Step 1: 创建两个 hook 文件**
- [ ] **Step 2: 更新 App.tsx**
- [ ] **Step 3: 运行 `pnpm run test:ext:contract && pnpm typecheck`**
- [ ] **Step 4: 提交: `refactor(panel): 提取 useReplay + useLogResize hooks`**

---

## Phase 4: Sidepanel — 最终清理

### Task 20: 验证 App.tsx 行数 + 全量测试

**Files:**
- 修改: `apps/extension/src/sidepanel/App.tsx`

此时 App.tsx 应仅包含：
- imports（~40 行）
- `useReducer(panelReducer, initialPanelState)` + 解构（~10 行）
- hook 调用（useTimeline, useAutoTour, useProviderSettings, useChromeMessages, useReplay, useLogResize）（~20 行）
- 剩余 useMemo/useCallback（`flowNodes`, `flowEdges`, `viewScores`, `getPreferredView`, debug export 等）（~100 行）
- dev mode simulation useEffect（~70 行）
- JSX return（~200 行）

- [ ] **Step 1: 确认 App.tsx 行数 < 800**

```bash
wc -l apps/extension/src/sidepanel/App.tsx
```

预期：~400-500 行。

- [ ] **Step 2: 运行全量三层测试**

```bash
pnpm run test:ext:contract && pnpm run test:ext:replay && pnpm run test:ext:e2e && pnpm typecheck && pnpm lint
```

- [ ] **Step 3: 如 JSX 部分仍过长（>300 行），考虑提取 `TopBar` 或 `FooterBar` 子组件**
- [ ] **Step 4: 提交: `refactor(panel): 完成架构重构，App.tsx 降至 < 500 行`**

---

## 自检清单

### 1. 规格覆盖

| 需求 | 对应 Task |
|------|-----------|
| index.ts < 800 行 | Task 1-12 |
| App.tsx < 800 行 | Task 13-20 |
| 行为不变（所有测试通过） | 每个 Task 都有分层验证步骤 |
| 新模块放在现有目录中 | 所有新文件在 `service-worker/` 或 `sidepanel/hooks/` 下 |
| pendingSessionFinalize 语义不变 | Task 1 reset 方法明确不触碰此字段 |
| currentTimeMs 单一归属 | Task 13 reducer 唯一拥有，replay 通过 dispatch |

### 2. 占位符扫描

无 TBD、TODO、implement later。每个 Task 均有明确的文件、函数列表和验证命令。

### 3. 类型一致性

- `RuntimeStateContainer` 在 Task 1 定义，后续所有 Task 均引用同一类型
- `ActiveSession`、`PersistedRuntimeState` 从 `runtime-state.ts` 导出
- `PanelState`、`PanelAction` 在 Task 13 定义，后续所有 hook 引用同一类型
- `SessionLifecycleCallbacks` 在 Task 10 中定义，与之前 Task 提取的函数签名匹配

---

## 执行风险与注意事项

1. **RuntimeStateContainer 的 reset 语义** — `resetActiveRuntime()` 只重置三处 bulk-reset 的共同子集（14 个字段）。各调用处必须在此基础上追加自己的额外重置（`stoppingSessionId`、`lastStructurerRun` 等）。**绝不在 reset 中触碰 `pendingSessionFinalize`**。

2. **回调注入模式** — service-worker 模块间通过回调/接口注入解耦，避免循环依赖。index.ts 负责组装 callbacks 对象。

3. **panelReducer 不可变性** — reducer 中必须使用 `{ ...state, field: newValue }` 模式，不能 mutate。特别是 `timelineEvents` 的 upsert/finalize 操作需调用已有的纯函数（`upsertTimelineEvent`、`finalizeTransientEvent` 等）。

4. **测试覆盖** — 采用三层递进验证：
   - 每次提取后：`pnpm run test:ext:contract`
   - 触碰 session/transcript/structurer 流水线时追加：`pnpm run test:ext:replay`
   - Phase 完成后追加：`pnpm run test:ext:e2e`
   - 现有测试文件（`session-lifecycle.test.ts`、`state-persistence.test.ts`、`App.*.test.tsx`）应在每次提取后继续通过。

5. **dev mode simulation** — App.tsx 中的 dev mode useEffect（第 319-387 行）留在 App.tsx 中，因为它直接操作 `dispatch`/graph 且只在 dev mode 运行。引入 reducer 后，它的 `setGraph` 调用改为 `dispatch({ type: 'MERGED_GRAPH_UPDATED', ... })`。

6. **useChromeMessages 的 ref 操作** — 消息处理 effect 中仍有少量 ref 写入（`userPinnedViewRef`、`activeViewSessionRef`）。这些不能放进 reducer（reducer 必须是纯函数），通过 deps 注入保留在 hook 中。
