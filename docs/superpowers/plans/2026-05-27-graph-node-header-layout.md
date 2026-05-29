# Graph Node Header Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `GraphNodeCard` 抽到 `@listen-graphic/ui` 供 extension 与 web-demo 共用，然后在共享组件内把「语义类型」与「时间戳」合并到同一顶栏（左类型、右时间），正文独占第二行。

**Architecture:** 分两阶段执行。**Phase A（抽取）**：以 extension 现有 `GraphNodeCard.tsx` 为真源，迁入 `packages/ui`，extension / web-demo 改为 import 共享组件；抽取阶段不改变视觉与行为。**Phase B（布局）**：仅在 `packages/ui` 内合并类型行与时间行；两边 app 自动同步。extension 继续使用 `handleMode="multi"`（八向 handle + testid，供 `graph-utils` 边路由）；web-demo 使用 `handleMode="simple"`（顶 target / 底 source）。

**Tech Stack:** TypeScript, React 18, React Flow, Vitest, Testing Library, pnpm workspace（`packages/ui`、`apps/extension`、`apps/web-demo`）。

---

## 现状

| 位置 | 状态 |
|------|------|
| `apps/extension/src/sidepanel/GraphNodeCard.tsx` | 完整实现：compact/readable、导览态、八向 Handle |
| `apps/web-demo/src/App.tsx` | 内联简化副本：无 compact、仅上下 Handle、样式略大 |
| `packages/ui/src/index.ts` | 空 placeholder |
| Vite alias | 两 app 已配置 `@listen-graphic/ui`，但 `package.json` 尚未声明依赖 |

当前三行布局（extension 真源）：

| 行 | 内容 |
|----|------|
| 1 | 类型 badge + 可选「草稿」 |
| 2 | 节点正文 `label` |
| 3 | 左：`speaker`（可选） / 右：可点击时间 |

## 目标布局（Phase B 完成后）

| 行 | 内容 |
|----|------|
| 1 | 左：类型 badge + 可选「草稿」 / 右：可点击时间 |
| 2 | 节点正文 `label` |
| 3（可选） | 仅当 `speaker` 有值时显示说话人 |

---

## File Structure（完成后）

```
packages/ui/src/
  index.ts                      # 公开 export
  types.ts                      # GraphNodeCardData, GraphNodeHandleMode, GraphNodeDisplayMode
  graph-node-utils.ts           # formatGraphNodeTime, getGraphNodeTypeColor, getGraphNodeTypeLabel
  constants.ts                  # GRAPH_NODE_BODY_FONT_PX
  GraphNodeCard.tsx             # 共享 React Flow 节点组件
  GraphNodeCard.test.tsx        # 组件测试（Phase B 布局断言在此）
  vitest.config.ts              # jsdom + react plugin

apps/extension/src/sidepanel/
  GraphNodeCard.tsx             # 删除
  types.ts                      # GraphNodeData 改为 re-export / alias
  App.tsx                       # import 自 @listen-graphic/ui

apps/web-demo/src/
  App.tsx                       # 删除内联 GraphNodeCard 与重复 utils，import 共享组件
```

---

## Phase A — 抽取共享 GraphNodeCard（行为不变）

### Task 1: 搭建 `packages/ui` 测试与依赖

**Files:**
- Modify: `packages/ui/package.json`
- Create: `packages/ui/vitest.config.ts`
- Modify: `packages/ui/tsconfig.json`

- [ ] **Step 1: 更新 `packages/ui/package.json`**

```json
{
  "name": "@listen-graphic/ui",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "lint": "eslint src --ext .ts,.tsx",
    "test": "vitest",
    "test:run": "vitest run"
  },
  "dependencies": {
    "@listen-graphic/schema": "workspace:*",
    "react": "^18.0.0",
    "reactflow": "^11.0.0"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.6.3",
    "@testing-library/react": "^16.2.0",
    "@vitejs/plugin-react": "^4.3.4",
    "jsdom": "^26.0.0",
    "vitest": "^1.6.0"
  }
}
```

- [ ] **Step 2: 创建 `packages/ui/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
  resolve: {
    alias: {
      '@listen-graphic/schema': resolve(__dirname, '../schema/src'),
    },
  },
});
```

- [ ] **Step 3: 创建 `packages/ui/src/test-setup.ts`**

```ts
import '@testing-library/jest-dom';
```

