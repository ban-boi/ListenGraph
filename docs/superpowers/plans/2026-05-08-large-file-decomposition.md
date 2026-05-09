# 大文件分解重构实施计划

> **For agentic workers:** 使用 superpowers:executing-plans 按任务逐一实施。每个步骤使用 checkbox (`- [ ]`) 语法跟踪进度。

**目标:** 将 `index.ts` (2889行)、`App.tsx` (4257行) 及其测试文件分解到 800 行上限以下。

**架构:** 先提取纯函数（无副作用），再提取有界上下文模块，最后拆分测试文件。所有变更保持行为不变，每一步后运行测试验证。

**技术栈:** TypeScript, React, Vitest, Chrome MV3 Extension

---

## Phase 1: Service Worker `index.ts` 分解 (2889 行 → ~600 行)

重构策略：
- **纯函数**优先提取：无模块级状态依赖的函数直接移出
- **有状态函数**保留在 `index.ts` 中，但调用提取出的纯函数
- 新模块放在 `service-worker/` 目录下，用相对路径导入

### Task 1.1: 提取 `assembler-types.ts` — 汇编器类型与常量

**文件:**
- 创建: `apps/extension/src/service-worker/assembler-types.ts`
- 修改: `apps/extension/src/service-worker/index.ts:53-129,164-195`

- [ ] **Step 1: 创建 assembler-types.ts**

将以下类型从 index.ts 移动到新文件（行 53-129）:

```typescript
// assembler-types.ts — 汇编器相关类型与常量

import type { TranscriptChunk, TranscriptToken } from '@listen-graphic/schema';
import type { StructureUnitDebug } from '../shared/messages';

// ===== 类型定义 =====
export interface PendingStructureBuffer {
  utterances: TranscriptChunk[];
  startedAt: number;
  inflatedCharCount: number;
}

export type StructureUnitCommitReason =
  | 'bootstrap'
  | 'hard_rule_threshold'
  | 'hard_rule_force_flush'
  | 'hard_rule_merge_with_prev'
  | 'score_commit'
  | 'window_full'
  | 'stop_requested'
  | 'input_finished'
  | 'single_direct';

export interface StructureUnit {
  sessionId: string;
  unitIndex: number;
  utterances: TranscriptChunk[];
  transcriptTokens: TranscriptToken[];
  startMs: number;
  endMs: number;
  text: string;
  charCount: number;
  utteranceCount: number;
  reason: StructureUnitCommitReason;
  score?: number;
  createdAt: number;
}

export interface AssemblerSignals {
  totalUtterances: number;
  inflightDurationMs: number;
  isBootstrap: boolean;
  hasPending: boolean;
  bufferFull: boolean;
  hasPreviousWindowUtterance: boolean;
}

export type AssemblerDecision =
  | { action: 'skip_current' }
  | { action: 'wait' }
  | { action: 'commit'; reason: StructureUnitCommitReason; score?: number };

// ===== 汇编器配置常量 =====
export const ASSEMBLER_WINDOW_SIZE = 3;
export const ASSEMBLER_HARD_TIMEOUT_MS = 15_000;
export const ASSEMBLER_MAX_BUFFER_UTTERANCES = 5;
export const ASSEMBLER_MAX_BUFFER_CHARS = 800;
export const ASSEMBLER_SCORE_COMMIT_THRESHOLD = 0.7;
export const ASSEMBLER_TRIGGER_MIN_UTTERANCES = 2;
export const ASSEMBLER_FORCE_FLUSH_MIN_UTTERANCES = 3;
export const ASSEMBLER_FORCE_FLUSH_MIN_CHARS = 150;
```

- [ ] **Step 2: 从 index.ts 中移除已移动的类型和常量**
  - 删除行 53-129（类型定义）
  - 删除行 175-196（汇编器常量）
  - 添加 `import { ... } from './assembler-types';`

- [ ] **Step 3: 验证**
  ```bash
  pnpm typecheck
  pnpm --filter extension test:run
  ```

### Task 1.2: 提取 `assembler-decision.ts` — 纯汇编器决策函数

**文件:**
- 创建: `apps/extension/src/service-worker/assembler-decision.ts`
- 修改: `apps/extension/src/service-worker/index.ts`

以下纯函数从 index.ts 迁移到新文件（不依赖模块级可变状态）：

