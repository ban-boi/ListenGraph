# Wave Pipeline Divider 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用动态 SVG 波浪分割线替换当前静态分隔线，将 ASR / Structurer / Graph 三个管线模块用灰→活跃色动画波浪分隔开。第一版仅实现窄侧栏（单列竖排 + 横向波浪）。

**Architecture:** 新建纯函数 `generateWavePath` 生成 SVG 波浪路径，新建 `PipelineWaveDivider` React 组件接收 `status` / `tone` props 渲染动态 SVG，CSS 动画驱动横向滚动。App.tsx 从 2 列 status-cards-grid 改为垂直堆叠 + 波浪分隔。状态从 `sessionState` 和错误信息直接推导，不依赖 StatusCardTone。

**Tech Stack:** React 18 + TypeScript + CSS animations + Vitest + Testing Library

---

## 文件结构

| 操作 | 文件 | 职责 |
|------|------|------|
| Create | `packages/ui/src/utils/wave-path.ts` | 纯函数：根据长度/振幅/方向生成 SVG 波浪 path + viewBox |
| Create | `packages/ui/src/utils/wave-path.test.ts` | wave-path 的单元测试 |
| Create | `packages/ui/src/components/PipelineWaveDivider.tsx` | React 组件：渲染带状态的 SVG 波浪分隔线 |
| Create | `packages/ui/src/components/PipelineWaveDivider.test.tsx` | 组件渲染测试 |
| Modify | `packages/ui/src/styles/theme.css:514-539` | 替换/扩展现有 `lg-wave-divider` + `lg-waveform-bar` 为新的波浪动画样式 |
| Modify | `packages/ui/src/index.ts:37` | 添加 PipelineWaveDivider 导出 |
| Modify | `apps/extension/src/sidepanel/App.tsx:873-903` | 替换静态分隔线为三段 PipelineWaveDivider，status-cards-grid → 垂直堆叠 |

---

### Task 1: Wave Path 生成工具函数

**Files:**
- Create: `packages/ui/src/utils/wave-path.ts`
- Create: `packages/ui/src/utils/wave-path.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// packages/ui/src/utils/wave-path.test.ts
import { describe, it, expect } from 'vitest';
import { generateWavePath } from './wave-path';

describe('generateWavePath', () => {
  it('横向波：返回正确的结构', () => {
    const result = generateWavePath(320, 18, 7, 40, 'horizontal');
    // 320 / 40 = 8 waves
    expect(result.numWaves).toBe(8);
    expect(result.actualWavelength).toBe(40);
    // viewBox 宽度 = length * 2（无缝滚动需要双倍）
    expect(result.viewBox).toBe('0 0 640 18');
    // path 以 M 开头
    expect(result.path).toMatch(/^M0 9/);
  });

  it('竖向波：返回正确的结构', () => {
    const result = generateWavePath(80, 18, 7, 40, 'vertical');
    // 80 / 40 = 2 waves
    expect(result.numWaves).toBe(2);
    expect(result.actualWavelength).toBe(40);
    expect(result.viewBox).toBe('0 0 18 160');
    expect(result.path).toMatch(/^M9 0/);
  });

  it('非整数波长时四舍五入 wave 数量', () => {
    const result = generateWavePath(300, 18, 7, 40, 'horizontal');
    // 300 / 40 = 7.5 → round(7.5) = 8 → 但这里是 300/8=37.5 实际波长
    // 实际：round(300/40) = round(7.5) = 8
    expect(result.numWaves).toBe(8);
    expect(result.actualWavelength).toBe(37.5);
  });

  it('极短长度至少 1 个 wave', () => {
    const result = generateWavePath(10, 18, 7, 40, 'horizontal');
    expect(result.numWaves).toBe(1);
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `pnpm --filter @listen-graphic/ui test:run -- src/utils/wave-path.test.ts`
Expected: FAIL — `Cannot find module './wave-path'`

- [ ] **Step 3: 实现 wave-path.ts**

```ts
// packages/ui/src/utils/wave-path.ts

/**
 * SVG 波浪路径生成器。
 *
 * 根据物理尺寸和曲率参数生成 SVG `<path>` 的 `d` 属性和配套 `viewBox`。
 * 路径长度 = length × 2（无缝滚动动画需要双倍重复）。
 *
 * @param length 波浪线在主方向上的物理长度（px）
 * @param crossLength 波浪线在垂直方向上的尺寸（px）
 * @param amplitude 振幅（中心到峰/谷距离，px）
 * @param targetWavelength 目标波长（px），实际波长按 wave 数取整调整
 * @param direction 'horizontal'（横向波）或 'vertical'（竖向波）
 */