- [ ] **Step 4: 确保 `packages/ui/tsconfig.json` 含 JSX**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist"
  },
  "include": ["src"]
}
```

（`tsconfig.base.json` 已有 `"jsx": "react-jsx"`，无需额外改动。）

- [ ] **Step 5: 安装依赖**

Run: `pnpm install`

Expected: lockfile 更新，无 peer dependency 错误。

- [ ] **Step 6: Commit**

```bash
git add packages/ui/package.json packages/ui/vitest.config.ts packages/ui/src/test-setup.ts
git commit -m "chore(ui): add vitest and reactflow dependencies for GraphNodeCard"
```

---

### Task 2: 迁入共享类型与工具函数

**Files:**
- Create: `packages/ui/src/types.ts`
- Create: `packages/ui/src/graph-node-utils.ts`
- Create: `packages/ui/src/constants.ts`
- Create: `packages/ui/src/graph-node-utils.test.ts`
- Modify: `packages/ui/src/index.ts`

- [ ] **Step 1: 写 utils 失败测试**

Create `packages/ui/src/graph-node-utils.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import {
  formatGraphNodeTime,
  getGraphNodeTypeColor,
  getGraphNodeTypeLabel,
} from './graph-node-utils';

describe('graph-node-utils', () => {
  it('formats milliseconds as M:SS', () => {
    expect(formatGraphNodeTime(65_000)).toBe('1:05');
    expect(formatGraphNodeTime(90_000)).toBe('1:30');
  });

  it('maps node types to Chinese labels and colors', () => {
    expect(getGraphNodeTypeLabel('claim')).toBe('观点');
    expect(getGraphNodeTypeColor('claim')).toBe('#3b82f6');
    expect(getGraphNodeTypeLabel('unknown')).toBe('unknown');
    expect(getGraphNodeTypeColor('unknown')).toBe('#6b7280');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @listen-graphic/ui test:run graph-node-utils.test.ts`

Expected: FAIL — module not found

- [ ] **Step 3: 实现 utils / types / constants**

`packages/ui/src/types.ts`:

```ts
export type GraphNodeDisplayMode = 'readable' | 'compact';

export type GraphNodeHandleMode = 'simple' | 'multi';

export interface GraphNodeCardData {
  label: string;
  nodeType: string;
  speaker?: string;
  timestampMs: number;
  status: 'draft' | 'confirmed';
  isActive: boolean;
  displayMode?: GraphNodeDisplayMode;
  isTourAnchor?: boolean;
  isTourAdded?: boolean;
  onClickTime: (ms: number) => void;
}
```

`packages/ui/src/graph-node-utils.ts`:

```ts
export function formatGraphNodeTime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}

export function getGraphNodeTypeColor(type: string): string {
  const colors: Record<string, string> = {
    claim: '#3b82f6',
    reason: '#10b981',
    example: '#f59e0b',
    question: '#8b5cf6',
    conclusion: '#ef4444',
  };
  return colors[type] || '#6b7280';
}

export function getGraphNodeTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    claim: '观点',
    reason: '论据',
    example: '例子',
    question: '问题',
    conclusion: '结论',
  };
  return labels[type] || type;
}
```

`packages/ui/src/constants.ts`:

```ts
/** readable 模式下节点正文基准字号；extension auto-fit 需与此同步 */
export const GRAPH_NODE_BODY_FONT_PX = 12;
```

`packages/ui/src/index.ts`:

```ts
export { GraphNodeCard } from './GraphNodeCard';
export type {
  GraphNodeCardData,
  GraphNodeDisplayMode,
  GraphNodeHandleMode,
} from './types';
export {
  formatGraphNodeTime,
  getGraphNodeTypeColor,
  getGraphNodeTypeLabel,
} from './graph-node-utils';
export { GRAPH_NODE_BODY_FONT_PX } from './constants';
```

- [ ] **Step 4: 运行 utils 测试确认通过**

Run: `pnpm --filter @listen-graphic/ui test:run graph-node-utils.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/types.ts packages/ui/src/graph-node-utils.ts packages/ui/src/constants.ts packages/ui/src/graph-node-utils.test.ts packages/ui/src/index.ts
git commit -m "feat(ui): add shared graph node types and formatting utils"
```

---

### Task 3: 迁入 GraphNodeCard（保持现有三行布局）

**Files:**
- Create: `packages/ui/src/GraphNodeCard.tsx`
- Create: `packages/ui/src/GraphNodeCard.extraction.test.tsx`

- [ ] **Step 1: 写抽取阶段行为测试（当前三行布局）**

Create `packages/ui/src/GraphNodeCard.extraction.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ReactFlowProvider } from 'reactflow';

import { GraphNodeCard } from './GraphNodeCard';
import type { GraphNodeCardData } from './types';

