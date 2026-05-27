# Auto Tour Phase Label Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在侧栏图谱摘要条右侧的导览状态文案（如 `自动导览 1/3`）后面，用括号显示当前导览阶段：全览（structure）或细看（reading）。

**Architecture:** 两阶段导览已在 `buildTwoStageAutoTourStages()` 中为每个 stage 打上 `kind: 'structure' | 'reading'`，`useAutoTour` 也通过 `activeAutoTourStage` 暴露当前 stage。无需改 hook 或导览播放逻辑，只需新增一个纯函数把 `AutoTourStageKind` 映射为中文标签，并在 `App.tsx` 组装 `autoTourStatusText` 时追加 `(标签)`。暂停态同样显示，因为 `pauseAutoTour` 不会清空 `activeAutoTourStage`。

**Tech Stack:** TypeScript, React 18, Vitest, Testing Library（扩展侧栏单元测试）。

---

## File Structure

- Modify: `apps/extension/src/sidepanel/auto-tour-utils.ts`
  - 新增 `getAutoTourStageKindLabel()` 纯函数。
- Modify: `apps/extension/src/sidepanel/auto-tour-utils.test.ts`
  - 覆盖 kind → 中文标签映射。
- Modify: `apps/extension/src/sidepanel/App.tsx`
  - 在 `autoTourStatusText` 中拼接阶段括号。
- Modify: `apps/extension/src/sidepanel/App.graph-updates.test.tsx`
  - 更新/新增断言，验证 touring 与 paused 两种状态下的阶段文案。

不新增 hook 状态、不修改 `useAutoTour.ts`、不修改导览计算逻辑。

---

### Task 1: 添加阶段标签纯函数

**Files:**
- Modify: `apps/extension/src/sidepanel/auto-tour-utils.ts`
- Test: `apps/extension/src/sidepanel/auto-tour-utils.test.ts`

- [ ] **Step 1: 写失败测试**

在 `apps/extension/src/sidepanel/auto-tour-utils.test.ts` 末尾追加：

```ts
import { getAutoTourStageKindLabel } from './auto-tour-utils';

describe('getAutoTourStageKindLabel', () => {
  it('maps structure to 全览 and reading to 细看', () => {
    expect(getAutoTourStageKindLabel('structure')).toBe('全览');
    expect(getAutoTourStageKindLabel('reading')).toBe('细看');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter extension test:run auto-tour-utils.test.ts`

Expected: FAIL — `getAutoTourStageKindLabel is not exported` 或 `is not a function`

- [ ] **Step 3: 实现最小函数**

在 `apps/extension/src/sidepanel/auto-tour-utils.ts` 的「两阶段导览」区块上方或下方追加：

```ts
import type { AutoTourStageKind } from './types';

const AUTO_TOUR_STAGE_KIND_LABELS: Record<AutoTourStageKind, string> = {
  structure: '全览',
  reading: '细看',
};

/** 将导览 stage kind 转为状态条括号内显示的中文标签。 */
export function getAutoTourStageKindLabel(kind: AutoTourStageKind): string {
  return AUTO_TOUR_STAGE_KIND_LABELS[kind];
}
```

注意：若文件顶部已有 `AutoTourStage` 的 type import，把 `AutoTourStageKind` 合并进同一 import 行，避免重复 import。

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter extension test:run auto-tour-utils.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/extension/src/sidepanel/auto-tour-utils.ts apps/extension/src/sidepanel/auto-tour-utils.test.ts
git commit -m "feat(extension): add auto-tour stage kind label helper"
```

---

### Task 2: 在状态条文案中显示阶段括号

**Files:**
- Modify: `apps/extension/src/sidepanel/App.tsx:777-785`

- [ ] **Step 1: 写失败测试（集成级）**

在 `apps/extension/src/sidepanel/App.graph-updates.test.tsx` 中，找到已有断言 `自动导览 1/2` 的用例（约 873 行），将期望改为包含阶段标签。该用例新增 5 个链式节点，会触发 structure + reading 两阶段，因此：

- 第 1 段应为 `(全览)`
- 第 2 段应为 `(细看)`

把：

```ts
expect(screen.getByTestId('auto-tour-status')).toHaveTextContent(/自动导览 1\/2/);
// ...
expect(screen.getByTestId('auto-tour-status')).toHaveTextContent(/自动导览 2\/2/);
```

改为：

```ts
expect(screen.getByTestId('auto-tour-status')).toHaveTextContent(/自动导览 1\/2 \(全览\)/);
// ...
expect(screen.getByTestId('auto-tour-status')).toHaveTextContent(/自动导览 2\/2 \(细看\)/);
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter extension test:run App.graph-updates.test.tsx -t "长条状新增节点会拆成多段自动导览"`

Expected: FAIL — 实际文本仍为 `自动导览 1/2`，不含 `(全览)`

- [ ] **Step 3: 修改 App.tsx 状态文案**

1. 在 `App.tsx` import 区增加：

```ts
import { getAutoTourStageKindLabel } from './auto-tour-utils';
```

2. 在 `autoTourStatusText` 计算块（约 777–785 行）前，增加阶段后缀 helper：

```ts
const autoTourPhaseSuffix =
  activeAutoTourStage?.kind != null
    ? ` (${getAutoTourStageKindLabel(activeAutoTourStage.kind)})`
    : '';