export interface WavePathResult {
  /** SVG path 的 d 属性 */
  readonly path: string;
  /** SVG viewBox 属性值 */
  readonly viewBox: string;
  /** 实际 wave 数量 */
  readonly numWaves: number;
  /** 实际波长（px），可能因四舍五入偏离 targetWavelength */
  readonly actualWavelength: number;
}

export function generateWavePath(
  length: number,
  crossLength: number,
  amplitude: number,
  targetWavelength: number,
  direction: 'horizontal' | 'vertical',
): WavePathResult {
  const numWaves = Math.max(1, Math.round(length / targetWavelength));
  const actualWavelength = length / numWaves;
  const halfWave = actualWavelength / 2;
  const totalLength = length * 2;
  const totalCurves = numWaves * 4;

  if (direction === 'horizontal') {
    const cy = crossLength / 2;
    let d = `M0 ${cy}`;
    for (let i = 0; i < totalCurves; i++) {
      const x0 = i * halfWave;
      const x1 = x0 + halfWave;
      const peak = i % 2 === 0 ? cy - amplitude : cy + amplitude;
      d += ` Q${(x0 + x1) / 2} ${peak} ${x1} ${cy}`;
    }
    return {
      path: d,
      viewBox: `0 0 ${totalLength} ${crossLength}`,
      numWaves,
      actualWavelength,
    };
  }

  // vertical
  const cx = crossLength / 2;
  let d = `M${cx} 0`;
  for (let i = 0; i < totalCurves; i++) {
    const y0 = i * halfWave;
    const y1 = y0 + halfWave;
    const peak = i % 2 === 0 ? cx - amplitude : cx + amplitude;
    d += ` Q${peak} ${(y0 + y1) / 2} ${cx} ${y1}`;
  }
  return {
    path: d,
    viewBox: `0 0 ${crossLength} ${totalLength}`,
    numWaves,
    actualWavelength,
  };
}
```

- [ ] **Step 4: 运行测试验证通过**

Run: `pnpm --filter @listen-graphic/ui test:run -- src/utils/wave-path.test.ts`
Expected: 4 tests PASS

- [ ] **Step 5: Commit**

```
feat(ui): add generateWavePath utility for SVG wave paths
```

---

### Task 2: 波浪 CSS 样式

**Files:**
- Modify: `packages/ui/src/styles/theme.css` (在 `lg-waveform-bar` 样式块之后，约 line 540)

- [ ] **Step 1: 在 theme.css 末尾（`响应式断点` section 之前）追加波浪样式**

在 `@keyframes lg-wave-flow` 之后（约 line 539）追加以下 CSS：

```css
/* ================================================================
   组件样式 — 管线波浪分隔线
   ================================================================ */
.lg-pipeline-wave {
  overflow: hidden;
  position: relative;
  flex-shrink: 0;
}

.lg-pipeline-wave--horizontal {
  height: 18px;
  width: 100%;
}

.lg-pipeline-wave--vertical {
  width: 18px;
  height: 100%;
}

/* idle：灰色静止 — stroke 已是 var(--lg-muted)，再加 opacity 降低存在感 */
.lg-pipeline-wave--idle svg {
  opacity: 0.35;
}

/* active：语义色流动 */
.lg-pipeline-wave--horizontal.lg-pipeline-wave--active svg {
  animation: lg-wave-scroll-h 2.5s linear infinite;
}

.lg-pipeline-wave--vertical.lg-pipeline-wave--active svg {
  animation: lg-wave-scroll-v 2s linear infinite;
}

/* complete：语义色半透明静止 */
.lg-pipeline-wave--complete svg {
  opacity: 0.5;
}

/* error：红色虚线 */
.lg-pipeline-wave--error svg {
  opacity: 0.7;
}

@keyframes lg-wave-scroll-h {
  from { transform: translateX(0); }
  to   { transform: translateX(-50%); }
}

@keyframes lg-wave-scroll-v {
  from { transform: translateY(0); }
  to   { transform: translateY(-50%); }
}