function renderCard(
  overrides: Partial<GraphNodeCardData> = {},
  handleMode: 'simple' | 'multi' = 'multi',
) {
  const onClickTime = vi.fn();
  const data: GraphNodeCardData = {
    label: '节点正文',
    nodeType: 'claim',
    timestampMs: 1_000,
    status: 'confirmed',
    isActive: false,
    onClickTime,
    ...overrides,
  };

  render(
    <ReactFlowProvider>
      <GraphNodeCard
        id="n1"
        type="graphNode"
        selected={false}
        zIndex={0}
        isConnectable={false}
        xPos={0}
        yPos={0}
        dragging={false}
        handleMode={handleMode}
        data={data}
      />
    </ReactFlowProvider>,
  );

  return { onClickTime };
}

describe('GraphNodeCard extraction baseline', () => {
  it('exposes graph-node-card test id and tour data attributes', () => {
    renderCard({ isTourAdded: true, displayMode: 'compact' });

    expect(screen.getByTestId('graph-node-card-n1')).toHaveAttribute('data-display-mode', 'compact');
    expect(screen.getByTestId('graph-node-card-n1')).toHaveAttribute('data-tour-added', 'true');
  });

  it('renders multi handles with stable test ids', () => {
    renderCard({}, 'multi');

    expect(screen.getByTestId('graph-handle-target-top')).toBeInTheDocument();
    expect(screen.getByTestId('graph-handle-source-bottom')).toBeInTheDocument();
  });

  it('renders only simple top/bottom handles in simple mode', () => {
    renderCard({}, 'simple');

    expect(screen.queryByTestId('graph-handle-target-top')).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { hidden: true }).length).toBeGreaterThan(0);
  });

  it('still invokes onClickTime from the footer time button', () => {
    const { onClickTime } = renderCard({ timestampMs: 90_000 });

    fireEvent.click(screen.getByRole('button', { name: '1:30' }));
    expect(onClickTime).toHaveBeenCalledWith(90_000);
  });
});
```

说明：Phase A 不断言行布局；`simple` 模式 handle 无 testid，最后一个测试用 `getAllByRole` 仅验证组件可渲染——抽取阶段以 `multi` 行为为主。

- [ ] **Step 2: 从 extension 复制并实现 `GraphNodeCard.tsx`**

Create `packages/ui/src/GraphNodeCard.tsx`：以 `apps/extension/src/sidepanel/GraphNodeCard.tsx` 为基准，做以下替换：

- `formatTime` → `formatGraphNodeTime`（from `./graph-node-utils`）
- `getTypeColor` → `getGraphNodeTypeColor`
- `getTypeLabel` → `getGraphNodeTypeLabel`
- `GraphNodeData` → `GraphNodeCardData`（from `./types`）
- 新增组件 prop：`handleMode?: GraphNodeHandleMode`（默认 `'multi'`）
- 当 `handleMode === 'simple'` 时，仅渲染：

```tsx
<Handle type="target" position={Position.Top} />
{/* ...card body... */}
<Handle type="source" position={Position.Bottom} />
```

- 当 `handleMode === 'multi'` 时，保留 extension 现有八向 Handle 与全部 `data-testid`

Phase A 内 card body 的三行 JSX **保持与 extension 当前一致**，不要提前做顶栏合并。

- [ ] **Step 3: 运行抽取测试**

Run: `pnpm --filter @listen-graphic/ui test:run GraphNodeCard.extraction.test.tsx`

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/GraphNodeCard.tsx packages/ui/src/GraphNodeCard.extraction.test.tsx
git commit -m "feat(ui): extract shared GraphNodeCard from extension"
```

---

### Task 4: extension 切换到共享组件

**Files:**
- Modify: `apps/extension/package.json`
- Modify: `apps/extension/src/sidepanel/App.tsx`
- Modify: `apps/extension/src/sidepanel/types.ts`
- Delete: `apps/extension/src/sidepanel/GraphNodeCard.tsx`

- [ ] **Step 1: 添加 workspace 依赖**

在 `apps/extension/package.json` 的 `dependencies` 中加入：

```json
"@listen-graphic/ui": "workspace:*"
```

Run: `pnpm install`

- [ ] **Step 2: 更新 `App.tsx` import**

```ts
import { GraphNodeCard, GRAPH_NODE_BODY_FONT_PX } from '@listen-graphic/ui';
```

删除本地：

```ts
import { GraphNodeCard } from './GraphNodeCard';
const GRAPH_NODE_BODY_FONT_PX = 12;
```