| 行号 | 函数名 | 签名 |
|------|--------|------|
| 1406-1412 | `hasEnoughBootstrapContext` | `(window: TranscriptChunk[]) → boolean` |
| 1414-1427 | `hasEnoughBatchBootstrapContext` | `(window: TranscriptChunk[]) → boolean` |
| 1429-1438 | `hasEnoughRealtimeBootstrapContext` | `(window: TranscriptChunk[]) → boolean` |
| 1440-1456 | `shouldForceBootstrapForCompletedRealtimeInput` | `(transcript, window) → boolean` |
| 1458-1471 | `shouldForceBootstrapForExternalRealtimeWindow` | `(window: TranscriptChunk[]) → boolean` |
| 1477-1483 | `getTranscriptWindowDurationMs` | `(window: TranscriptChunk[]) → number` |
| 1485-1487 | `getTranscriptWindowCharCount` | `(window: TranscriptChunk[]) → number` |
| 1489-1491 | `getEffectiveTranscriptWindowCharCount` | `(window: TranscriptChunk[]) → number` |
| 1493-1495 | `shouldSkipIncrementalStructuring` | `(transcript: TranscriptChunk) → boolean` |
| 1497-1499 | `getNormalizedTranscriptCharCount` | `(transcript: TranscriptChunk) → number` |
| 1501-1503 | `getEffectiveTranscriptCharCount` | `(transcript: TranscriptChunk) → number` |
| 1505-1511 | `isLowInformationTranscript` | `(transcript: TranscriptChunk) → boolean` |
| 1513-1522 | `appendToPendingStructureBuffer` | `(buffer, transcript) → PendingStructureBuffer` |
| 1524-1538 | `createPendingStructureBuffer` | `(utterances, startedAt) → PendingStructureBuffer` |
| 1540-1557 | `deriveAssemblerSignals` | `(buffer, transcript?, window?) → AssemblerSignals` |
| 1559-1613 | `decideAssemblerByHardRules` | `(transcript, buffer, signals) → AssemblerDecision \| null` |
| 1615-1625 | `decideAssemblerByScore` | `(score: number) → AssemblerDecision` |
| 1627-1641 | `scoreAssemblerBoundary` | `(buffer: PendingStructureBuffer) → number` |
| 1643-1654 | `isMergeWithPrevCandidate` | `(buffer: PendingStructureBuffer) → boolean` |
| 1656-1666 | `looksLikeIncompleteUtterance` | `(transcript: TranscriptChunk) → boolean` |
| 1668-1688 | `looksLikeCompletionAfterPrevious` | `(previous, current) → boolean` |
| 1690-1730 | `materializeAssemblerCommitContext` | `(transcript, reason, score?) → ...` |
| 1760-1795 | `materializeStructureUnit` | `(buffer, reason) → StructureUnit` |
| 1861-1887 | `expandSegmentEvidenceChunkIds` | `(segment, unit) → SegmentGraph` |
| 1853-1859 | `collapseTranscriptWindowWithStructureUnit` | `(window, unit) → TranscriptChunk[]` |
| 1889-1891 | `normalizeAssemblerText` | `(text: string) → string` |
| 1893-1895 | `hasTerminalPunctuation` | `(text: string) → boolean` |
| 1897-1903 | `hasIncompleteTailPattern` | `(text: string) → boolean` |
| 1906-1913 | `hasWeakSetupTailPattern` | `(text: string) → boolean` |
| 1915 | `INCOMPLETE_TAIL_RE` | RegExp 常量 |
| 1916 | `WEAK_SETUP_TAIL_RE` | RegExp 常量 |

- [ ] **Step 1: 创建 assembler-decision.ts 并复制所有纯函数**

新文件导入:
```typescript
import type { TranscriptChunk, SegmentGraph } from '@listen-graphic/schema';
import type { StructureUnitDebug } from '../shared/messages';
import {
  ASSEMBLER_HARD_TIMEOUT_MS,
  ASSEMBLER_MAX_BUFFER_UTTERANCES,
  ASSEMBLER_MAX_BUFFER_CHARS,
  ASSEMBLER_SCORE_COMMIT_THRESHOLD,
  ASSEMBLER_TRIGGER_MIN_UTTERANCES,
  ASSEMBLER_FORCE_FLUSH_MIN_UTTERANCES,
  ASSEMBLER_FORCE_FLUSH_MIN_CHARS,
  ASSEMBLER_WINDOW_SIZE,
  type AssemblerDecision,
  type AssemblerSignals,
  type PendingStructureBuffer,
  type StructureUnit,
  type StructureUnitCommitReason,
} from './assembler-types';
```

- [ ] **Step 2: 在 index.ts 中添加导入，删除函数体**
  ```typescript
  import {
    hasEnoughBootstrapContext,
    shouldSkipIncrementalStructuring,
    deriveAssemblerSignals,
    decideAssemblerByHardRules,
    decideAssemblerByScore,
    scoreAssemblerBoundary,
    isMergeWithPrevCandidate,
    looksLikeIncompleteUtterance,
    looksLikeCompletionAfterPrevious,
    materializeAssemblerCommitContext,
    materializeStructureUnit,
    collapseTranscriptWindowWithStructureUnit,
    expandSegmentEvidenceChunkIds,
    normalizeAssemblerText,
    hasTerminalPunctuation,
    hasIncompleteTailPattern,
  } from './assembler-decision';
  ```

- [ ] **Step 3: 运行类型检查和测试**
  ```bash
  pnpm typecheck
  pnpm --filter extension test:run
  ```

### Task 1.3: 提取 `provider-config.ts` — Provider 配置与错误处理

