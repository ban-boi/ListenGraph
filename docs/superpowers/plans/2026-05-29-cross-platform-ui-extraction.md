# 跨平台 UI 组件库抽取 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `apps/extension` 和 `apps/web-demo` 中重复的 UI 代码抽取到 `@listen-graphic/ui`，建立一套跨平台共享的组件库，为未来 mobile/desktop app 复用打好基础。

**Architecture:** 采用 Slot（children/render props）模式设计组件——每个共享组件定义通用结构和交互，各应用通过 slot 注入各自特有的内容。组件全部放在 `packages/ui/src/components/` 下，样式沿用 Signal Design System 的 `.lg-` CSS class 体系。每个组件独立文件 + 独立测试 + 独立导出。

**Tech Stack:** React 18、ReactFlow v11、Vitest + Testing Library、Signal Design System (CSS custom properties + `.lg-` component classes)、TypeScript strict。

---

## 文件结构总览

### 新增文件（`packages/ui/src/`）

| 文件 | 职责 |
|------|------|
| `components/GraphToolbar.tsx` | 顶部工具栏：品牌区 + actions slot + 主操作按钮 |
| `components/GraphToolbar.test.tsx` | GraphToolbar 测试 |
| `components/ViewSwitcher.tsx` | 视图切换按钮组 |
| `components/ViewSwitcher.test.tsx` | ViewSwitcher 测试 |
| `components/GraphArea.tsx` | ReactFlow 容器 + EmptyState 条件切换 |
| `components/GraphArea.test.tsx` | GraphArea 测试 |
| `components/StatusBar.tsx` | 底部状态栏 |
| `components/StatusBar.test.tsx` | StatusBar 测试 |
| `components/LogPanel.tsx` | 日志列表组件（两种变体：simple/timeline） |
| `components/LogPanel.test.tsx` | LogPanel 测试 |
| `components/SignalIndicator.tsx` | 运行状态指示器（signal dot + 文字） |
| `components/SignalIndicator.test.tsx` | SignalIndicator 测试 |
| `components/DropdownMenu.tsx` | 通用下拉菜单（click-outside 关闭） |
| `components/DropdownMenu.test.tsx` | DropdownMenu 测试 |
| `components/ResizeHandle.tsx` | 拖拽调整大小的分割条 |
| `components/ResizeHandle.test.tsx` | ResizeHandle 测试 |
| `components/StatusCard.tsx` | 状态卡片（tone-based 颜色） |
| `components/StatusCard.test.tsx` | StatusCard 测试 |
| `components/ErrorBanner.tsx` | 错误横幅 |
| `components/ErrorBanner.test.tsx` | ErrorBanner 测试 |
| `constants/shared-constants.ts` | 跨应用共享常量（VIEW_TYPES、VIEW_LABELS 等） |
| `utils/format-time.ts` | 时间格式化工具（formatTime、formatRelativeAge） |
| `utils/format-time.test.ts` | format-time 测试 |

### 修改文件

| 文件 | 变更 |
|------|------|
| `packages/ui/src/index.ts` | 导出所有新组件 |
| `packages/ui/src/styles/theme.css` | 确认现有 CSS 类够用（无需新增） |
| `packages/ui/package.json` | 添加 `reactflow` 和 `@listen-graphic/schema` 为 peerDependencies |
| `apps/extension/src/sidepanel/App.tsx` | 导入共享组件，删除内联 UI 代码 |
| `apps/extension/src/sidepanel/OverflowMenu.tsx` | 标记 deprecated（由 DropdownMenu 替代） |
| `apps/extension/src/sidepanel/LogPanel.tsx` | 标记 deprecated（由 TimelineLogPanel 替代） |
| `apps/extension/src/sidepanel/constants.ts` | 删除重复常量，从 `@listen-graphic/ui` 导入 |
| `apps/extension/src/sidepanel/timeline-utils.ts` | 删除 `getStatusCardStyles`（迁入 StatusCard）、`formatTime`（迁入 ui） |
| `apps/web-demo/src/App.tsx` | 导入共享组件，删除内联 UI 代码 |

---

## Task 1: 共享常量 & 工具函数

**Files:**
- Create: `packages/ui/src/constants/shared-constants.ts`
- Create: `packages/ui/src/utils/format-time.ts`
- Test: `packages/ui/src/utils/format-time.test.ts`
- Modify: `packages/ui/src/index.ts`

**背景：** Extension 和 Web Demo 有重复的常量定义：
- `VIEW_TYPES` / `VIEW_LABELS` — Extension 在 `constants.ts`，Web Demo 在 `App.tsx` 内
- `formatTime(ms)` — Extension 在 `timeline-utils.ts`，Web Demo 在 `App.tsx` 内联使用 `formatGraphNodeTime`
- `formatRelativeAge(timestamp, now)` — Extension 在 `timeline-utils.ts`

- [ ] **Step 1: 创建共享常量文件**

```typescript
// packages/ui/src/constants/shared-constants.ts
import type { ViewType } from '@listen-graphic/schema';

/** 所有支持的视图类型 */
export const VIEW_TYPES: ViewType[] = [
  'causal',
  'timeline',
  'comparison',
  'hierarchy',
];

/** 视图类型 → 中文标签 */
export const VIEW_LABELS: Record<ViewType, string> = {
  causal: '因果',
  timeline: '时间线',
  comparison: '对比',
  hierarchy: '层级',
};
```

- [ ] **Step 2: 创建时间格式化工具**

```typescript
// packages/ui/src/utils/format-time.ts

/** 将毫秒格式化为 M:SS */
export function formatTime(ms: number): string {
  const totalSeconds = Math.floor(Math.abs(ms) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const sign = ms < 0 ? '-' : '';
  return `${sign}${minutes}:${String(seconds).padStart(2, '0')}`;
}

/** 将时间戳格式化为相对时间文本（如 "刚刚"、"3s 前"、"2m 前"） */
export function formatRelativeAge(
  timestamp: number | null | undefined,
  now = Date.now(),
): string {
  if (!timestamp) return '暂无';
  const diffMs = Math.max(now - timestamp, 0);
  if (diffMs < 1000) return '刚刚';
  if (diffMs < 60_000) return `${Math.floor(diffMs / 1000)}s 前`;
  return `${Math.floor(diffMs / 60_000)}m 前`;
}

/** 格式化时间戳为 HH:MM:SS */
export function formatTimestamp(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString();
}
```

- [ ] **Step 3: 写时间格式化测试**

```typescript
// packages/ui/src/utils/format-time.test.ts
import { describe, it, expect } from 'vitest';
import { formatTime, formatRelativeAge, formatTimestamp } from './format-time';

describe('formatTime', () => {
  it('格式化 0 为 0:00', () => {
    expect(formatTime(0)).toBe('0:00');
  });
  it('格式化 65000 为 1:05', () => {
    expect(formatTime(65_000)).toBe('1:05');
  });
  it('格式化 3599000 为 59:59', () => {
    expect(formatTime(3_599_000)).toBe('59:59');
  });
  it('负数显示负号', () => {
    expect(formatTime(-5000)).toBe('-0:05');
  });
});

describe('formatRelativeAge', () => {
  it('null/undefined 返回 "暂无"', () => {
    expect(formatRelativeAge(null)).toBe('暂无');
    expect(formatRelativeAge(undefined)).toBe('暂无');
  });
  it('刚刚发生的返回 "刚刚"', () => {
    const now = Date.now();
    expect(formatRelativeAge(now - 500, now)).toBe('刚刚');
  });
  it('30 秒前返回 "30s 前"', () => {
    const now = Date.now();
    expect(formatRelativeAge(now - 30_000, now)).toBe('30s 前');
  });
  it('120 秒前返回 "2m 前"', () => {
    const now = Date.now();
    expect(formatRelativeAge(now - 120_000, now)).toBe('2m 前');
  });
});

describe('formatTimestamp', () => {
  it('返回字符串', () => {
    const result = formatTimestamp(Date.now());
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 4: 运行测试**

Run: `cd packages/ui && npx vitest run src/utils/format-time.test.ts`
Expected: 8 tests PASS

- [ ] **Step 5: 更新 index.ts 导出**

在 `packages/ui/src/index.ts` 末尾追加：

```typescript
export { VIEW_TYPES, VIEW_LABELS } from './constants/shared-constants';
export { formatTime, formatRelativeAge, formatTimestamp } from './utils/format-time';
```

- [ ] **Step 6: 提交**

```bash
git add packages/ui/src/constants/shared-constants.ts packages/ui/src/utils/format-time.ts packages/ui/src/utils/format-time.test.ts packages/ui/src/index.ts
git commit -m "feat(ui): add shared constants and time formatting utilities"
```

---

## Task 2: SignalIndicator 组件

**Files:**
- Create: `packages/ui/src/components/SignalIndicator.tsx`
- Test: `packages/ui/src/components/SignalIndicator.test.tsx`
- Modify: `packages/ui/src/index.ts`

**背景：** 两边都有运行状态指示器（signal dot + 文字），Extension 在工具栏内联（App.tsx:391-396），Web Demo 在工具栏内联（App.tsx:391-396）。逻辑完全一样：运行时显示绿色脉冲点 + "运行中"，空闲时灰色点 + "空闲"。

- [ ] **Step 1: 写测试**

```typescript
// packages/ui/src/components/SignalIndicator.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SignalIndicator } from './SignalIndicator';