`nodeTypes` 保持不变：`const nodeTypes = { graphNode: GraphNodeCard };`

- [ ] **Step 3: 更新 `types.ts`**

将 `GraphNodeData` interface 替换为 re-export（保留 extension 侧名称，避免大面积改 import）：

```ts
export type { GraphNodeCardData as GraphNodeData } from '@listen-graphic/ui';
```

`ReactFlowDebugNodeData` 可改为 Pick / Omit，或继续手写但字段与 `GraphNodeCardData` 对齐（不含 `onClickTime`）。最小改法：

```ts
import type { GraphNodeCardData } from '@listen-graphic/ui';

export type GraphNodeData = GraphNodeCardData;

export type ReactFlowDebugNodeData = Omit<GraphNodeCardData, 'onClickTime'>;
```

- [ ] **Step 4: 删除 `apps/extension/src/sidepanel/GraphNodeCard.tsx`**

- [ ] **Step 5: 运行 extension 回归测试**

Run: `pnpm --filter extension test:run App.graph-updates.test.tsx App.rendering.test.tsx`

Expected: PASS — 现有 `graph-node-card-*` / `graph-handle-*` 断言不受影响。

Run: `pnpm --filter extension typecheck`

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/extension/package.json apps/extension/src/sidepanel/App.tsx apps/extension/src/sidepanel/types.ts
git rm apps/extension/src/sidepanel/GraphNodeCard.tsx
git commit -m "refactor(extension): use shared GraphNodeCard from @listen-graphic/ui"
```

---

### Task 5: web-demo 切换到共享组件

**Files:**
- Modify: `apps/web-demo/package.json`
- Modify: `apps/web-demo/src/App.tsx`

- [ ] **Step 1: 添加 workspace 依赖**

```json
"@listen-graphic/ui": "workspace:*"
```

Run: `pnpm install`

- [ ] **Step 2: 删除 `App.tsx` 中以下重复代码**

删除整块（约第 32–180 行）：

- `formatTime`
- `getTypeColor`
- `getTypeLabel`
- 内联 `GraphNodeData` interface
- 内联 `GraphNodeCard` function

- [ ] **Step 3: 改为 import 共享组件**

```ts
import { GraphNodeCard } from '@listen-graphic/ui';
```

在 `getLayoutedElements` 构建 node `data` 时，字段名已与共享类型一致（`label`, `nodeType`, `speaker`, `timestampMs`, `status`, `isActive`, `onClickTime`），无需改动。

为 web-demo 注册带 `handleMode` 的 wrapper（最小侵入）：

```ts
function WebDemoGraphNodeCard(props: NodeProps<GraphNodeCardData>) {
  return <GraphNodeCard {...props} handleMode="simple" />;
}

const nodeTypes = { graphNode: WebDemoGraphNodeCard };
```

同时在 `App.tsx` 顶部增加：

```ts
import { GraphNodeCard, type GraphNodeCardData } from '@listen-graphic/ui';
import type { NodeProps } from 'reactflow';
```

- [ ] **Step 4: 运行 web-demo 测试**

Run: `pnpm --filter web-demo test:run`

Expected: PASS

Run: `pnpm --filter web-demo typecheck`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web-demo/package.json apps/web-demo/src/App.tsx
git commit -m "refactor(web-demo): use shared GraphNodeCard from @listen-graphic/ui"
```

---

## Phase B — 在共享组件内合并顶栏布局

### Task 6: 为新布局写失败测试

**Files:**
- Create: `packages/ui/src/GraphNodeCard.layout.test.tsx`

- [ ] **Step 1: 写布局测试**

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { ReactFlowProvider } from 'reactflow';

import { GraphNodeCard } from './GraphNodeCard';
import type { GraphNodeCardData } from './types';

function renderCard(overrides: Partial<GraphNodeCardData> = {}) {
  const onClickTime = vi.fn();
  const data: GraphNodeCardData = {
    label: '这是节点正文内容',
    nodeType: 'claim',
    timestampMs: 65_000,
    status: 'confirmed',
    isActive: false,
    onClickTime,
    ...overrides,
  };

  render(
    <ReactFlowProvider>
      <GraphNodeCard
        id="n1"
        type="graphNode"
        selected={false}
        zIndex={0}
        isConnectable={false}
        xPos={0}
        yPos={0}
        dragging={false}
        data={data}
      />
    </ReactFlowProvider>,
  );

  return { onClickTime };
}