**文件:**
- 创建: `apps/extension/src/service-worker/provider-config.ts`
- 修改: `apps/extension/src/service-worker/index.ts`

提取以下纯函数（不依赖模块级可变状态）:

| 行号 | 函数名 | 职责 |
|------|--------|------|
| 2611-2613 | `isTimeoutProviderError` | 类型守卫 |
| 2682-2695 | `isSerializableProviderRequestError` | 类型守卫 |
| 2697-2731 | `serializeProviderError` | 错误序列化 |
| 2733-2748 | `createProviderConfigError` | 创建配置错误 |
| 2750-2807 | `mergeProviderSecrets` | 合并密钥 |
| 2809-2822 | `constrainProviderConfigToDirectMode` | 强制 direct 模式 |
| 2824-2835 | `stripProviderRetryOverrides` | 清除 retry 覆盖 |
| 2837-2839 | `hasProviderRetryOverrides` | 检测 retry 覆盖 |
| 2841-2857 | `stripProviderSecrets` | 清除密钥 |
| 2859-2864 | `sanitizeProviderError` | 清理错误 |
| 2866-2882 | `createExtensionDefaultProviderConfig` | 默认配置 |
| 2884-2897 | `normalizeAsrErrorCode` | 归一化错误码 |
| 2899-2901 | `toRecord` | 类型转换 |

- [ ] **Step 1: 创建 provider-config.ts，包含上述所有函数**

- [ ] **Step 2: 在 index.ts 中导入，删除原地定义**

- [ ] **Step 3: 验证**
  ```bash
  pnpm typecheck
  pnpm --filter extension test:run
  ```

### Task 1.4: 提取 `runtime-snapshots.ts` — 状态持久化与快照

**文件:**
- 创建: `apps/extension/src/service-worker/runtime-snapshots.ts`
- 修改: `apps/extension/src/service-worker/index.ts`

此模块包含需要访问 Chrome Storage API 和 IndexedDB 的函数，但通过参数化后可以独立：

| 函数名 | 参数化后的签名 |
|--------|----------------|
| `getRuntimeStorageArea` | `() → chrome.storage.StorageArea` |
| `withIndexedDbRetry` | `<T>(operation: () → Promise<T>) → Promise<T>` |
| `isIndexedDbBackingStoreError` | `(error: unknown) → boolean` |
| `buildRuntimeSnapshot` | 保留在 index.ts（需大量模块状态） |

将以下纯辅助函数提取:
- `getPendingTranscriptCount`
- `getPendingWorkCount`
- `getStopDrainPendingCount`

- [ ] **Step 1: 创建 runtime-snapshots.ts**

- [ ] **Step 2: 更新导入**

- [ ] **Step 3: 验证**
  ```bash
  pnpm typecheck
  pnpm --filter extension test:run
  ```

### Task 1.5: 提取 `debug-trace.ts` — 调试追踪与导出辅助

**文件:**
- 创建: `apps/extension/src/service-worker/debug-trace.ts`
- 修改: `apps/extension/src/service-worker/index.ts`

提取这些纯函数:

| 行号 | 函数名 |
|------|--------|
| 2039-2091 | `buildDebugTranscriptTraces` |
| 2506-2532 | `createStructurerRunDebug` |
| 2534-2556 | `finalizeStructurerRunDebug` |
| 2558-2566 | `attachStructurerRunDebug` |
| 2568-2586 | `getStructurerRunsForDebugSession` |
| 2588-2609 | `readStructurerRunDebug` |
| 2093-2097 | `getAssemblerRunsForDebugSession` |
| 2099-2103 | `getStructureUnitsForDebugSession` |

- [ ] **Step 1: 创建 debug-trace.ts**

- [ ] **Step 2: 更新 index.ts 导入**

- [ ] **Step 3: 验证**
  ```bash
  pnpm typecheck
  pnpm --filter extension test:run
  pnpm --filter extension test:contract
  pnpm --filter extension test:structure:stable
  ```

### Task 1.6: 最终验证 Phase 1

- [ ] **Step 1: 检查 index.ts 行数**
  ```bash
  wc -l apps/extension/src/service-worker/index.ts
  ```

- [ ] **Step 2: 运行完整测试套件**
  ```bash
  pnpm --filter extension test:run
  pnpm --filter extension test:contract
  pnpm --filter extension test:structure:stable
  pnpm typecheck
  pnpm lint
  ```

- [ ] **Step 3: Commit**
  ```bash
  git add apps/extension/src/service-worker/
  git commit -m "refactor(sw): 将 index.ts 拆分为 assembler、provider-config、debug-trace 等模块"
  ```

---

## Phase 2: Sidepanel `App.tsx` 分解 (4257 行 → ~700 行)

重构策略：
1. 先提取**组件外纯函数**（类型、工具函数、常量）— 零风险
2. 再提取 **JSX 子组件**（SettingsPanel, DebugPanel 等）— 需 prop 接口
3. 最后提取**自定义 Hook**（如需要进一步瘦身）