describe('SignalIndicator', () => {
  it('运行时显示活跃状态', () => {
    render(<SignalIndicator active={true} />);
    expect(screen.getByText('运行中')).toBeInTheDocument();
    const dot = screen.getByTestId('signal-dot');
    expect(dot.className).toContain('lg-signal-dot--active');
  });

  it('空闲时显示空闲状态', () => {
    render(<SignalIndicator active={false} />);
    expect(screen.getByText('空闲')).toBeInTheDocument();
    const dot = screen.getByTestId('signal-dot');
    expect(dot.className).toContain('lg-signal-dot--idle');
  });

  it('支持自定义文本', () => {
    render(<SignalIndicator active={true} label="录音中" />);
    expect(screen.getByText('录音中')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd packages/ui && npx vitest run src/components/SignalIndicator.test.tsx`
Expected: FAIL — module not found

- [ ] **Step 3: 实现 SignalIndicator**

```typescript
// packages/ui/src/components/SignalIndicator.tsx
export type SignalIndicatorProps = {
  /** 是否处于活跃状态 */
  active: boolean;
  /** 状态文本，默认 active 时为 "运行中"，否则为 "空闲" */
  label?: string;
};

export function SignalIndicator({ active, label }: SignalIndicatorProps) {
  const displayLabel = label ?? (active ? '运行中' : '空闲');
  return (
    <div className="lg-signal-indicator">
      <div
        data-testid="signal-dot"
        className={`lg-signal-dot ${active ? 'lg-signal-dot--active' : 'lg-signal-dot--idle'}`}
      />
      <span>{displayLabel}</span>
    </div>
  );
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd packages/ui && npx vitest run src/components/SignalIndicator.test.tsx`
Expected: 3 tests PASS

- [ ] **Step 5: 更新导出并提交**

在 `index.ts` 追加：
```typescript
export { SignalIndicator } from './components/SignalIndicator';
export type { SignalIndicatorProps } from './components/SignalIndicator';
```

```bash
git add packages/ui/src/components/SignalIndicator.tsx packages/ui/src/components/SignalIndicator.test.tsx packages/ui/src/index.ts
git commit -m "feat(ui): add SignalIndicator component"
```

---

## Task 3: ViewSwitcher 组件

**Files:**
- Create: `packages/ui/src/components/ViewSwitcher.tsx`
- Test: `packages/ui/src/components/ViewSwitcher.test.tsx`
- Modify: `packages/ui/src/index.ts`

**背景：** 两边都有视图切换按钮组，逻辑几乎一致：渲染 VIEW_TYPES 按钮，当前选中用 `lg-btn-primary`，其余用 `lg-btn-ghost`，点击触发回调。Extension 额外有"适配视图"按钮（App.tsx:992-1019），Web Demo 集成在工具栏内（App.tsx:417-427）。

- [ ] **Step 1: 写测试**

```typescript
// packages/ui/src/components/ViewSwitcher.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ViewSwitcher } from './ViewSwitcher';

describe('ViewSwitcher', () => {
  it('渲染所有视图按钮', () => {
    render(<ViewSwitcher currentView="causal" onViewChange={() => {}} />);
    expect(screen.getByText('因果')).toBeInTheDocument();
    expect(screen.getByText('时间线')).toBeInTheDocument();
    expect(screen.getByText('对比')).toBeInTheDocument();
    expect(screen.getByText('层级')).toBeInTheDocument();
  });

  it('当前视图按钮高亮', () => {
    render(<ViewSwitcher currentView="timeline" onViewChange={() => {}} />);
    const activeBtn = screen.getByText('时间线');
    expect(activeBtn.className).toContain('lg-btn-primary');
  });

  it('点击触发 onViewChange', () => {
    const onChange = vi.fn();
    render(<ViewSwitcher currentView="causal" onViewChange={onChange} />);
    fireEvent.click(screen.getByText('对比'));
    expect(onChange).toHaveBeenCalledWith('comparison');
  });

  it('渲染 fitView 按钮', () => {
    render(
      <ViewSwitcher
        currentView="causal"
        onViewChange={() => {}}
        onFitView={() => {}}
      />,
    );
    expect(screen.getByText('适配视图')).toBeInTheDocument();
  });

  it('fitView 按钮在有 onFitView 但 disabled 时渲染', () => {
    render(
      <ViewSwitcher
        currentView="causal"
        onViewChange={() => {}}
        onFitView={() => {}}
        fitViewDisabled={true}
      />,
    );
    const btn = screen.getByText('适配视图');
    expect(btn).toBeDisabled();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd packages/ui && npx vitest run src/components/ViewSwitcher.test.tsx`
Expected: FAIL

- [ ] **Step 3: 实现 ViewSwitcher**

```typescript
// packages/ui/src/components/ViewSwitcher.tsx
import type { ViewType } from '@listen-graphic/schema';
import { VIEW_TYPES, VIEW_LABELS } from '../constants/shared-constants';

export type ViewSwitcherProps = {
  /** 当前选中的视图 */
  currentView: ViewType;
  /** 视图切换回调 */
  onViewChange: (view: ViewType) => void;
  /** 适配视图回调（可选，提供时渲染"适配视图"按钮） */
  onFitView?: () => void;
  /** 适配视图按钮是否禁用 */
  fitViewDisabled?: boolean;
};

export function ViewSwitcher({
  currentView,
  onViewChange,
  onFitView,
  fitViewDisabled,
}: ViewSwitcherProps) {
  return (
    <div
      style={{
        padding: '6px 12px',
        borderBottom: '1px solid var(--lg-rim)',
        display: 'flex',
        gap: 6,
        flexShrink: 0,
        alignItems: 'center',
      }}
    >
      {VIEW_TYPES.map((v) => (
        <button
          key={v}
          className={
            currentView === v
              ? 'lg-btn lg-btn-primary lg-btn-sm'
              : 'lg-btn lg-btn-ghost lg-btn-sm'
          }
          onClick={() => onViewChange(v)}
        >
          {VIEW_LABELS[v]}
        </button>
      ))}
      {onFitView && (
        <button
          className="lg-btn lg-btn-ghost lg-btn-sm"
          onClick={onFitView}
          disabled={fitViewDisabled}
        >
          适配视图
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd packages/ui && npx vitest run src/components/ViewSwitcher.test.tsx`
Expected: 5 tests PASS

- [ ] **Step 5: 更新导出并提交**

在 `index.ts` 追加：
```typescript
export { ViewSwitcher } from './components/ViewSwitcher';
export type { ViewSwitcherProps } from './components/ViewSwitcher';
```

```bash
git add packages/ui/src/components/ViewSwitcher.tsx packages/ui/src/components/ViewSwitcher.test.tsx packages/ui/src/index.ts
git commit -m "feat(ui): add ViewSwitcher component"
```

---

## Task 4: DropdownMenu 组件

**Files:**
- Create: `packages/ui/src/components/DropdownMenu.tsx`
- Test: `packages/ui/src/components/DropdownMenu.test.tsx`
- Modify: `packages/ui/src/index.ts`

**背景：** Extension 的 `OverflowMenu`（OverflowMenu.tsx）是一个下拉菜单，含 click-outside 关闭逻辑。这是一个通用交互模式，应抽取为可复用组件。Web Demo 当前没有下拉菜单，但未来可能需要。

- [ ] **Step 1: 写测试**

```typescript
// packages/ui/src/components/DropdownMenu.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DropdownMenu } from './DropdownMenu';

describe('DropdownMenu', () => {
  const items = [
    { id: 'a', label: '选项 A' },
    { id: 'b', label: '选项 B', disabled: true },
    { id: 'c', label: '选项 C' },
  ];

  it('点击触发按钮展开菜单', () => {
    render(
      <DropdownMenu triggerLabel="更多" items={items} onSelect={() => {}} />,
    );
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.click(screen.getByText('更多'));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(screen.getByText('选项 A')).toBeInTheDocument();
  });

  it('选择项目触发 onSelect 并关闭', () => {
    const onSelect = vi.fn();
    render(
      <DropdownMenu triggerLabel="更多" items={items} onSelect={onSelect} />,
    );
    fireEvent.click(screen.getByText('更多'));
    fireEvent.click(screen.getByText('选项 A'));
    expect(onSelect).toHaveBeenCalledWith('a');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('disabled 项不可点击', () => {
    const onSelect = vi.fn();
    render(
      <DropdownMenu triggerLabel="更多" items={items} onSelect={onSelect} />,
    );
    fireEvent.click(screen.getByText('更多'));
    const disabledBtn = screen.getByText('选项 B');
    expect(disabledBtn).toBeDisabled();
    fireEvent.click(disabledBtn);
    expect(onSelect).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd packages/ui && npx vitest run src/components/DropdownMenu.test.tsx`
Expected: FAIL

- [ ] **Step 3: 实现 DropdownMenu**

```typescript
// packages/ui/src/components/DropdownMenu.tsx
import { useEffect, useRef, useState } from 'react';

export type DropdownMenuItem = {
  id: string;
  label: string;
  disabled?: boolean;
  /** 渲染为激活/选中态 */
  active?: boolean;
};

export type DropdownMenuProps = {
  /** 触发按钮文本 */
  triggerLabel: string;
  /** 菜单项列表 */
  items: DropdownMenuItem[];
  /** 选择回调 */
  onSelect: (id: string) => void;
  /** 触发按钮额外的 className */
  triggerClassName?: string;
  /** 底部额外内容（如 build info） */
  footer?: React.ReactNode;
};

export function DropdownMenu({
  triggerLabel,
  items,
  onSelect,
  triggerClassName,
  footer,
}: DropdownMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleMouseDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const timer = window.setTimeout(() => {
      document.addEventListener('mousedown', handleMouseDown);
    }, 0);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('mousedown', handleMouseDown);
    };
  }, [open]);

  const handleSelect = (id: string) => {
    onSelect(id);
    setOpen(false);
  };

  return (
    <div ref={rootRef} data-testid="dropdown-menu" style={{ position: 'relative' }}>
      <button
        type="button"
        data-testid="dropdown-menu-toggle"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
        className={`lg-btn lg-btn-ghost lg-btn-sm ${triggerClassName ?? ''}`}
        style={{
          backgroundColor: open ? 'var(--lg-calm)' : undefined,
          color: open ? 'var(--lg-signal)' : undefined,
        }}
      >
        {triggerLabel}
        <span
          style={{
            display: 'inline-block',
            marginLeft: 4,
            fontSize: 'var(--text-2xs)',
            transition: 'transform var(--dur-fast) var(--ease-out)',
            transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
          }}
        >
          ▼
        </span>
      </button>
      {open && (
        <div
          role="menu"
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            zIndex: 20,
            minWidth: 168,
            border: '1px solid var(--lg-rim)',
            borderRadius: 'var(--radius-md)',
            backgroundColor: 'var(--lg-surface)',
            boxShadow: 'var(--shadow-md)',
            padding: '4px 0',
            animation: 'fadeIn var(--dur-fast) var(--ease-out)',
          }}
        >
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => handleSelect(item.id)}
              style={{
                display: 'block',
                width: '100%',
                padding: '6px 10px',
                border: 'none',
                background: item.active ? 'var(--lg-calm)' : 'transparent',
                color: item.active
                  ? 'var(--lg-signal)'
                  : item.disabled
                    ? 'var(--lg-mist)'
                    : 'var(--lg-ink)',
                fontSize: 'var(--text-xs)',
                textAlign: 'left',
                cursor: item.disabled ? 'not-allowed' : 'pointer',
              }}
            >
              {item.label}
            </button>
          ))}
          {footer && (
            <>
              <div style={{ height: 1, backgroundColor: 'var(--lg-rim)', margin: '4px 0' }} />
              <div style={{ padding: '6px 10px', fontSize: 'var(--text-2xs)', color: 'var(--lg-muted)', fontFamily: 'monospace', wordBreak: 'break-word' }}>
                {footer}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd packages/ui && npx vitest run src/components/DropdownMenu.test.tsx`
Expected: 3 tests PASS

- [ ] **Step 5: 更新导出并提交**

在 `index.ts` 追加：
```typescript
export { DropdownMenu } from './components/DropdownMenu';
export type { DropdownMenuProps, DropdownMenuItem } from './components/DropdownMenu';
```

```bash
git add packages/ui/src/components/DropdownMenu.tsx packages/ui/src/components/DropdownMenu.test.tsx packages/ui/src/index.ts
git commit -m "feat(ui): add DropdownMenu component"
```

---

## Task 5: GraphToolbar 组件

**Files:**
- Create: `packages/ui/src/components/GraphToolbar.tsx`
- Test: `packages/ui/src/components/GraphToolbar.test.tsx`
- Modify: `packages/ui/src/index.ts`

**背景：** 两边工具栏结构相似：品牌区（左）+ 操作区（中/右）+ 主操作按钮（右）。差异在于 Extension 有设置按钮 + OverflowMenu（App.tsx:828-865），Web Demo 有 fixture 状态指示器（App.tsx:369-440）。用 `actions` slot 和 `info` slot 覆盖。

- [ ] **Step 1: 写测试**

```typescript
// packages/ui/src/components/GraphToolbar.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { GraphToolbar } from './GraphToolbar';

describe('GraphToolbar', () => {
  it('渲染品牌名', () => {
    render(
      <GraphToolbar
        brandName="Listen Graphic"
        primaryAction={{ label: '开始', onClick: () => {} }}
      />,
    );
    expect(screen.getByText('Listen Graphic')).toBeInTheDocument();
    expect(screen.getByText('开始')).toBeInTheDocument();
  });

  it('渲染 actions slot', () => {
    render(
      <GraphToolbar
        brandName="Test"
        primaryAction={{ label: '开始', onClick: () => {} }}
        actions={<button>自定义按钮</button>}
      />,
    );
    expect(screen.getByText('自定义按钮')).toBeInTheDocument();
  });

  it('primaryAction 点击触发回调', () => {
    const onClick = vi.fn();
    render(
      <GraphToolbar
        brandName="Test"
        primaryAction={{ label: '开始', onClick }}
      />,
    );
    fireEvent.click(screen.getByText('开始'));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('active 状态渲染停止按钮（danger）', () => {
    render(
      <GraphToolbar
        brandName="Test"
        primaryAction={{ label: '停止', onClick: () => {}, active: true }}
      />,
    );
    const btn = screen.getByText('停止');
    expect(btn.className).toContain('lg-btn-danger');
  });

  it('渲染 info slot', () => {
    render(
      <GraphToolbar
        brandName="Test"
        primaryAction={{ label: '开始', onClick: () => {} }}
        info={<span>sequence step 1/3</span>}
      />,
    );
    expect(screen.getByText('sequence step 1/3')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd packages/ui && npx vitest run src/components/GraphToolbar.test.tsx`
Expected: FAIL

- [ ] **Step 3: 实现 GraphToolbar**

```typescript
// packages/ui/src/components/GraphToolbar.tsx
import { useTheme } from '../hooks/useTheme';

export type ToolbarPrimaryAction = {
  label: string;
  onClick: () => void;
  /** 是否处于活跃状态（运行中） */
  active?: boolean;
  /** 是否禁用 */
  disabled?: boolean;
};

export type GraphToolbarProps = {
  /** 品牌名称 */
  brandName: string;
  /** 主操作按钮（开始/停止） */
  primaryAction: ToolbarPrimaryAction;
  /** 右侧操作区 slot（设置、overflow 等） */
  actions?: React.ReactNode;
  /** 品牌区与操作区之间的信息 slot（fixture 状态等） */
  info?: React.ReactNode;
  /** 覆盖主题切换，默认显示内置主题按钮 */
  themeToggle?: React.ReactNode;
};

export function GraphToolbar({
  brandName,
  primaryAction,
  actions,
  info,
  themeToggle,
}: GraphToolbarProps) {
  const { theme, toggleTheme } = useTheme();

  return (
    <div className="lg-toolbar" style={{ gap: 8 }}>
      <div className="lg-toolbar__brand">
        <span style={{ fontWeight: 'var(--weight-bold)', fontSize: 'var(--text-base)' }}>
          {brandName}
        </span>
      </div>
      {info}
      <div className="lg-toolbar__actions">
        {themeToggle ?? (
          <button
            className="lg-btn lg-btn-ghost lg-btn-sm"
            onClick={toggleTheme}
            title="切换主题"
          >
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>
        )}
        {actions}
      </div>
      <button
        className={
          primaryAction.active
            ? 'lg-btn lg-btn-danger lg-btn-sm'
            : 'lg-btn lg-btn-primary lg-btn-sm'
        }
        onClick={primaryAction.onClick}
        disabled={primaryAction.disabled}
        style={{ marginLeft: 'auto' }}
      >
        {primaryAction.label}
      </button>
    </div>
  );
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd packages/ui && npx vitest run src/components/GraphToolbar.test.tsx`
Expected: 5 tests PASS

- [ ] **Step 5: 更新导出并提交**

在 `index.ts` 追加：
```typescript
export { GraphToolbar } from './components/GraphToolbar';
export type { GraphToolbarProps, ToolbarPrimaryAction } from './components/GraphToolbar';
```

```bash
git add packages/ui/src/components/GraphToolbar.tsx packages/ui/src/components/GraphToolbar.test.tsx packages/ui/src/index.ts
git commit -m "feat(ui): add GraphToolbar component"
```

---

## Task 6: GraphArea 组件

**Files:**
- Create: `packages/ui/src/components/GraphArea.tsx`
- Test: `packages/ui/src/components/GraphArea.test.tsx`
- Modify: `packages/ui/src/index.ts`
- Modify: `packages/ui/package.json` — 添加 `reactflow` 为 peerDependency

**背景：** 两边都有 ReactFlow 容器 + EmptyState 条件切换。Extension 在 App.tsx:1021-1042，Web Demo 在 App.tsx:444-462。GraphArea 封装这个模式：无节点且空闲时显示 EmptyState，否则渲染 ReactFlow。

- [ ] **Step 1: 写测试**

```typescript
// packages/ui/src/components/GraphArea.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { GraphArea } from './GraphArea';
import type { Node } from 'reactflow';

// Mock ReactFlow
vi.mock('reactflow', () => ({
  ReactFlow: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="react-flow">{children}</div>
  ),
  Background: () => <div data-testid="background" />,
  Controls: () => <div data-testid="controls" />,
}));

describe('GraphArea', () => {
  it('无节点且空闲时显示 EmptyState', () => {
    render(
      <GraphArea
        nodes={[]}
        edges={[]}
        nodeTypes={{}}
        isIdle={true}
        onNodeClick={() => {}}
      />,
    );
    expect(screen.getByTestId('empty-state')).toBeInTheDocument();
    expect(screen.queryByTestId('react-flow')).toBeNull();
  });

  it('有节点时显示 ReactFlow', () => {
    const nodes: Node[] = [
      { id: 'n1', position: { x: 0, y: 0 }, data: {} },
    ];
    render(
      <GraphArea
        nodes={nodes}
        edges={[]}
        nodeTypes={{}}
        isIdle={false}
        onNodeClick={() => {}}
      />,
    );
    expect(screen.getByTestId('react-flow')).toBeInTheDocument();
    expect(screen.queryByTestId('empty-state')).toBeNull();
  });

  it('运行中（非空闲）时即使无节点也显示 ReactFlow', () => {
    render(
      <GraphArea
        nodes={[]}
        edges={[]}
        nodeTypes={{}}
        isIdle={false}
        onNodeClick={() => {}}
      />,
    );
    expect(screen.getByTestId('react-flow')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd packages/ui && npx vitest run src/components/GraphArea.test.tsx`
Expected: FAIL

- [ ] **Step 3: 实现 GraphArea**

```typescript
// packages/ui/src/components/GraphArea.tsx
import {
  ReactFlow,
  Background,
  Controls,
  type Node,
  type Edge,
  type NodeTypes,
  type ReactFlowInstance,
} from 'reactflow';
import { EmptyState } from '../EmptyState';

export type GraphAreaProps = {
  /** ReactFlow 节点 */
  nodes: Node[];
  /** ReactFlow 边 */
  edges: Edge[];
  /** 自定义节点类型注册 */
  nodeTypes: NodeTypes;
  /** 是否处于空闲状态（无节点 + 空闲 → 显示 EmptyState） */
  isIdle: boolean;
  /** 节点点击回调 */
  onNodeClick: (event: React.MouseEvent, node: Node) => void;
  /** ReactFlow 初始化回调 */
  onInit?: (instance: ReactFlowInstance) => void;
  /** 视口移动开始回调 */
  onMoveStart?: () => void;
  /** 视口移动结束回调 */
  onMoveEnd?: () => void;
  /** 额外的 ReactFlow children（如 MiniMap） */
  children?: React.ReactNode;
  /** fitView 初始是否自适应 */
  fitView?: boolean;
  /** 最小缩放 */
  minZoom?: number;
  /** 最大缩放 */
  maxZoom?: number;
};

export function GraphArea({
  nodes,
  edges,
  nodeTypes,
  isIdle,
  onNodeClick,
  onInit,
  onMoveStart,
  onMoveEnd,
  children,
  fitView = false,
  minZoom = 0.3,
  maxZoom = 2,
}: GraphAreaProps) {
  if (nodes.length === 0 && isIdle) {
    return <EmptyState />;
  }

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodeClick={onNodeClick}
        onMoveStart={onMoveStart}
        onMoveEnd={onMoveEnd}
        onInit={onInit}
        fitView={fitView}
        minZoom={minZoom}
        maxZoom={maxZoom}
      >
        <Background />
        <Controls />
        {children}
      </ReactFlow>
    </div>
  );
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd packages/ui && npx vitest run src/components/GraphArea.test.tsx`
Expected: 3 tests PASS

- [ ] **Step 5: 更新 package.json 添加 reactflow peerDependency**

在 `packages/ui/package.json` 的 `peerDependencies` 中添加（如果没有该字段则创建）：

```json
"peerDependencies": {
  "react": "^18.0.0",
  "reactflow": "^11.0.0"
}
```

- [ ] **Step 6: 更新导出并提交**

在 `index.ts` 追加：
```typescript
export { GraphArea } from './components/GraphArea';
export type { GraphAreaProps } from './components/GraphArea';
```

```bash
git add packages/ui/src/components/GraphArea.tsx packages/ui/src/components/GraphArea.test.tsx packages/ui/src/index.ts packages/ui/package.json
git commit -m "feat(ui): add GraphArea component with ReactFlow + EmptyState toggle"
```

---

## Task 7: LogPanel 组件

**Files:**
- Create: `packages/ui/src/components/LogPanel.tsx`
- Test: `packages/ui/src/components/LogPanel.test.tsx`
- Modify: `packages/ui/src/index.ts`

**背景：** 两边都有日志面板。Extension 用结构化 TimelineEvent（LogPanel.tsx，带 stage badge、tone 颜色、detail），Web Demo 用简单字符串数组（App.tsx:464-508）。设计两种变体：`SimpleLogPanel`（字符串列表）和 `TimelineLogPanel`（结构化事件列表）。

- [ ] **Step 1: 写测试**

```typescript
// packages/ui/src/components/LogPanel.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SimpleLogPanel, TimelineLogPanel } from './LogPanel';
import type { TimelineEvent } from './LogPanel';

describe('SimpleLogPanel', () => {
  it('无日志时显示占位文本', () => {
    render(<SimpleLogPanel logs={[]} placeholder="点击开始" />);
    expect(screen.getByText('点击开始')).toBeInTheDocument();
  });

  it('渲染日志条目', () => {
    render(
      <SimpleLogPanel logs={['第一条日志', '第二条日志']} placeholder="" />,
    );
    expect(screen.getByText('第一条日志')).toBeInTheDocument();
    expect(screen.getByText('第二条日志')).toBeInTheDocument();
  });

  it('显示日志数量标题', () => {
    render(<SimpleLogPanel logs={['a', 'b']} placeholder="" />);
    expect(screen.getByText('日志 (2)')).toBeInTheDocument();
  });
});

describe('TimelineLogPanel', () => {
  const events: TimelineEvent[] = [
    {
      id: 'e1',
      timestamp: Date.now(),
      stage: 'asr',
      message: '转写完成',
      detail: '详细信息',
      tone: 'success',
      repeatCount: 1,
    },
  ];

  it('无事件时显示占位文本', () => {
    render(<TimelineLogPanel events={[]} placeholder="等待事件" />);
    expect(screen.getByText('等待事件')).toBeInTheDocument();
  });

  it('渲染事件条目', () => {
    render(<TimelineLogPanel events={events} placeholder="" />);
    expect(screen.getByText('转写完成')).toBeInTheDocument();
    expect(screen.getByText('详细信息')).toBeInTheDocument();
  });

  it('渲染 stage badge', () => {
    render(<TimelineLogPanel events={events} placeholder="" />);
    expect(screen.getByText('ASR')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd packages/ui && npx vitest run src/components/LogPanel.test.tsx`
Expected: FAIL

- [ ] **Step 3: 实现 LogPanel**

```typescript
// packages/ui/src/components/LogPanel.tsx
import { formatTimestamp } from '../utils/format-time';

// ===== 类型 =====

export type TimelineStage = 'system' | 'asr' | 'structurer' | 'graph';
export type TimelineTone = 'neutral' | 'success' | 'warning' | 'error';

export type TimelineEvent = {
  id: string;
  timestamp: number;
  stage: TimelineStage;
  message: string;
  detail?: string;
  tone: TimelineTone;
  repeatCount?: number;
};

// ===== 简单日志面板（Web Demo 用）=====

export type SimpleLogPanelProps = {
  logs: string[];
  placeholder?: string;
};

export function SimpleLogPanel({ logs, placeholder = '暂无日志' }: SimpleLogPanelProps) {
  return (
    <div
      style={{
        borderLeft: '1px solid var(--lg-rim)',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: 'var(--lg-ink)',
      }}
    >
      <div
        style={{
          padding: '8px 12px',
          borderBottom: '1px solid var(--lg-rim)',
          color: 'var(--lg-success)',
          fontSize: 'var(--text-sm)',
          fontWeight: 600,
        }}
      >
        日志 ({logs.length})
      </div>
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '8px 12px',
          fontFamily: 'monospace',
          fontSize: 'var(--text-xs)',
          color: 'var(--lg-success)',
        }}
      >
        {logs.length === 0 ? (
          <div style={{ color: 'var(--lg-muted)' }}>{placeholder}</div>
        ) : (
          logs.map((log, i) => (
            <div key={i} style={{ marginBottom: 4, wordBreak: 'break-all' }}>
              {log}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ===== 时间轴日志面板（Extension 用）=====

function formatStageLabel(stage: TimelineStage): string {
  switch (stage) {
    case 'asr': return 'ASR';
    case 'structurer': return 'Structurer';
    case 'graph': return 'Graph';
    default: return 'System';
  }
}

function getToneColors(tone: TimelineTone) {
  switch (tone) {
    case 'success':
      return { border: '#14532d', badge: '#14532d', badgeText: '#dcfce7', text: '#dcfce7', detail: '#86efac' };
    case 'warning':
      return { border: '#92400e', badge: '#92400e', badgeText: '#fef3c7', text: '#fde68a', detail: '#fbbf24' };
    case 'error':
      return { border: '#991b1b', badge: '#991b1b', badgeText: '#fee2e2', text: '#fecaca', detail: '#fca5a5' };
    default:
      return { border: '#334155', badge: '#0f172a', badgeText: '#cbd5e1', text: '#e2e8f0', detail: '#94a3b8' };
  }
}

export type TimelineLogPanelProps = {
  events: TimelineEvent[];
  placeholder?: string;
  /** 固定高度（px） */
  height?: number;
};

export function TimelineLogPanel({
  events,
  placeholder = '点击"开始"启动会话，状态与事件会在这里实时出现。',
  height,
}: TimelineLogPanelProps) {
  return (
    <div
      data-testid="log-area"
      style={{
        height: height ?? 'auto',
        overflowY: 'auto',
        backgroundColor: 'var(--lg-calm)',
        color: 'var(--lg-ink)',
        fontFamily: 'var(--font-mono)',
        fontSize: 'var(--text-xs)',
        padding: '8px',
        borderTop: '1px solid var(--lg-rim)',
      }}
    >
      {events.length === 0 ? (
        <div style={{ color: 'var(--lg-muted)' }}>{placeholder}</div>
      ) : (
        events.map((event) => {
          const colors = getToneColors(event.tone);
          return (
            <div
              key={event.id}
              style={{
                marginBottom: 6,
                border: `1px solid ${colors.border}`,
                borderRadius: 8,
                padding: '6px 8px',
                backgroundColor: 'var(--lg-surface)',
                display: 'grid',
                gap: 4,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                <span style={{ color: 'var(--lg-muted)', fontSize: 'var(--text-2xs)' }}>
                  {formatTimestamp(event.timestamp)}
                </span>
                <span
                  style={{
                    fontSize: 'var(--text-2xs)',
                    padding: '1px 6px',
                    borderRadius: 999,
                    backgroundColor: colors.badge,
                    color: colors.badgeText,
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                  }}
                >
                  {formatStageLabel(event.stage)}
                </span>
                {(event.repeatCount ?? 1) > 1 && (
                  <span
                    style={{
                      fontSize: 'var(--text-2xs)',
                      padding: '1px 6px',
                      borderRadius: 999,
                      backgroundColor: 'var(--lg-rim)',
                      color: 'var(--lg-muted)',
                    }}
                  >
                    x{event.repeatCount}
                  </span>
                )}
              </div>
              <div style={{ color: colors.text, wordBreak: 'break-word' }}>
                {event.message}
              </div>
              {event.detail && (
                <div style={{ color: colors.detail, wordBreak: 'break-word' }}>
                  {event.detail}
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd packages/ui && npx vitest run src/components/LogPanel.test.tsx`
Expected: 6 tests PASS

- [ ] **Step 5: 更新导出并提交**

在 `index.ts` 追加：
```typescript
export { SimpleLogPanel, TimelineLogPanel } from './components/LogPanel';
export type { SimpleLogPanelProps, TimelineLogPanelProps, TimelineEvent, TimelineStage, TimelineTone } from './components/LogPanel';
```

```bash
git add packages/ui/src/components/LogPanel.tsx packages/ui/src/components/LogPanel.test.tsx packages/ui/src/index.ts
git commit -m "feat(ui): add SimpleLogPanel and TimelineLogPanel components"
```

---

## Task 8: ResizeHandle 组件

**Files:**
- Create: `packages/ui/src/components/ResizeHandle.tsx`
- Test: `packages/ui/src/components/ResizeHandle.test.tsx`
- Modify: `packages/ui/src/index.ts`

**背景：** Extension 的日志面板上方有一个可拖拽的分割条（App.tsx:1043-1048，8px 高），用于调整日志面板高度。这个交互模式通用性高（未来任何可折叠面板都可能用到）。

- [ ] **Step 1: 写测试**

```typescript
// packages/ui/src/components/ResizeHandle.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ResizeHandle } from './ResizeHandle';

describe('ResizeHandle', () => {
  it('渲染分割条并带正确的 role', () => {
    render(<ResizeHandle onResizeStart={() => {}} />);
    const handle = screen.getByRole('separator');
    expect(handle).toBeInTheDocument();
    expect(handle.style.cursor).toBe('row-resize');
  });

  it('mousedown 触发 onResizeStart', () => {
    const onResizeStart = vi.fn();
    render(<ResizeHandle onResizeStart={onResizeStart} />);
    fireEvent.mouseDown(screen.getByRole('separator'));
    expect(onResizeStart).toHaveBeenCalledOnce();
  });

  it('渲染拖拽指示器', () => {
    render(<ResizeHandle onResizeStart={() => {}} />);
    const handle = screen.getByRole('separator');
    const indicator = handle.querySelector('div');
    expect(indicator).toBeTruthy();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd packages/ui && npx vitest run src/components/ResizeHandle.test.tsx`
Expected: FAIL

- [ ] **Step 3: 实现 ResizeHandle**

```typescript
// packages/ui/src/components/ResizeHandle.tsx

export type ResizeHandleProps = {
  /** 拖拽开始的回调（mousedown） */
  onResizeStart: () => void;
  /** aria-label 文本，默认 "调整面板高度" */
  ariaLabel?: string;
};

export function ResizeHandle({
  onResizeStart,
  ariaLabel = '调整面板高度',
}: ResizeHandleProps) {
  return (
    <div
      data-testid="resize-handle"
      onMouseDown={onResizeStart}
      style={{
        height: 8,
        flexShrink: 0,
        cursor: 'row-resize',
        background:
          'linear-gradient(to bottom, var(--lg-rim) 0, var(--lg-rim) 1px, var(--lg-calm) 1px, var(--lg-calm) 100%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
      aria-label={ariaLabel}
      role="separator"
    >
      <div
        style={{
          width: 48,
          height: 4,
          borderRadius: 999,
          backgroundColor: 'var(--lg-mist)',
        }}
      />
    </div>
  );
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd packages/ui && npx vitest run src/components/ResizeHandle.test.tsx`
Expected: 3 tests PASS

- [ ] **Step 5: 更新导出并提交**

在 `index.ts` 追加：
```typescript
export { ResizeHandle } from './components/ResizeHandle';
export type { ResizeHandleProps } from './components/ResizeHandle';
```

```bash
git add packages/ui/src/components/ResizeHandle.tsx packages/ui/src/components/ResizeHandle.test.tsx packages/ui/src/index.ts
git commit -m "feat(ui): add ResizeHandle component"
```

---

## Task 9: StatusCard 组件

**Files:**
- Create: `packages/ui/src/components/StatusCard.tsx`
- Test: `packages/ui/src/components/StatusCard.test.tsx`
- Modify: `packages/ui/src/index.ts`

**背景：** Extension 有 ASR/Structurer 两张状态卡片（App.tsx:883-950），使用 tone-based 颜色系统（active/waiting/success/warning/congested/error），颜色计算逻辑在 `timeline-utils.ts:getStatusCardStyles`。Web Demo 当前没有状态卡片，但未来可能需要。状态卡片的布局和颜色逻辑是通用的。

- [ ] **Step 1: 写测试**

```typescript
// packages/ui/src/components/StatusCard.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusCard } from './StatusCard';

describe('StatusCard', () => {
  it('渲染标题、状态和详情', () => {
    render(
      <StatusCard
        label="ASR"
        status="连接中"
        detail="等待服务响应"
        tone="waiting"
      />,
    );
    expect(screen.getByText('ASR')).toBeInTheDocument();
    expect(screen.getByText('连接中')).toBeInTheDocument();
    expect(screen.getByText('等待服务响应')).toBeInTheDocument();
  });

  it('tone=active 时添加 lg-status-card--signal class', () => {
    const { container } = render(
      <StatusCard label="ASR" status="运行中" detail="" tone="active" />,
    );
    const card = container.firstElementChild as HTMLElement;
    expect(card.className).toContain('lg-status-card--signal');
  });

  it('tone=warning 时添加 lg-status-card--insight class', () => {
    const { container } = render(
      <StatusCard label="ASR" status="延迟" detail="" tone="warning" />,
    );
    const card = container.firstElementChild as HTMLElement;
    expect(card.className).toContain('lg-status-card--insight');
  });

  it('isRunning 时渲染活跃波形条', () => {
    const { container } = render(
      <StatusCard label="ASR" status="运行中" detail="" tone="active" isRunning />,
    );
    const waveform = container.querySelector('.lg-waveform-bar--active');
    expect(waveform).toBeTruthy();
  });

  it('非运行状态不渲染活跃波形条', () => {
    const { container } = render(
      <StatusCard label="ASR" status="空闲" detail="" tone="neutral" />,
    );
    const waveform = container.querySelector('.lg-waveform-bar--active');
    expect(waveform).toBeNull();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd packages/ui && npx vitest run src/components/StatusCard.test.tsx`
Expected: FAIL

- [ ] **Step 3: 实现 StatusCard**

```typescript
// packages/ui/src/components/StatusCard.tsx

export type StatusCardTone =
  | 'neutral'
  | 'waiting'
  | 'active'
  | 'success'
  | 'warning'
  | 'congested'
  | 'error';

export type StatusCardProps = {
  /** 卡片标签（如 "ASR"） */
  label: string;
  /** 状态文本 */
  status: string;
  /** 详情文本 */
  detail: string;
  /** 色调 */
  tone: StatusCardTone;
  /** 是否正在运行（显示波形动画） */
  isRunning?: boolean;
};

function getStatusCardStyles(tone: StatusCardTone) {
  switch (tone) {
    case 'active':
      return {
        backgroundColor: 'var(--lg-signal-glow)',
        borderColor: 'var(--lg-signal-dim)',
        titleColor: 'var(--lg-signal-dim)',
        statusColor: 'var(--lg-signal)',
        detailColor: 'var(--lg-signal)',
      };
    case 'waiting':
      return {
        backgroundColor: 'var(--lg-signal-glow)',
        borderColor: 'var(--lg-mist)',
        titleColor: 'var(--lg-signal-dim)',
        statusColor: 'var(--lg-signal-dim)',
        detailColor: 'var(--lg-signal)',
      };
    case 'success':
      return {
        backgroundColor: 'var(--lg-surface)',
        borderColor: 'var(--lg-success)',
        titleColor: 'var(--lg-success)',
        statusColor: 'var(--lg-success)',
        detailColor: 'var(--lg-success)',
      };
    case 'warning':
      return {
        backgroundColor: 'var(--lg-insight-glow)',
        borderColor: 'var(--lg-warning)',
        titleColor: 'var(--lg-insight-dim)',
        statusColor: 'var(--lg-insight-dim)',
        detailColor: 'var(--lg-insight)',
      };
    case 'congested':
      return {
        backgroundColor: 'var(--lg-insight-glow)',
        borderColor: 'var(--lg-insight)',
        titleColor: 'var(--lg-insight-dim)',
        statusColor: 'var(--lg-insight)',
        detailColor: 'var(--lg-insight)',
      };
    case 'error':
      return {
        backgroundColor: 'var(--lg-surface)',
        borderColor: 'var(--lg-danger)',
        titleColor: 'var(--lg-danger)',
        statusColor: 'var(--lg-danger)',
        detailColor: 'var(--lg-danger)',
      };
    case 'neutral':
    default:
      return {
        backgroundColor: 'var(--lg-calm)',
        borderColor: 'var(--lg-rim)',
        titleColor: 'var(--lg-muted)',
        statusColor: 'var(--lg-muted)',
        detailColor: 'var(--lg-muted)',
      };
  }
}

function toneToCssModifier(tone: StatusCardTone): string {
  if (tone === 'active' || tone === 'waiting' || tone === 'success') return '--signal';
  if (tone === 'warning' || tone === 'congested') return '--insight';
  return '';
}

export function StatusCard({ label, status, detail, tone, isRunning }: StatusCardProps) {
  const styles = getStatusCardStyles(tone);
  const modifier = toneToCssModifier(tone);

  return (
    <div
      className={`lg-status-card${modifier ? ` lg-status-card${modifier}` : ''}`}
      style={{
        position: 'relative',
        overflow: 'hidden',
        padding: '4px 8px',
        display: 'grid',
        gap: 2,
        minWidth: 0,
      }}
    >
      <div
        style={{
          fontSize: 'var(--text-xs)',
          fontWeight: 700,
          color: styles.statusColor,
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          minWidth: 0,
        }}
      >
        <span style={{ color: styles.titleColor, fontSize: 'var(--text-2xs)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
          {label}
        </span>
        <span style={{ color: 'var(--lg-mist)' }}>·</span>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {status}
        </span>
      </div>
      <div
        title={detail}
        style={{
          fontSize: 'var(--text-2xs)',
          color: styles.detailColor,
          lineHeight: 1.3,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {detail}
      </div>
      <div
        className={`lg-waveform-bar${isRunning ? ' lg-waveform-bar--active' : ''}`}
        style={{ marginTop: 4 }}
      />
    </div>
  );
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd packages/ui && npx vitest run src/components/StatusCard.test.tsx`
Expected: 5 tests PASS

- [ ] **Step 5: 更新导出并提交**

在 `index.ts` 追加：
```typescript
export { StatusCard } from './components/StatusCard';
export type { StatusCardProps, StatusCardTone } from './components/StatusCard';
```

```bash
git add packages/ui/src/components/StatusCard.tsx packages/ui/src/components/StatusCard.test.tsx packages/ui/src/index.ts
git commit -m "feat(ui): add StatusCard component with tone-based theming"
```

---

## Task 10: ErrorBanner 组件

**Files:**
- Create: `packages/ui/src/components/ErrorBanner.tsx`
- Test: `packages/ui/src/components/ErrorBanner.test.tsx`
- Modify: `packages/ui/src/index.ts`

**背景：** Extension 在工具栏下方显示最近错误横幅（App.tsx:873-881，stage / code / message）。这是通用的内联错误展示模式。

- [ ] **Step 1: 写测试**

```typescript
// packages/ui/src/components/ErrorBanner.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ErrorBanner } from './ErrorBanner';

describe('ErrorBanner', () => {
  it('渲染错误标题和消息', () => {
    render(
      <ErrorBanner stage="ASR" code="TIMEOUT" message="连接超时" />,
    );
    expect(screen.getByText('最近错误')).toBeInTheDocument();
    expect(screen.getByText(/ASR/)).toBeInTheDocument();
    expect(screen.getByText(/TIMEOUT/)).toBeInTheDocument();
    expect(screen.getByText('连接超时')).toBeInTheDocument();
  });

  it('使用 data-testid="error-banner"', () => {
    render(<ErrorBanner stage="ASR" code="ERR" message="test" />);
    expect(screen.getByTestId('error-banner')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd packages/ui && npx vitest run src/components/ErrorBanner.test.tsx`
Expected: FAIL

- [ ] **Step 3: 实现 ErrorBanner**

```typescript
// packages/ui/src/components/ErrorBanner.tsx

export type ErrorBannerProps = {
  /** 错误阶段（如 "ASR"、"Structurer"） */
  stage: string;
  /** 错误码 */
  code: string;
  /** 错误消息 */
  message: string;
};

export function ErrorBanner({ stage, code, message }: ErrorBannerProps) {
  return (
    <div
      data-testid="error-banner"
      style={{
        padding: '8px 12px',
        borderBottom: '1px solid var(--lg-danger)',
        backgroundColor: 'var(--lg-surface)',
        color: 'var(--lg-danger)',
        fontSize: 'var(--text-xs)',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        flexShrink: 0,
      }}
    >
      <span style={{ fontWeight: 700 }}>最近错误</span>
      <span style={{ fontFamily: 'monospace' }}>{stage} / {code}</span>
      <span style={{ color: 'var(--lg-danger)' }}>{message}</span>
    </div>
  );
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd packages/ui && npx vitest run src/components/ErrorBanner.test.tsx`
Expected: 2 tests PASS

- [ ] **Step 5: 更新导出并提交**

在 `index.ts` 追加：
```typescript
export { ErrorBanner } from './components/ErrorBanner';
export type { ErrorBannerProps } from './components/ErrorBanner';
```

```bash
git add packages/ui/src/components/ErrorBanner.tsx packages/ui/src/components/ErrorBanner.test.tsx packages/ui/src/index.ts
git commit -m "feat(ui): add ErrorBanner component"
```

---

## Task 11: StatusBar 组件

**Files:**
- Create: `packages/ui/src/components/StatusBar.tsx`
- Test: `packages/ui/src/components/StatusBar.test.tsx`
- Modify: `packages/ui/src/index.ts`

**背景：** 两边都有底部状态栏。Extension 显示 sessionId + currentTime（App.tsx:1063-1066），Web Demo 显示 sessionId + 节点/边数量（App.tsx:512-527）。用 `segments` props 传入各段信息。

- [ ] **Step 1: 写测试**

```typescript
// packages/ui/src/components/StatusBar.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusBar } from './StatusBar';

describe('StatusBar', () => {
  it('渲染 segments', () => {
    render(
      <StatusBar
        segments={[
          { id: 'session', content: '会话: abc123' },
          { id: 'time', content: '当前时间: 1:05' },
        ]}
      />,
    );
    expect(screen.getByText('会话: abc123')).toBeInTheDocument();
    expect(screen.getByText('当前时间: 1:05')).toBeInTheDocument();
  });

  it('渲染 children 作为替代', () => {
    render(
      <StatusBar>
        <span>自定义内容</span>
      </StatusBar>,
    );
    expect(screen.getByText('自定义内容')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd packages/ui && npx vitest run src/components/StatusBar.test.tsx`
Expected: FAIL

- [ ] **Step 3: 实现 StatusBar**

```typescript
// packages/ui/src/components/StatusBar.tsx

export type StatusBarSegment = {
  id: string;
  content: string;
};

export type StatusBarProps = {
  /** 结构化的段落列表（自动 spread 布局） */
  segments?: StatusBarSegment[];
  /** 自定义内容（优先级低于 segments） */
  children?: React.ReactNode;
};

export function StatusBar({ segments, children }: StatusBarProps) {
  return (
    <div
      style={{
        padding: '6px 12px',
        borderTop: '1px solid var(--lg-rim)',
        fontSize: 'var(--text-xs)',
        color: 'var(--lg-muted)',
        flexShrink: 0,
        display: 'flex',
        justifyContent: 'space-between',
        gap: 12,
        flexWrap: 'wrap',
      }}
    >
      {segments
        ? segments.map((seg) => <span key={seg.id}>{seg.content}</span>)
        : children}
    </div>
  );
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd packages/ui && npx vitest run src/components/StatusBar.test.tsx`
Expected: 2 tests PASS

- [ ] **Step 5: 更新导出并提交**

在 `index.ts` 追加：
```typescript
export { StatusBar } from './components/StatusBar';
export type { StatusBarProps, StatusBarSegment } from './components/StatusBar';
```

```bash
git add packages/ui/src/components/StatusBar.tsx packages/ui/src/components/StatusBar.test.tsx packages/ui/src/index.ts
git commit -m "feat(ui): add StatusBar component"
```

---

## Task 12: Web Demo 迁移

**Files:**
- Modify: `apps/web-demo/src/App.tsx`

**背景：** 将 Web Demo 的内联 UI 代码替换为 `@listen-graphic/ui` 导出的共享组件。Web Demo 没有复杂的状态管理（只用 `useState`），迁移风险最低，先从这里入手。

- [ ] **Step 1: 迁移 Web Demo App.tsx 使用共享组件**

将 `apps/web-demo/src/App.tsx` 中的导入替换为：

```typescript
import {
  GraphNodeCard,
  formatGraphNodeTime,
  EmptyState,
  useTheme,
  type GraphNodeCardData,
  GraphToolbar,
  ViewSwitcher,
  GraphArea,
  StatusBar,
  SimpleLogPanel,
  SignalIndicator,
  VIEW_TYPES,
  VIEW_LABELS,
} from '@listen-graphic/ui';
```

在 return JSX 中：

```tsx
// 工具栏替换为：
<GraphToolbar
  brandName="Listen Graphic"
  primaryAction={{
    label: isRunning ? '停止' : '开始',
    onClick: isRunning ? handleStop : handleStart,
    active: isRunning,
    disabled: isFixturePreview,
  }}
  info={
    <>
      {fixtureSeq.sequenceId && (
        <span style={{ fontSize: 'var(--text-sm)', color: fixtureSeq.error ? 'var(--lg-danger)' : 'var(--lg-muted)' }}>
          {fixtureSeq.error ?? (fixtureSeq.active ? `sequence step ${fixtureSeq.stepIndex + 1}/${fixtureSeq.total}` : `sequence: ${fixtureSeq.sequenceId}`)}
        </span>
      )}
      <SignalIndicator active={isRunning} />
    </>
  }
/>

// 视图切换替换为：
<ViewSwitcher currentView={currentView as ViewType} onViewChange={(v) => setCurrentView(v)} />

// 图表区域替换为：
<GraphArea
  nodes={layoutNodes}
  edges={layoutEdges}
  nodeTypes={nodeTypes}
  isIdle={sessionState === 'idle' && displayGraph.nodes.length === 0}
  onNodeClick={handleNodeClick}
  fitView
/>

// 日志面板替换为：
<SimpleLogPanel logs={logs} placeholder="点击"开始"启动会话..." />

// 底部状态栏替换为：
<StatusBar
  segments={[
    { id: 'session', content: `会话: ${sessionId || '无'}` },
    { id: 'stats', content: `节点: ${displayGraph.nodes.length} | 边: ${displayGraph.edges.length}` },
  ]}
/>
```

删除以下内联常量（已由共享常量替代）：
- `VIEW_TYPES` 局部定义（App.tsx:170）
- `VIEW_LABELS` 局部定义（App.tsx:171-176）

- [ ] **Step 2: 运行 Web Demo 构建验证**

Run: `cd apps/web-demo && npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 3: 运行 Web Demo 现有测试**

Run: `cd apps/web-demo && npx vitest run`
Expected: 所有测试 PASS

- [ ] **Step 4: 启动 Web Demo 目视验证**

Run: `pnpm dev:web`
验证：
- [ ] 工具栏正确显示品牌名、主题切换、开始/停止按钮
- [ ] 视图切换按钮组正常工作
- [ ] 图谱区域在空闲时显示 EmptyState，开始后显示 ReactFlow
- [ ] 日志面板正常显示
- [ ] 底部状态栏正确显示信息
- [ ] 主题切换正常

- [ ] **Step 5: 提交**

```bash
git add apps/web-demo/src/App.tsx
git commit -m "refactor(web-demo): migrate to shared UI components from @listen-graphic/ui"
```

---

## Task 13: Extension 迁移

**Files:**
- Modify: `apps/extension/src/sidepanel/App.tsx`
- Modify: `apps/extension/src/sidepanel/constants.ts`
- Modify: `apps/extension/src/sidepanel/timeline-utils.ts`

**背景：** Extension 的 App.tsx 有 1070 行，内含大量内联 UI。迁移策略：逐步替换，每次只改一个区域，确保每步可编译、可测试。

**⚠️ 这个 Task 较大，建议拆分为多个子步骤执行。**

- [ ] **Step 1: 迁移常量导入**

在 `apps/extension/src/sidepanel/constants.ts` 中：

将 `VIEW_TYPES`、`VIEW_LABELS` 的本地定义删除，改为从 `@listen-graphic/ui` 导入：

```typescript
// 删除本地定义的 VIEW_TYPES 和 VIEW_LABELS
// 改为：
export { VIEW_TYPES, VIEW_LABELS } from '@listen-graphic/ui';
```

验证其他文件的导入路径不变（它们都从 `./constants` 导入）。

- [ ] **Step 2: 迁移 timeline-utils 中的共享函数**

在 `apps/extension/src/sidepanel/timeline-utils.ts` 中：

将 `formatTime` 改为从 `@listen-graphic/ui` 导入：

```typescript
// 删除本地 formatTime 函数定义（第 253-257 行）
// 在文件顶部添加导入：
import { formatTime, formatRelativeAge } from '@listen-graphic/ui';
```

注意：`getStatusCardStyles` 保留在本地（StatusCard 组件已内含，但 Extension 还在直接使用 `getTimelineToneStyles` 等），待后续统一。

- [ ] **Step 3: 更新 App.tsx 导入**

在 `apps/extension/src/sidepanel/App.tsx` 顶部追加导入：

```typescript
import {
  GraphToolbar,
  ViewSwitcher,
  GraphArea,
  StatusBar,
  StatusCard,
  ResizeHandle,
  ErrorBanner,
  DropdownMenu,
  SignalIndicator,
  formatTime,
  formatRelativeAge,
} from '@listen-graphic/ui';
```

删除以下旧导入（如果被替代）：
- 从 `./timeline-utils` 中删除 `formatTime`、`formatRelativeAge` 的导入（改从 `@listen-graphic/ui` 导入）
- 从 `./timeline-utils` 中删除 `getStatusCardStyles` 的导入（改用 `StatusCard` 组件内置）
- 删除 `import { OverflowMenu } from './OverflowMenu'`

- [ ] **Step 4: 替换工具栏**

将 App.tsx 中的工具栏区域（约第 828-865 行）替换为：

```tsx
<GraphToolbar
  brandName="Listen Graphic"
  primaryAction={{
    label: isRunning ? '停止' : '开始',
    onClick: isRunning ? handleStop : handleStart,
    active: isRunning,
  }}
  actions={
    <>
      <button
        className="lg-btn lg-btn-ghost lg-btn-sm"
        onClick={() => void handleToggleAllSettings()}
        style={{ backgroundColor: settingsOpen ? 'var(--lg-calm)' : undefined, color: settingsOpen ? 'var(--lg-signal)' : undefined }}
      >
        设置
      </button>
      <DropdownMenu
        triggerLabel="更多"
        items={[
          { id: 'export-json', label: '导出 JSON', disabled: !canExport },
          { id: 'export-markdown', label: '导出 Markdown', disabled: !canExport },
          { id: 'export-mermaid', label: '导出 Mermaid', disabled: !canExport },
          { id: 'debug', label: '调试', active: debugOpen },
          { id: 'replay', label: '回放', disabled: !canReplay, active: replayOpen },
        ]}
        onSelect={(id) => {
          switch (id) {
            case 'export-json': handleExport('json'); break;
            case 'export-markdown': handleExport('markdown'); break;
            case 'export-mermaid': handleExport('mermaid'); break;
            case 'debug': setDebugOpen((p) => !p); break;
            case 'replay': void handleToggleReplay(); break;
          }
        }}
        footer={`UI ${BUILD_INFO.label} | Worker ${panel.workerBuildLabel}`}
      />
    </>
  }
/>
```

- [ ] **Step 5: 替换错误横幅**

将错误横幅区域（约第 873-881 行）替换为：

```tsx
{panel.recentProviderError && (
  <ErrorBanner
    stage={formatErrorStageLabel(panel.recentProviderError.stage)}
    code={panel.recentProviderError.code}
    message={panel.recentProviderError.message}
  />
)}
```

注意：`formatErrorStageLabel` 仍从 `./timeline-utils` 导入。

- [ ] **Step 6: 替换状态卡片**

将状态卡片区域（约第 883-950 行）替换为：

```tsx
<div className="lg-status-cards-grid" style={{ padding: '6px 12px', gap: 8, flexShrink: 0 }}>
  {primaryStatusCards.map((card) => (
    <StatusCard
      key={card.label}
      label={card.label}
      status={card.status}
      detail={card.detail}
      tone={card.tone}
      isRunning={card.tone === 'active'}
    />
  ))}
</div>
```

- [ ] **Step 7: 替换视图切换**

将视图切换区域（约第 992-1019 行）替换为：

```tsx
<ViewSwitcher
  currentView={currentView}
  onViewChange={(v) => {
    lastUserViewportChangeAtRef.current = Date.now();
    pauseAutoTour();
    userPinnedViewRef.current = true;
    setUserViewOverride(v);
    if (panel.sessionId && isRunning) {
      void chrome.runtime.sendMessage({
        type: 'VIEW_SELECTED', target: 'service-worker',
        payload: { sessionId: panel.sessionId, view: v },
      } as AppMessage);
    }
  }}
  onFitView={() => requestAutoFit({ force: true })}
  fitViewDisabled={panel.graph.nodes.length === 0}
/>
```

- [ ] **Step 8: 替换图表区域**

将图表区域（约第 1021-1042 行）替换为：

```tsx
<GraphArea
  nodes={flowNodes}
  edges={flowEdges}
  nodeTypes={nodeTypes}
  isIdle={panel.graph.nodes.length === 0 && !isRunning && panel.sessionState === 'idle'}
  onNodeClick={handleNodeClick}
  onMoveStart={handleViewportMoveStart}
  onMoveEnd={handleViewportMoveEnd}
  onInit={(instance) => {
    reactFlowInstanceRef.current = instance;
    queueMicrotask(() => requestAutoFit());
  }}
/>
```

- [ ] **Step 9: 替换 ResizeHandle + LogPanel**

将拖拽条（约第 1043-1048 行）替换为：

```tsx
<ResizeHandle onResizeStart={handleLogResizeStart} />
```

将 LogPanel 替换为从 `@listen-graphic/ui` 导入的 `TimelineLogPanel`：

```tsx
<TimelineLogPanel events={panel.timelineEvents} height={logPanelHeight} />
```

注意：需要将 Extension 的 `TimelineEvent` 类型与 UI 包的 `TimelineEvent` 类型做兼容。Extension 的类型定义在 `types.ts`，UI 包的定义在 `LogPanel.tsx`。字段完全一致，可以直接用 UI 包的类型。

- [ ] **Step 10: 替换底部状态栏**

将底部状态栏（约第 1063-1066 行）替换为：

```tsx
<StatusBar
  segments={[
    { id: 'session', content: `会话: ${panel.sessionId || '无'}` },
    { id: 'time', content: `当前时间: ${formatTime(panel.currentTimeMs)}` },
  ]}
/>
```

- [ ] **Step 11: 运行 TypeScript 检查**

Run: `cd apps/extension && npx tsc --noEmit`
Expected: 0 errors

- [ ] **Step 12: 运行 Extension 现有测试**

Run: `cd apps/extension && npx vitest run`
Expected: 所有测试 PASS

- [ ] **Step 13: 提交**

```bash
git add apps/extension/src/sidepanel/App.tsx apps/extension/src/sidepanel/constants.ts apps/extension/src/sidepanel/timeline-utils.ts
git commit -m "refactor(extension): migrate to shared UI components from @listen-graphic/ui"
```

---

## Task 14: 清理 & 最终验证

**Files:**
- Modify: `packages/ui/src/index.ts` — 最终确认导出完整性
- Verify: 两个应用的构建和测试

**背景：** 所有组件迁移完成后，做最终验证：确保两个应用都能正常构建、所有测试通过、没有遗留的重复代码。

- [ ] **Step 1: 确认 packages/ui 导出完整性**

读取 `packages/ui/src/index.ts`，确认所有新组件和类型都有导出。预期完整导出清单：

```typescript
// === 原有导出 ===
export type { GraphNodeCardData, GraphNodeDisplayMode, GraphNodeHandleMode } from './types';
export { formatGraphNodeTime, getGraphNodeTypeColor, getGraphNodeTypeLabel } from './graph-node-utils';
export { GRAPH_NODE_BODY_FONT_PX } from './constants';
export { GraphNodeCard } from './GraphNodeCard';
export { EmptyState } from './EmptyState';
export type { EmptyStateProps } from './EmptyState';
export { useTheme } from './hooks/useTheme';
export type { Theme } from './hooks/useTheme';

// === 新增导出 ===
export { VIEW_TYPES, VIEW_LABELS } from './constants/shared-constants';
export { formatTime, formatRelativeAge, formatTimestamp } from './utils/format-time';

export { SignalIndicator } from './components/SignalIndicator';
export type { SignalIndicatorProps } from './components/SignalIndicator';

export { ViewSwitcher } from './components/ViewSwitcher';
export type { ViewSwitcherProps } from './components/ViewSwitcher';

export { DropdownMenu } from './components/DropdownMenu';
export type { DropdownMenuProps, DropdownMenuItem } from './components/DropdownMenu';

export { GraphToolbar } from './components/GraphToolbar';
export type { GraphToolbarProps, ToolbarPrimaryAction } from './components/GraphToolbar';

export { GraphArea } from './components/GraphArea';
export type { GraphAreaProps } from './components/GraphArea';

export { SimpleLogPanel, TimelineLogPanel } from './components/LogPanel';
export type { SimpleLogPanelProps, TimelineLogPanelProps, TimelineEvent, TimelineStage, TimelineTone } from './components/LogPanel';

export { ResizeHandle } from './components/ResizeHandle';
export type { ResizeHandleProps } from './components/ResizeHandle';

export { StatusCard } from './components/StatusCard';
export type { StatusCardProps, StatusCardTone } from './components/StatusCard';

export { ErrorBanner } from './components/ErrorBanner';
export type { ErrorBannerProps } from './components/ErrorBanner';

export { StatusBar } from './components/StatusBar';
export type { StatusBarProps, StatusBarSegment } from './components/StatusBar';
```

- [ ] **Step 2: 运行 UI 包全部测试**

Run: `cd packages/ui && npx vitest run`
Expected: 所有测试 PASS（约 40+ tests，含原有 10+ tests 和新增 30+ tests）

- [ ] **Step 3: 运行 Web Demo 全部测试**

Run: `cd apps/web-demo && npx vitest run`
Expected: 所有测试 PASS

- [ ] **Step 4: 运行 Extension 全部测试**

Run: `cd apps/extension && npx vitest run`
Expected: 所有测试 PASS

- [ ] **Step 5: 运行根目录 TypeScript 检查**

Run: `pnpm typecheck`
Expected: 0 errors

- [ ] **Step 6: 最终提交**

```bash
git add -A
git commit -m "chore: finalize cross-platform UI component extraction"
```

---

## 未来扩展指引

本计划为 mobile app / desktop app 复用建立了基础架构。后续扩展建议：

1. **React Native** — 组件接口（Props）可直接复用，用 RN 组件实现相同接口即可
2. **Electron / Tauri** — 直接复用 Web 组件，无需改动
3. **更多共享组件** — 随业务发展，以下组件可继续抽取：
   - `SessionList` — 历史会话列表
   - `ExportDialog` — 导出对话框
   - `NodeDetailPanel` — 节点详情侧边栏
   - `ProviderStatusGrid` — Provider 状态网格
   - `GraphSummaryBar` — 图谱摘要栏（节点数/边数/自动导览状态）
   - `WaveDivider` — 波形分割线
4. **主题扩展** — 当支持 mobile 时，可能需要 `theme.css` 的 RN 等价物（如 `theme.ts` 中的 JS 对象已为此准备）
5. **无障碍** — 当前组件已有基本的 aria 属性，后续可以增强 ARIA live region、keyboard navigation 等