describe('GraphNodeCard header layout', () => {
  it('renders type and time on the same header row', () => {
    renderCard();

    const header = screen.getByTestId('graph-node-card-header');
    expect(within(header).getByText('观点')).toBeInTheDocument();
    expect(within(header).getByRole('button', { name: '1:05' })).toBeInTheDocument();
  });

  it('renders label on its own body row below the header', () => {
    renderCard({ label: '独立正文行' });

    expect(screen.getByTestId('graph-node-card-body')).toHaveTextContent('独立正文行');
    expect(screen.getByTestId('graph-node-card-header')).not.toHaveTextContent('独立正文行');
  });

  it('shows speaker on a separate row only when provided', () => {
    renderCard();
    expect(screen.queryByTestId('graph-node-card-speaker')).not.toBeInTheDocument();

    renderCard({ speaker: '嘉宾A' });
    expect(screen.getByTestId('graph-node-card-speaker')).toHaveTextContent('嘉宾A');
  });

  it('keeps draft badge beside type on the header left', () => {
    renderCard({ status: 'draft' });

    const header = screen.getByTestId('graph-node-card-header');
    expect(within(header).getByText('观点')).toBeInTheDocument();
    expect(within(header).getByText('草稿')).toBeInTheDocument();
  });

  it('still invokes onClickTime when the time button is clicked', () => {
    const { onClickTime } = renderCard({ timestampMs: 90_000 });

    fireEvent.click(screen.getByRole('button', { name: '1:30' }));
    expect(onClickTime).toHaveBeenCalledWith(90_000);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @listen-graphic/ui test:run GraphNodeCard.layout.test.tsx`

Expected: FAIL — `graph-node-card-header` 不存在

---

### Task 7: 在 `packages/ui` 实现合并顶栏

**Files:**
- Modify: `packages/ui/src/GraphNodeCard.tsx`

- [ ] **Step 1: 替换 card body 三行结构**

将类型行 + 正文行 + 底栏（speaker/time）替换为 Phase B 目标结构（与旧计划 Task 2 相同 JSX，使用 `formatGraphNodeTime` / `getGraphNodeTypeLabel`）：

- 顶栏 `data-testid="graph-node-card-header"`：`justifyContent: 'space-between'`，左 type + draft，右 time button
- 正文 `data-testid="graph-node-card-body"`
- 可选 speaker `data-testid="graph-node-card-speaker"`

完整 JSX 见旧版计划 Task 2 Step 1（将 `formatTime` 换为 `formatGraphNodeTime`，`getTypeLabel` 换为 `getGraphNodeTypeLabel`）。

- [ ] **Step 2: 运行 ui 包全部测试**

Run: `pnpm --filter @listen-graphic/ui test:run`

Expected: PASS（extraction + layout + utils）

- [ ] **Step 3: 运行两 app 回归**

Run: `pnpm --filter extension test:run App.graph-updates.test.tsx App.rendering.test.tsx`

Run: `pnpm --filter web-demo test:run`

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/GraphNodeCard.tsx packages/ui/src/GraphNodeCard.layout.test.tsx
git commit -m "feat(ui): merge graph node type and time onto one header row"
```

---

## 视觉验收清单（手动）

**extension**（`pnpm dev:ext`）：

- [ ] 顶栏左类型、右时间；正文独占一行
- [ ] 有 speaker 时正文下方仍显示
- [ ] compact 导览模式布局一致
- [ ] 八向 handle 与边连接正常
- [ ] 点击时间仍可跳转 transcript

**web-demo**（`pnpm dev:web`）：

- [ ] 与 extension 相同的顶栏/正文/speaker 结构
- [ ] 仅上下 handle，图谱边仍正常显示

---

## Self-Review

| 需求 | 对应 Task |
|------|-----------|
| 先抽共享 GraphNodeCard | Phase A Task 1–5 |
| extension / web-demo 共用 | Task 4 + Task 5 |
| 再改布局（一处改动两边生效） | Phase B Task 6–7 |
| 类型与时间同一行 | Task 7 |
| extension 八向 handle 不回归 | Task 3 `handleMode="multi"` + Task 4 回归 |
| web-demo 简单 handle | Task 5 `handleMode="simple"` |
| auto-fit 字号常量同步 | Task 2 `GRAPH_NODE_BODY_FONT_PX` + Task 4 import |

无 TBD / 无「后续再补」占位。

---

Plan complete and saved to `docs/superpowers/plans/2026-05-27-graph-node-header-layout.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — 每个 Task 派独立 subagent，任务间 review
2. **Inline Execution** — 本会话内按 executing-plans 逐步执行，设 checkpoint 供 review

**Which approach?**