### Task 2.1: 提取 `types.ts` — 类型定义

**文件:**
- 创建: `apps/extension/src/sidepanel/types.ts`
- 修改: `apps/extension/src/sidepanel/App.tsx:131-225`

将以下类型移入新文件（行 131-225）:

| 类型名 | 行号 |
|--------|------|
| `ReactFlowDebugNodeData` | 131-138 |
| `ReactFlowDebugNode` | 140-145 |
| `ReactFlowDebugEdge` | 147-157 |
| `DebugViewArtifact` | 159-170 |
| `DebugExportMode` | 172 |
| `TimelineStage` | 173 |
| `TimelineTone` | 174 |
| `TimelineEvent` | 175-185 |
| `StatusCardTone` | 186 |
| `StatusCardData` | 187-192 |
| `StableNodePosition` | 194-197 |
| `EdgeHandleId, SourceHandleId, TargetHandleId` | 199-201 |
| `StableViewLayoutState` | 203-205 |
| `StableLayoutCache` | 207 |
| `ViewBounds` | 208-213 |
| `AutoTourSeed` | 214-219 |
| `AutoTourBatch` | 220-224 |
| `AutoTourStatus` | 225 |
| `GraphNodeData` | 883-891 |

- [ ] **Step 1: 创建 types.ts 并移动所有类型**

- [ ] **Step 2: 在 App.tsx 中添加 import**
  ```typescript
  import type {
    TimelineEvent, TimelineTone, TimelineStage,
    StatusCardTone, StatusCardData,
    DebugViewArtifact, DebugExportMode,
    StableLayoutCache, StableViewLayoutState,
    AutoTourSeed, AutoTourBatch, AutoTourStatus,
    ViewBounds, StableNodePosition,
    EdgeHandleId, SourceHandleId, TargetHandleId,
  } from './types';
  ```

- [ ] **Step 3: 验证**
  ```bash
  pnpm typecheck
  pnpm --filter extension test:run
  ```

### Task 2.2: 提取 `constants.ts` — 常量

**文件:**
- 创建: `apps/extension/src/sidepanel/constants.ts`
- 修改: `apps/extension/src/sidepanel/App.tsx`

将以下常量移入新文件:

| 来源行号 | 内容 |
|----------|------|
| 57-68 | `createEmptyGraph` |
| 70-99 | `MOCK_TRANSCRIPTS`, `NODE_TYPES`, `EDGE_TYPES`, `SPEAKERS` |
| 1058-1073 | `VIEW_TYPES`, `VIEW_LABELS` |
| 1077-1101 | `isDevMode`, `DEFAULT_LOG_PANEL_HEIGHT`, 各 `AUTO_REVEAL_*` 和 `AUTO_TOUR_*` 常量 |

- [ ] **Step 1: 创建 constants.ts**

- [ ] **Step 2: 更新 App.tsx 导入**

- [ ] **Step 3: 验证**
  ```bash
  pnpm typecheck
  pnpm --filter extension test:run
  ```

### Task 2.3: 提取 `graph-utils.ts` — 图布局与构建工具函数

**文件:**
- 创建: `apps/extension/src/sidepanel/graph-utils.ts`
- 修改: `apps/extension/src/sidepanel/App.tsx`

提取以下纯函数（约 640 行，行 237-879）:

| 函数名 | 行号 | 职责 |
|--------|------|------|
| `createEmptyStableLayoutCache` | 237 | 布局缓存初始化 |
| `getRendererGraph` | 247 | 渲染器图获取 |
| `getLaneX` | 262 | 泳道 X 坐标 |
| `isBranchNodeType` | 281 | 分支节点类型判断 |
| `getNodeRect` | 285 | 节点矩形计算 |
| `hasCollision` | 294 | 碰撞检测 |
| `findAvailablePosition` | 307 | 可用位置查找 |
| `getMaxYForLane` | 321 | 泳道最大 Y |
| `pickAnchorNodeId` | 334 | 锚点节点选择 |
| `getRectCenter` | 367 | 矩形中心 |
| `resolveEdgeHandles` | 374 | 边句柄解析 (exported) |
| `buildStableReactFlowDebugGraph` | 405 | 稳定布局图构建 |
| `buildReactFlowDebugGraph` | 538 | 基础图构建 |
| `buildDebugViewArtifacts` | 570 | 调试视图 artifacts |

- [ ] **Step 1: 创建 graph-utils.ts**

- [ ] **Step 2: 更新 App.tsx — 从 graph-utils 导入，移除函数体**

- [ ] **Step 3: 验证**
  ```bash
  pnpm typecheck
  pnpm --filter extension test:run
  ```

### Task 2.4: 提取 `timeline-utils.ts` — 时间轴工具函数

**文件:**
- 创建: `apps/extension/src/sidepanel/timeline-utils.ts`
- 修改: `apps/extension/src/sidepanel/App.tsx`