```

3. 将 touring / paused 分支改为：

```ts
const autoTourStatusText =
  autoTourStatus === 'touring'
    ? `自动导览 ${autoTourProgress.current}/${autoTourProgress.total}${autoTourPhaseSuffix}`
    : autoTourStatus === 'paused'
      ? `导览暂停 ${autoTourProgress.current}/${autoTourProgress.total}${autoTourPhaseSuffix}`
      : isRunning
        ? '运行中'
        : '空闲';
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter extension test:run App.graph-updates.test.tsx -t "长条状新增节点会拆成多段自动导览"`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/extension/src/sidepanel/App.tsx apps/extension/src/sidepanel/App.graph-updates.test.tsx
git commit -m "feat(extension): show auto-tour phase label in status bar"
```

---

### Task 3: 覆盖暂停态与跳过结构揭示场景

**Files:**
- Modify: `apps/extension/src/sidepanel/App.graph-updates.test.tsx`

- [ ] **Step 1: 更新暂停态测试**

在 `用户刚手动移动画布后会暂停自动导览并在 7 秒后从下一段恢复` 用例（约 1005 行）中，暂停后断言应包含阶段括号。例如：

```ts
expect(screen.getByTestId('auto-tour-status')).toHaveTextContent(/导览暂停 \d+\/\d+ \(全览\)/);
```

若该用例在暂停时已处于 reading 阶段，则改为 `(细看)`——以测试运行时 `activeAutoTourStage.kind` 为准；可先 `screen.debug()` 或读现有 `pauseMatch` 的 current/total 推断阶段，再写精确 regex。

- [ ] **Step 2: 新增「跳过结构揭示」断言**

复用 `auto-tour-utils.test.ts` 中「没有有效锚点且没有新增内部边时跳过结构揭示」的 fixture 思路，在 `App.graph-updates.test.tsx` 增加短用例：仅 1 个孤立新增节点时，状态应显示 `(细看)` 而非 `(全览)`，且 total 为 1：

```ts
expect(screen.getByTestId('auto-tour-status')).toHaveTextContent(/自动导览 1\/1 \(细看\)/);
```

- [ ] **Step 3: 运行相关测试**

Run: `pnpm --filter extension test:run App.graph-updates.test.tsx -t "导览|auto-tour|自动导览|导览暂停"`

Expected: 所有匹配用例 PASS

- [ ] **Step 4: 运行扩展单元测试全量回归**

Run: `pnpm --filter extension test:run`

Expected: PASS（若有个别旧断言仍写 `/自动导览 \d+\/\d+/` 且不含括号，按同样模式批量更新）

- [ ] **Step 5: Commit**

```bash
git add apps/extension/src/sidepanel/App.graph-updates.test.tsx
git commit -m "test(extension): cover auto-tour phase labels for pause and reading-only tours"
```

---

## 手动验证

1. `pnpm dev:ext`，在 Chrome 加载扩展。
2. 触发一次 structurer 图更新（fixture lab 或 mock 会话均可）。
3. 观察图谱摘要条右侧：
   - 第一段：`自动导览 1/N (全览)`（若结构揭示被跳过则直接 `(细看)`）
   - 后续段：`自动导览 k/N (细看)`
4. 导览进行中拖动画布，确认暂停文案为 `导览暂停 k/N (阶段)`。

---

## Self-Review

| 需求 | 对应任务 |
|------|----------|
| 几/几 后面加括号 | Task 2 `autoTourPhaseSuffix` |
| 显示全览 vs 细看两阶段 | Task 1 label map + Task 2 读取 `activeAutoTourStage.kind` |
| 数据来自导览同一套计算 | 复用已有 `activeAutoTourStage`，不改 stage 构建 |
| 暂停态也显示 | Task 2 paused 分支 + Task 3 测试 |

无 TBD / TODO 占位；所有步骤含具体文件路径与代码。

---

## 备注（给实现者）

- **标签用词：** 用户描述为「全览阶段」与「仔细查看」；UI 用短标签 `全览` / `细看` 避免状态条过长。若产品希望改为 `结构揭示` / `阅读聚焦`（与设计文档一致），只需改 `AUTO_TOUR_STAGE_KIND_LABELS` 一处。
- **边界：** `activeAutoTourStage` 为 `null` 时不追加括号（idle 切换瞬间），正常 touring/paused 期间始终有值。
- **范围：** 仅 extension sidepanel；web-demo 无 auto-tour 状态条，无需改动。