/* 尊重系统减少动态效果设置 */
@media (prefers-reduced-motion: reduce) {
  .lg-pipeline-wave--active svg {
    animation: none;
  }
}
```

- [ ] **Step 2: 验证无构建错误**

Run: `pnpm --filter @listen-graphic/ui typecheck`
Expected: 无错误输出

- [ ] **Step 3: Commit**

```
feat(ui): add pipeline wave divider CSS styles and animations
```

---

### Task 3: PipelineWaveDivider 组件

**Files:**
- Create: `packages/ui/src/components/PipelineWaveDivider.tsx`
- Create: `packages/ui/src/components/PipelineWaveDivider.test.tsx`

- [ ] **Step 1: 写失败测试**

```tsx
// packages/ui/src/components/PipelineWaveDivider.test.tsx
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { PipelineWaveDivider } from './PipelineWaveDivider';

describe('PipelineWaveDivider', () => {
  it('idle 状态：渲染灰色波浪', () => {
    const { container } = render(
      <PipelineWaveDivider status="idle" tone="signal" />,
    );
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.className).toContain('lg-pipeline-wave');
    expect(wrapper.className).toContain('lg-pipeline-wave--idle');
    expect(wrapper.className).toContain('lg-pipeline-wave--horizontal');
    expect(wrapper.getAttribute('role')).toBe('separator');

    const path = container.querySelector('path');
    expect(path).toBeTruthy();
    // idle 时 stroke 为灰色（不是语义色）
    expect(path?.getAttribute('stroke')).toBe('var(--lg-muted)');
  });

  it('active 状态：渲染语义色波浪', () => {
    const { container } = render(
      <PipelineWaveDivider status="active" tone="signal" />,
    );
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.className).toContain('lg-pipeline-wave--active');

    const path = container.querySelector('path');
    // active 时 stroke 为 tone 对应的语义色
    expect(path?.getAttribute('stroke')).toBe('var(--lg-signal)');
  });

  it('active insight 色调', () => {
    const { container } = render(
      <PipelineWaveDivider status="active" tone="insight" />,
    );
    const path = container.querySelector('path');
    expect(path?.getAttribute('stroke')).toBe('var(--lg-insight)');
  });

  it('active neutral 色调', () => {
    const { container } = render(
      <PipelineWaveDivider status="active" tone="neutral" />,
    );
    const path = container.querySelector('path');
    expect(path?.getAttribute('stroke')).toBe('var(--lg-muted)');
  });

  it('complete 状态：语义色 + 半透明（CSS class 控制 opacity）', () => {
    const { container } = render(
      <PipelineWaveDivider status="complete" tone="signal" />,
    );
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.className).toContain('lg-pipeline-wave--complete');

    const path = container.querySelector('path');
    // complete 时 stroke 仍为语义色（opacity 由 CSS 控制）
    expect(path?.getAttribute('stroke')).toBe('var(--lg-signal)');
  });

  it('error 状态：红色虚线', () => {
    const { container } = render(
      <PipelineWaveDivider status="error" tone="signal" />,
    );
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.className).toContain('lg-pipeline-wave--error');

    const path = container.querySelector('path');
    expect(path?.getAttribute('stroke')).toBe('var(--lg-danger)');
    expect(path?.getAttribute('stroke-dasharray')).toBe('8 4');
  });

  it('支持自定义 className', () => {
    const { container } = render(
      <PipelineWaveDivider status="idle" tone="signal" className="my-extra" />,
    );
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.className).toContain('my-extra');
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `pnpm --filter @listen-graphic/ui test:run -- src/components/PipelineWaveDivider.test.tsx`
Expected: FAIL — `Cannot find module './PipelineWaveDivider'`

- [ ] **Step 3: 实现 PipelineWaveDivider.tsx**

```tsx
// packages/ui/src/components/PipelineWaveDivider.tsx

import { useMemo } from 'react';
import { generateWavePath } from '../utils/wave-path';

/**
 * 管线波浪分隔线。
 *
 * 用 SVG 动态波浪线分隔 ASR / Structurer / Graph 三个管线模块。
 * - idle：灰色静止（用户第一眼看到的是静态波浪分割线）
 * - active：语义色流动动画
 * - complete：语义色半透明静止
 * - error：红色虚线
 */

export type WaveDividerStatus = 'idle' | 'active' | 'complete' | 'error';
export type WaveDividerTone = 'signal' | 'insight' | 'neutral';
export type WaveDirection = 'horizontal' | 'vertical';

export interface PipelineWaveDividerProps {
  /** 模块运行状态 */
  status: WaveDividerStatus;
  /** 模块色调：signal=蓝绿(ASR), insight=琥珀(Structurer), neutral=灰(Graph) */
  tone: WaveDividerTone;
  /** 波浪方向，默认 horizontal（第一版仅用 horizontal） */
  direction?: WaveDirection;
  /** 额外 CSS class */
  className?: string;
}

/** 设计参数 — 与设计文件 waveform-responsive-layouts.html 对齐 */
const AMPLITUDE = 7;
const TARGET_WAVELENGTH = 40;
const CROSS_LENGTH = 18;
const STROKE_WIDTH = 2;
/** 默认长度（窄侧栏约 320px） */
const DEFAULT_LENGTH = 320;

/** tone → active/complete 时的语义色 CSS variable */
const TONE_COLORS: Record<WaveDividerTone, string> = {
  signal: 'var(--lg-signal)',
  insight: 'var(--lg-insight)',
  neutral: 'var(--lg-muted)',
};

const IDLE_COLOR = 'var(--lg-muted)';
const ERROR_COLOR = 'var(--lg-danger)';

export function PipelineWaveDivider({
  status,
  tone,
  direction = 'horizontal',
  className,
}: PipelineWaveDividerProps) {
  const wave = useMemo(
    () => generateWavePath(DEFAULT_LENGTH, CROSS_LENGTH, AMPLITUDE, TARGET_WAVELENGTH, direction),
    [direction],
  );

  const strokeColor =
    status === 'idle' ? IDLE_COLOR
      : status === 'error' ? ERROR_COLOR
        : TONE_COLORS[tone];

  const isDashed = status === 'error';
  const isHorizontal = direction === 'horizontal';

  return (
    <div
      className={[
        'lg-pipeline-wave',
        `lg-pipeline-wave--${direction}`,
        `lg-pipeline-wave--${status}`,
        className ?? '',
      ].filter(Boolean).join(' ')}
      role="separator"
    >
      <svg
        viewBox={wave.viewBox}
        preserveAspectRatio="none"
        fill="none"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: isHorizontal ? '200%' : '100%',
          height: isHorizontal ? '100%' : '200%',
        }}
      >
        <path
          d={wave.path}
          stroke={strokeColor}
          strokeWidth={STROKE_WIDTH}
          strokeLinecap="round"
          strokeDasharray={isDashed ? '8 4' : undefined}
        />
      </svg>
    </div>
  );
}
```

- [ ] **Step 4: 运行测试验证通过**

Run: `pnpm --filter @listen-graphic/ui test:run -- src/components/PipelineWaveDivider.test.tsx`
Expected: 7 tests PASS

- [ ] **Step 5: Commit**

```
feat(ui): add PipelineWaveDivider component with status-driven SVG waves
```

---

### Task 4: 从 UI 包导出

**Files:**
- Modify: `packages/ui/src/index.ts`

- [ ] **Step 1: 添加导出**

在 `packages/ui/src/index.ts` 末尾追加：

```ts
export { PipelineWaveDivider } from './components/PipelineWaveDivider';
export type { PipelineWaveDividerProps, WaveDividerStatus, WaveDividerTone, WaveDirection } from './components/PipelineWaveDivider';
```

- [ ] **Step 2: 验证无构建错误**

Run: `pnpm --filter @listen-graphic/ui typecheck`
Expected: 无错误输出

- [ ] **Step 3: Commit**

```
feat(ui): export PipelineWaveDivider from package index
```

---

### Task 5: 集成到 App.tsx

**Files:**
- Modify: `apps/extension/src/sidepanel/App.tsx`

这个 Task 改动较多，分为几个子步骤。

- [ ] **Step 5a: 添加 import**

在 `App.tsx` 顶部现有 `@listen-graphic/ui` import 块中追加 `PipelineWaveDivider`：

当前 import（line 46-58）：
```ts
import {
  GraphNodeCard,
  GRAPH_NODE_BODY_FONT_PX,
  useTheme,
  GraphToolbar,
  ViewSwitcher,
  GraphArea,
  StatusBar,
  StatusCard,
  ResizeHandle,
  ErrorBanner,
  DropdownMenu,
  TimelineLogPanel,
  formatTime,
  formatRelativeAge,
} from '@listen-graphic/ui';
```

追加 `PipelineWaveDivider` 和类型：
```ts
import {
  GraphNodeCard,
  GRAPH_NODE_BODY_FONT_PX,
  useTheme,
  GraphToolbar,
  ViewSwitcher,
  GraphArea,
  StatusBar,
  StatusCard,
  ResizeHandle,
  ErrorBanner,
  DropdownMenu,
  TimelineLogPanel,
  PipelineWaveDivider,
  formatTime,
  formatRelativeAge,
} from '@listen-graphic/ui';
import type { WaveDividerStatus } from '@listen-graphic/ui';
```

- [ ] **Step 5b: 添加波浪状态推导**

在 `isRunning` 定义之后（约 line 504）、导出相关逻辑之前，添加三个波浪状态的 `useMemo`：

```ts
  // ===== 波浪分隔线状态推导 =====
  const asrWaveStatus = useMemo<WaveDividerStatus>(() => {
    if (panel.recentProviderError?.stage === 'asr') return 'error';
    if (['capturing', 'transcribing'].includes(panel.sessionState)) return 'active';
    return 'idle';
  }, [panel.sessionState, panel.recentProviderError]);

  const structurerWaveStatus = useMemo<WaveDividerStatus>(() => {
    if (panel.recentProviderError?.stage === 'structurer') return 'error';
    if (panel.sessionState === 'structuring') return 'active';
    if (panel.stopPending && panel.stopDrainPendingCount > 0) return 'active';
    return 'idle';
  }, [panel.sessionState, panel.recentProviderError, panel.stopPending, panel.stopDrainPendingCount]);

  const graphWaveStatus = useMemo<WaveDividerStatus>(() => {
    if (panel.graph.nodes.length === 0) return 'idle';
    if (isRunning) return 'active';
    return 'complete';
  }, [panel.graph.nodes.length, isRunning]);
```

- [ ] **Step 5c: 替换 JSX 中的分隔线区域**

**删除**以下代码（约 line 873-879）：
```tsx
      <div className="lg-wave-divider" style={{ margin: 0, height: 8 }} />
      {isRunning && (
        <div
          className="lg-waveform-bar lg-waveform-bar--active"
          style={{ height: 2, flexShrink: 0 }}
        />
      )}
```

**替换** status-cards-grid 区域（约 line 888-903）：

原代码：
```tsx
      <div
        data-testid="runtime-status-cards"
        className="lg-status-cards-grid"
        style={{ padding: '6px 12px', gap: 8, flexShrink: 0 }}
      >
        {primaryStatusCards.map((card) => (
          <StatusCard
            key={card.label}
            testId={`status-card-${card.label.toLowerCase()}`}
            label={card.label}
            status={card.status}
            detail={card.detail}
            tone={card.tone}
            isRunning={card.tone === 'active'}
          />
        ))}
      </div>
```

新代码（垂直堆叠 + 波浪分隔）：
```tsx
      {/* ASR 状态 */}
      <div data-testid="runtime-status-cards" style={{ padding: '6px 12px 2px', flexShrink: 0 }}>
        <StatusCard
          testId={`status-card-${asrStatusCard.label.toLowerCase()}`}
          label={asrStatusCard.label}
          status={asrStatusCard.status}
          detail={asrStatusCard.detail}
          tone={asrStatusCard.tone}
          isRunning={asrStatusCard.tone === 'active'}
        />
      </div>
      <PipelineWaveDivider status={asrWaveStatus} tone="signal" />
      {/* Structurer 状态 */}
      <div style={{ padding: '2px 12px 2px', flexShrink: 0 }}>
        <StatusCard
          testId={`status-card-${structurerStatusCard.label.toLowerCase()}`}
          label={structurerStatusCard.label}
          status={structurerStatusCard.status}
          detail={structurerStatusCard.detail}
          tone={structurerStatusCard.tone}
          isRunning={structurerStatusCard.tone === 'active'}
        />
      </div>
      <PipelineWaveDivider status={structurerWaveStatus} tone="insight" />
```

- [ ] **Step 5d: 在 graph summary 区域之后添加 Graph 波浪分隔**

在 `graphSummaryText` 条件渲染的 `</div>` 闭合标签之后、`<ViewSwitcher` 之前（约 line 943），添加：

```tsx
      <PipelineWaveDivider status={graphWaveStatus} tone="neutral" />
```

- [ ] **Step 5e: 清理不再使用的变量**

`primaryStatusCards` 数组不再使用（status cards 改为单独渲染）。删除：

```ts
  const primaryStatusCards = useMemo(() => [asrStatusCard, structurerStatusCard], [asrStatusCard, structurerStatusCard]);
```

如果 `asrStatusCard` 和 `structurerStatusCard` 在其他地方没有使用，确认它们仍被保留（它们在新 JSX 中被直接引用）。

- [ ] **Step 5f: 验证构建**

Run: `pnpm --filter @listen-graphic/extension typecheck`
Expected: 无错误输出

Run: `pnpm --filter @listen-graphic/extension test:run`
Expected: 所有现有测试仍 PASS（Layout 等可能受影响，需要检查）

- [ ] **Step 5g: Commit**

```
feat(ext): replace static wave divider with animated PipelineWaveDivider

- Replace lg-wave-divider and lg-waveform-bar with three PipelineWaveDivider instances
- Change status cards from 2-col grid to vertical stack with wave separators
- ASR wave: signal tone, active when capturing/transcribing
- Structurer wave: insight tone, active when structuring
- Graph wave: neutral tone, active when running with nodes, complete when stopped
```

---

### Task 6: 视觉验证 + 修复

**Files:**
- Potentially: `packages/ui/src/components/PipelineWaveDivider.tsx` (微调)
- Potentially: `apps/extension/src/sidepanel/App.tsx` (微调)

- [ ] **Step 1: 启动 web-demo 验证**

Run: `pnpm dev:web`
打开 http://localhost:5173

检查项：
1. [ ] idle 状态：三条灰色半透明波浪，静止不动
2. [ ] 点击「开始」后：ASR 波浪变蓝绿并流动
3. [ ] Structurer 波浪在 structuring 时变琥珀并流动
4. [ ] Graph 波浪在有节点时变为灰色 active 状态
5. [ ] 停止后：ASR/Structurer 回到 idle，Graph 变 complete（半透明）

- [ ] **Step 2: 启动扩展侧栏验证**

Run: `pnpm dev:ext`
在 Chrome 中加载扩展，打开侧栏

检查项：
1. [ ] 侧栏窄宽（320px 左右）下波浪正常显示
2. [ ] 录制流程中波浪状态正确切换
3. [ ] 错误状态显示红色虚线波浪
4. [ ] 动画流畅无卡顿

- [ ] **Step 3: 修复发现的问题（如有）**

根据验证结果微调代码，然后 commit。

- [ ] **Step 4: Commit**

```
fix(ui): adjust wave divider spacing and opacity after visual review
```

---

## 自检清单

### 1. 需求覆盖

| 需求 | 对应 Task |
|------|-----------|
| idle 时三条波浪都是灰色 | Task 3（stroke=var(--lg-muted) when idle） |
| active 后变成各自语义色 | Task 3（TONE_COLORS mapping） |
| 默认 idle 灰色静止 | Task 5b（初始 sessionState='idle' → wave status='idle'） |
| 修掉 structure→structurer bug | 不存在于此实现（设计文件的 JS 代码有此 bug，我们的 React 实现直接用正确的 key） |
| 不用 imperative DOM | Task 3（纯 React 组件，无 querySelectorAll） |
| prefers-reduced-motion | Task 2（CSS @media rule） |
| 新增共享组件，不继续堆 div | Task 3 + Task 4 |
| 第一版只做窄侧栏 | 全部（direction 默认 horizontal，不处理 responsive 切换） |
| 当前模块内部内容不变 | Task 5c（StatusCard 的 label/status/detail/tone 不变，只改布局） |

### 2. Placeholder 扫描

无 TBD / TODO / "implement later" / "fill in details" / "handle edge cases" / "write tests" 等占位符。所有步骤都包含完整代码。

### 3. 类型一致性

- `WaveDividerStatus` 定义在 `PipelineWaveDivider.tsx`，导出自 `index.ts`
- `asrWaveStatus` / `structurerWaveStatus` / `graphWaveStatus` 在 App.tsx 中类型标注为 `WaveDividerStatus`
- `generateWavePath` 返回 `WavePathResult`，由 `PipelineWaveDivider` 消费
- `tone` prop 类型 `WaveDividerTone` = `'signal' | 'insight' | 'neutral'`，与 `TONE_COLORS` record 的 key 一致