提取以下纯函数 (约 230 行，行 1103-1332):

| 函数名 | 行号 |
|--------|------|
| `clampLogPanelHeight` | 1103 |
| `formatErrorStageLabel` | 1110 |
| `formatRelativeAge` | 1114 |
| `createTimelineEvent` | 1129 |
| `upsertTimelineEvent` | 1150 |
| `stripTimelineTransientEvents` | 1180 |
| `finalizeTransientEvent` | 1184 |
| `formatTimelineTimestamp` | 1196 |
| `classifyProgressTone` | 1200 |
| `bridgeHealthToTone` | 1212 |
| `formatTimelineStageLabel` | 1219 |
| `getTimelineToneStyles` | 1232 |
| `getStatusCardStyles` | 1269 |
| `timelineEventsToExportLines` | 1330 |

- [ ] **Step 1: 创建 timeline-utils.ts**

- [ ] **Step 2: 更新 App.tsx 导入**

- [ ] **Step 3: 验证**
  ```bash
  pnpm typecheck
  pnpm --filter extension test:run
  ```

### Task 2.5: 提取 `auto-tour-utils.ts` — 自动导览工具函数

**文件:**
- 创建: `apps/extension/src/sidepanel/auto-tour-utils.ts`
- 修改: `apps/extension/src/sidepanel/App.tsx`

提取以下纯函数 (约 200 行，行 1337-1470):

| 函数名 | 行号 |
|--------|------|
| `getAddedNodeIds` | 1337 |
| `getAutoRevealAnchorNodeIds` | 1344 |
| `getNodeBounds` | 1371 |
| `mergeViewBounds` | 1380 |
| `expandViewBounds` | 1394 |
| `ensureMinimumBoundsSize` | 1403 |
| `getAutoRevealMinimumBoundsSize` | 1423 |
| `isViewportCloseToTarget` | 1444 |
| `estimateAutoTourDwellMs` | 1455 |
| `buildAutoTourBatches` | 1468 |

- [ ] **Step 1: 创建 auto-tour-utils.ts**

- [ ] **Step 2: 更新 App.tsx 导入**

- [ ] **Step 3: 验证**
  ```bash
  pnpm typecheck
  pnpm --filter extension test:run
  ```

### Task 2.6: 提取 `provider-helpers.ts` — Provider 配置辅助函数

**文件:**
- 创建: `apps/extension/src/sidepanel/provider-helpers.ts`
- 修改: `apps/extension/src/sidepanel/App.tsx`

提取以下纯函数 (约 115 行，行 765-879):

| 函数名 | 行号 |
|--------|------|
| `renderSecretHint` | 765 (如果纯的话) |
| `getStageCredentialState` | 784 |
| `pinProviderConfigToDirectMode` | 800 |
| `createExtensionDefaultProviderConfigForUi` | 815 |
| `getProviderTypeSelectValue` | 833 |
| `resetProviderEntryForTypeChange` | 848 |

- [ ] **Step 1: 创建 provider-helpers.ts**

- [ ] **Step 2: 更新 App.tsx 导入**

- [ ] **Step 3: 验证**
  ```bash
  pnpm typecheck
  pnpm --filter extension test:run
  ```

### Task 2.7: 提取 `debug-export-utils.ts` — 调试导出辅助函数

**文件:**
- 创建: `apps/extension/src/sidepanel/debug-export-utils.ts`
- 修改: `apps/extension/src/sidepanel/App.tsx`

提取以下纯函数 (约 140 行，行 592-731):

| 函数名 | 行号 |
|--------|------|
| `summarizeTranscriptUnit` | 592 |
| `summarizeSegment` | 614 |
| `summarizeStructurerRun` | 636 |
| `summarizeDebugData` | 643 |
| `buildDebugExportPayload` | 681 |
| `readStructurerRunDebug` | 708 |
| `downloadTextFile` | 731 |
| `formatGraphDeltaLog` | 744 |

- [ ] **Step 1: 创建 debug-export-utils.ts**

- [ ] **Step 2: 更新 App.tsx 导入**

- [ ] **Step 3: 验证**
  ```bash
  pnpm typecheck
  pnpm --filter extension test:run
  ```

### Task 2.8: 提取 `GraphNodeCard.tsx` — 自定义节点组件

**文件:**
- 创建: `apps/extension/src/sidepanel/GraphNodeCard.tsx`
- 修改: `apps/extension/src/sidepanel/App.tsx:881-1056`

此组件大约 175 行，定义在 App.tsx 外部，可以独立提取。需要传入 props：`data` (GraphNodeData), `selected`, `sourcePosition`, `targetPosition`。

- [ ] **Step 1: 创建 GraphNodeCard.tsx，将组件代码移入**

```typescript
// GraphNodeCard.tsx
import React, { memo } from 'react';
import { Handle, Position } from 'reactflow';
import type { GraphNodeData } from './types';

interface GraphNodeCardProps {
  data: GraphNodeData;
  selected?: boolean;
  sourcePosition?: Position;
  targetPosition?: Position;
}

const GraphNodeCard: React.FC<GraphNodeCardProps> = /* ... 现有组件代码 */;

export default memo(GraphNodeCard);
```

- [ ] **Step 2: 在 App.tsx 中导入 GraphNodeCard**
  ```typescript
  import GraphNodeCard from './GraphNodeCard';
  ```

- [ ] **Step 3: 验证**
  ```bash
  pnpm typecheck
  pnpm --filter extension test:run
  ```

### Task 2.9: 提取 `SettingsPanel.tsx` — 设置面板子组件

**文件:**
- 创建: `apps/extension/src/sidepanel/SettingsPanel.tsx`
- 修改: `apps/extension/src/sidepanel/App.tsx:3540-3938`

Props 接口:
```typescript
interface SettingsPanelProps {
  settingsOpen: boolean;
  settingsSaving: boolean;
  providerConfig: ProviderConfig;
  workerBuildLabel: string;
  onToggle: () => void;
  onSave: () => void;
  onClearSecrets: () => void;
  onUpdateEntry: (stage, field, value) => void;
  onTypeChange: (stage, providerType) => void;
  onClose: () => void;
}
```

- [ ] **Step 1: 创建 SettingsPanel.tsx**

- [ ] **Step 2: 在 App.tsx 中使用 `<SettingsPanel ... />` 替换内联 JSX**

- [ ] **Step 3: 验证**
  ```bash
  pnpm typecheck
  pnpm --filter extension test:run
  ```

### Task 2.10: 提取 `DebugPanel.tsx` 和 `ReplayPanel.tsx` 和 `StatusCards.tsx`

**文件:**
- 创建: `apps/extension/src/sidepanel/DebugPanel.tsx` (行 4089-4177, ~90行)
- 创建: `apps/extension/src/sidepanel/ReplayPanel.tsx` (行 4178-4229, ~52行)
- 创建: `apps/extension/src/sidepanel/LogPanel.tsx` (行 4006-4088, ~83行)
- 创建: `apps/extension/src/sidepanel/StatusCards.tsx` (行 3394-3495, ~100行)

- [ ] **Step 1: 创建四个子组件文件**

- [ ] **Step 2: 在 App.tsx 中使用组件替换 JSX**

- [ ] **Step 3: 验证**
  ```bash
  pnpm typecheck
  pnpm --filter extension test:run
  ```

### Task 2.11: 最终验证 Phase 2

- [ ] **Step 1: 检查 App.tsx 行数**
  ```bash
  wc -l apps/extension/src/sidepanel/App.tsx
  ```

- [ ] **Step 2: 运行完整测试套件**
  ```bash
  pnpm --filter extension test:run
  pnpm typecheck
  pnpm lint
  ```

- [ ] **Step 3: Commit**
  ```bash
  git add apps/extension/src/sidepanel/
  git commit -m "refactor(sidepanel): 将 App.tsx 拆分为工具模块和子组件"
  ```

---

## Phase 3: 测试文件拆分

### Task 3.1: 拆分 `index.test.ts` (2787 行 → 约 6 个文件)

**策略:** 按功能类别拆分，共享 setup 提取到 `test-helpers.ts`。

- [ ] **Step 1: 创建共享测试 helpers**
  文件: `apps/extension/src/service-worker/__test-helpers__/index-test-helpers.ts`

  提取内容（行 5-423）:
  - `messageListeners`, `dispatchMessage`, `storageState` 变量
  - 所有 `*Mock` 变量声明
  - `beforeEach` mock 初始化逻辑
  - `initializeModule` 函数
  - 辅助函数: `sendAudioChunk`, `bootstrapStructurerWindow`, `mockRealtimeProviderConfig`, `startRealtimeSession`, `startExternalRealtimeSession`, `sendStableUtterance`, `runInjectedStructurerSession`

- [ ] **Step 2: 创建 `session-lifecycle.test.ts`**

  测试用例（从原始文件移入）:
  - 注册扩展生命周期监听器
  - 启动会话时会通知 content script 开始捕获
  - 腾讯 realtime 配置会把一次性 WebSocket 参数下发给 content script
  - Local ASR Bridge 配置会把通用 websocket 参数下发给 content script
  - 扩展重载后当前标签页缺少 content script 时，会重新注入并重试启动采集
  - 启动会话时会写入 session 资产记录
  - 如果 session 资产写入失败，会回滚 worker 状态
  - 如果 content script 拒绝非标签页共享目标，会回滚会话状态
  - provider 配置错误会写入 lastProviderError
  - 收到 CAPTURE_ENDED 后会清理活动会话
  - 会话结束时会标记 session 资产已结束
  - 即使 markEnded 失败，也会完成内存态与 runtime state 清理
  - 停止请求如果带着旧 sessionId，不会误清理当前活动会话

- [ ] **Step 3: 创建 `audio-processing.test.ts`**

  测试用例:
  - 收到音频 chunk 后会广播 transcript 与 graph 更新
  - 收到音频 chunk 后会通过 providers 契约处理 transcript 与 segment
  - 前两个 10 秒 chunk 只累计上下文，不会提前触发 structurer
  - 收到音频 chunk 后会持久化 transcript 与 merged graph 资产
  - 多个音频 chunk 会串行处理，避免并发触发多个 ASR 请求
  - 如果 transcript 落库失败，不会推进 runtime transcript 与时间状态
  - IndexedDB backing store 短暂失败时会重试 transcript 落库
  - IndexedDB backing store 持续失败时仍会保留内存态 graph
  - runtime state 持久化命中 backing store 异常时不会中断 chunk 处理
  - 如果 merged graph 落库失败，不会把未落盘 graph 暴露到 runtime snapshot

- [ ] **Step 4: 创建 `realtime-asr.test.ts`**

  测试用例:
  - 收到腾讯实时稳定句段后会持久化 transcript 并驱动 structurer
  - 腾讯 realtime 在达到 3 条稳定句段但未达字数或时长阈值时不会 bootstrap
  - external realtime 在 3 条短稳定句段后会启动首轮 bootstrap
  - 腾讯 realtime 会在累计时长达到阈值时启动 bootstrap
  - 实时输入在 input_finished final 到达时会为短会话兜底 bootstrap
  - 实时输入结束兜底不会为低信息量话语创建 graph

- [ ] **Step 5: 创建 `assembler.test.ts`**

  测试用例:
  - 已有 merged graph 时，会先缓冲单条增量 utterance，再将多条 utterance 聚合为一个 structure unit
  - 已有 merged graph 时，会将明显半句和补完句以 merge_with_prev 提交
  - 已有 merged graph 时，不会把完整句误判为 merge_with_prev
  - 已有 merged graph 时，会跳过低信息量稳定话语，不触发 structurer

- [ ] **Step 6: 创建 `export-debug-replay.test.ts`**

  测试用例:
  - 调试会话会返回 transcript、segment 和逐轮 trace
  - ws 调试会话会暴露 assembler 运行与 structure unit
  - structurer 抛出带 structurerDiagnostics 时，debug 与 lastProviderError 保留诊断
  - structure-focused 注入链路会绕过 ASR，直接驱动真实 structurer 挂点
  - structure-focused 注入链路支持以现有 graph 作为增量上下文
  - structure-focused 导出会在 merged graph 缺失时从 segments 重建 graph
  - 可以导出当前会话的 JSON 资产
  - 导出的 JSON 资产包含 assembler 调试数据
  - 缺少 graph 资产时不会导出 Mermaid
  - 当前会话处于 transcribing 时不会导出不一致快照
  - 可以返回当前会话的 debug 资产快照
  - runtime snapshot 会暴露当前 pending assembler 状态
  - 可以返回会话回放所需的 transcript 和时长

- [ ] **Step 7: 创建 `state-persistence.test.ts`**

  测试用例:
  - worker 重载后仍可从持久化状态恢复快照
  - runtime state 丢失时会从 storage 恢复最近会话资产
  - runtime state 丢失时只会恢复最近一个已结束会话的资产
  - worker 重载后仍会恢复用户手选视图
  - worker 重载后若标签页被关闭，仍会清理持久化会话
  - 可以返回当前运行时快照供 sidepanel 冷启动恢复
  - 节点点击时会把跳转请求转发给原始 tab
  - stop 发生在 transcribing 中途时会中断当前 chunk 并立即清理会话
  - stop 会等待实时链路上 structuring 挂起结束后再清理
  - stop 先发出而最后一个 chunk 后到时，会直接丢弃该 chunk 并完成清理

- [ ] **Step 8: 验证所有测试文件**
  ```bash
  pnpm --filter extension test:run
  ```

### Task 3.2: 拆分 `App.test.tsx` (4025 行 → 约 6 个文件)

**策略:** 同样按功能类别拆分，共享 ReactFlow mock 提取。

- [ ] **Step 1: 创建共享 test helpers**
  文件: `apps/extension/src/sidepanel/__test-helpers__/app-test-helpers.tsx`

  提取内容（行 1-278）:
  - ReactFlow mock (`vi.mock('reactflow', ...)`)
  - `renderApp` 辅助函数
  - `beforeEach` mock 初始化
  - Chrome API mock 辅助
  - `reactFlowFitViewSpy`, `reactFlowFitBoundsSpy` 等公共 spy

- [ ] **Step 2: 创建 `App.rendering.test.tsx`**

  测试用例（约 350 行）:
  - should render log area
  - should display log content
  - should render runtime status cards
  - dragging log divider adjusts height
  - should render start/stop buttons
  - should render view toggle buttons
  - should render bottom status bar
  - should display UI and Worker build labels
  - snapshot with lastProviderError shows error
  - error received shows error, subsequent success clears it

- [ ] **Step 3: 创建 `App.settings.test.tsx`**

  测试用例（约 800 行）:
  - opening settings panel fetches provider config
  - saving settings sends provider config to service worker
  - history relay config retains direct mode
  - switching to Zhipu GLM fills defaults
  - switching to Baidu Qianfan fills defaults
  - switching to Aliyun Bailian fills defaults
  - structurer type can switch to Zhipu GLM
  - saving Tencent config sends undefined for empty secrets
  - Tencent realtime config saves with transport and appId
  - Local ASR Bridge saves endpoint, protocol, auth token
  - saved Tencent keys are not echoed in plaintext

- [ ] **Step 4: 创建 `App.graph-updates.test.tsx`**

  测试用例（约 800 行）:
  - nodes render with four-direction handles
  - default view edges have geometric anchor handles
  - same-session graph updates do not auto-switch views
  - edge-only updates preserve existing node positions
  - new node updates use animated fitBounds
  - long strip of new nodes breaks into auto-tour segments
  - view already close triggers early segmentation
  - new nodes within viewport still get focused
  - user manual pan pauses auto-tour, resumes after 3s

- [ ] **Step 5: 创建 `App.session.test.tsx`**

  测试用例（约 500 行）:
  - clicking start changes state
  - session recovery on cold start
  - session recovery after stop does not switch views
  - no seek message on node click for stopped sessions
  - export JSON triggers worker request and download
  - export enabled after stopped even without new session
  - transcribing state disables export
  - starting new capture clears old context

- [ ] **Step 6: 创建 `App.logging.test.tsx`**

  测试用例（约 600 行）:
  - provider progress writes Tencent debug progress to log
  - structurer started/finished writes to event stream
  - consecutive Tencent realtime partial results collapse to single line
  - non-streaming Tencent ASR progress appends normally
  - TRANSCRIPT_READY clears streaming line before writing
  - structuring beyond threshold shows delayed status
  - structurer status card shows current target and backlog
  - backlog too large shows congested status
  - repeated queue events are folded with count

- [ ] **Step 7: 创建 `App.export-debug-replay.test.tsx`**

  测试用例（约 500 行）:
  - debug panel shows session debug data
  - debug panel supports exporting debug JSON with derived views
  - replay fetches replay assets and shows current segment
  - replay advances current time

- [ ] **Step 8: 验证所有测试文件**
  ```bash
  pnpm --filter extension test:run
  ```

### Task 3.3: 修复测试文件中的 `any` 类型

- [ ] **Step 1: 在 index.test.ts 各子文件中替换 `any` 类型**

  主要变更点:
  - mock 变量声明：使用具体 mock 函数类型 `ReturnType<typeof vi.fn>`
  - `chrome` API 使用 `chromeMocks` 命名空间类型
  - `message` 参数使用 `AppMessage` 联合类型
  - 临时变量使用推断类型或显式 typed

- [ ] **Step 2: 在 App.test.tsx 各子文件中替换 `any` 类型**

  主要变更点:
  - ReactFlow mock props 使用具体组件类型
  - spy 变量使用 `ReturnType<typeof vi.spyOn>`
  - `message` listener 参数使用具体消息类型

- [ ] **Step 3: 验证**
  ```bash
  pnpm typecheck
  pnpm lint
  pnpm --filter extension test:run
  ```

---

## 风险与缓解

| 风险 | 缓解措施 |
|------|---------|
| 大量函数移动导致合并冲突 | 每个 Task 后立即 commit |
| 类型导入遗漏导致编译失败 | 每个 Task 后运行 `pnpm typecheck` |
| 纯函数判断错误导致运行时行为变化 | 优先移动明确无副作用的函数，每个 Task 后运行测试 |
| 测试拆分导致 setup 逻辑不一致 | 共享 helpers 集中管理 mock 逻辑 |
| `any` 类型替换引入类型错误 | 逐步替换，每次替换后运行 typecheck |

## 预期结果

| 文件 | 当前行数 | 目标行数 |
|------|---------|---------|
| `index.ts` | 2889 | ~600 |
| `assembler-decision.ts` | (新) | ~500 |
| `provider-config.ts` | (新) | ~300 |
| `runtime-snapshots.ts` | (新) | ~350 |
| `debug-trace.ts` | (新) | ~250 |
| `App.tsx` | 4257 | ~700 |
| `graph-utils.ts` | (新) | ~640 |
| `timeline-utils.ts` | (新) | ~230 |
| `auto-tour-utils.ts` | (新) | ~200 |
| `provider-helpers.ts` | (新) | ~120 |
| `debug-export-utils.ts` | (新) | ~140 |
| `types.ts` (sidepanel) | (新) | ~120 |
| `constants.ts` (sidepanel) | (新) | ~60 |
| `SettingsPanel.tsx` | (新) | ~400 |
| `GraphNodeCard.tsx` | (新) | ~180 |
| `GraphViewer.tsx` | (新) | ~300 |
| 各测试文件 | 2787/4025 | 每文件 <600 |
