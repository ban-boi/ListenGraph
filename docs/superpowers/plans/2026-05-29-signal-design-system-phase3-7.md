# Signal 设计系统 Phase 3-7 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 ListenGraph UI 从 Phase 1-2 的 token 统一推进到完整设计系统体验：布局层级、品牌波形元素、表单交互、暗色模式、响应式适配。

**Architecture:** 沿用已有的 CSS 变量 + React inline style 混合模式。新增的布局和响应式逻辑通过 CSS media query（theme.css）和少量 JS ResizeObserver（已在 App.tsx 使用）实现。波形元素复用 theme.css 已定义的 `.lg-waveform-bar`、`.lg-wave-divider` 等 CSS 类。暗色模式复用 `data-theme="dark"` 的 CSS 变量覆盖。

**Tech Stack:** React 18 + ReactFlow + Zustand v5 + CSS Custom Properties + Vitest

---

## Phase 1 补丁 — 遗漏的硬编码值修复

Phase 1 完成后，以下文件仍有硬编码颜色/字号，需先修复。

### Task 1: 修复 DebugPanel 硬编码值

**Files:**
- Modify: `apps/extension/src/sidepanel/DebugPanel.tsx:20-29`

- [ ] **Step 1: 修复 DebugPanel 根容器硬编码**

将 `DebugPanel.tsx` 根容器 style 中残留的硬编码值替换：

```tsx
// 修改前（第 20-29 行）
style={{
  borderTop: '1px solid #d1d5db',
  backgroundColor: '#f8fafc',
  padding: '8px 12px',
  fontSize: 11,
  color: '#334155',
  maxHeight: 220,
  overflowY: 'auto',
}}

// 修改后
style={{
  borderTop: '1px solid var(--lg-rim)',
  backgroundColor: 'var(--lg-calm)',
  padding: '8px 12px',
  fontSize: 'var(--text-xs)',
  color: 'var(--lg-ink-soft)',
  maxHeight: 220,
  overflowY: 'auto',
}}
```

- [ ] **Step 2: 验证 DebugPanel 构建**

Run: `pnpm typecheck`
Expected: 通过，无错误

---

### Task 2: 修复 SettingsOverlay 遗留硬编码值

**Files:**
- Modify: `apps/extension/src/sidepanel/settings/SettingsOverlay.tsx:110-170`

- [ ] **Step 1: 修复顶栏字号和 Tab 导航硬编码**

SettingsOverlay.tsx 中以下行需修改：

```tsx
// 第 120 行 — 返回按钮字号
// 修改前: style={{ cursor: 'pointer', fontSize: 12 }}
// 修改后:
style={{ cursor: 'pointer', fontSize: 'var(--text-xs)', color: 'var(--lg-signal)' }}

// 第 125 行 — 标题字号
// 修改前: <span style={{ fontWeight: 600, fontSize: 13 }}>设置</span>
// 修改后:
<span style={{ fontWeight: 600, fontSize: 'var(--text-sm)' }}>设置</span>

// 第 154-165 行 — Tab 按钮硬编码
// 修改前: fontSize: 11, backgroundColor: isActive ? 'white' : 'transparent'
// 修改后:
{
  padding: '12px 8px',
  fontSize: 'var(--text-xs)',
  fontWeight: isActive ? 600 : 400,
  color: isActive ? colors.primaryButton : colors.textSecondary,
  backgroundColor: isActive ? 'var(--lg-surface)' : 'transparent',
  borderLeft: isActive
    ? `3px solid ${colors.primaryButton}`
    : '3px solid transparent',
  cursor: 'pointer',
  textAlign: 'left' as const,
}

// 第 218 行 — 底栏字号
// 修改前: <div style={{ fontSize: 11 }}>
// 修改后:
<div style={{ fontSize: 'var(--text-xs)' }}>
```

- [ ] **Step 2: 验证构建**

Run: `pnpm typecheck`
Expected: 通过

---

### Task 3: 迁移 getStatusCardStyles 硬编码颜色

**Files:**
- Modify: `apps/extension/src/sidepanel/timeline-utils.ts:189-249`

- [ ] **Step 1: 替换 getStatusCardStyles 中所有硬编码颜色为 CSS 变量**

当前函数有 6 个 tone case，每个包含 5 个硬编码 hex 色。全部替换为 CSS 变量：

```ts
export function getStatusCardStyles(tone: StatusCardTone) {
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
```

- [ ] **Step 2: 更新依赖此函数的测试**

搜索 `getStatusCardStyles` 的测试文件，将硬编码断言更新为 CSS 变量值。

Run: `pnpm --filter extension test:run`
Expected: 全部通过

- [ ] **Step 3: 验证构建**

Run: `pnpm typecheck`
Expected: 通过

- [ ] **Step 4: 提交 Phase 1 补丁**

```bash
git add apps/extension/src/sidepanel/DebugPanel.tsx apps/extension/src/sidepanel/settings/SettingsOverlay.tsx apps/extension/src/sidepanel/timeline-utils.ts
git commit -m "fix(ui): patch remaining hardcoded values in DebugPanel, SettingsOverlay, status card styles"
```

---

## Phase 3 — 布局和信息层级

### Task 4: 顶栏重排（品牌权重视觉 + 按钮层级）

**Files:**
- Modify: `apps/extension/src/sidepanel/App.tsx:826-846`
- Modify: `apps/web-demo/src/App.tsx:364-462`

- [ ] **Step 1: Extension 顶栏迁移到 lg-toolbar CSS 类**

将 App.tsx 第 826 行的顶栏 div 从纯 inline style 改为使用 CSS 类 + 补充 inline style：

```tsx
{/* 顶部栏 — 使用 lg-toolbar 布局 */}
<div className="lg-toolbar" style={{ gap: 8 }}>
  <div className="lg-toolbar__brand">
    <span style={{ fontWeight: 'var(--weight-bold)', fontSize: 'var(--text-base)' }}>
      Listen Graphic
    </span>
  </div>
  <div className="lg-toolbar__actions">
    <button
      className="lg-btn lg-btn-ghost lg-btn-sm"
      onClick={() => void handleToggleAllSettings()}
      style={{ backgroundColor: settingsOpen ? 'var(--lg-calm)' : undefined, color: settingsOpen ? 'var(--lg-signal)' : undefined }}
    >
      设置
    </button>
    <OverflowMenu
      canExport={canExport}
      canReplay={canReplay}
      debugOpen={debugOpen}
      replayOpen={replayOpen}
      buildInfo={{ uiLabel: BUILD_INFO.label, workerLabel: panel.workerBuildLabel }}
      onExport={handleExport}
      onToggleDebug={() => setDebugOpen((p) => !p)}
      onToggleReplay={() => void handleToggleReplay()}
    />
  </div>
  <button
    className={isRunning ? 'lg-btn lg-btn-danger lg-btn-sm' : 'lg-btn lg-btn-primary lg-btn-sm'}
    onClick={isRunning ? handleStop : handleStart}
    style={{ marginLeft: 'auto' }}
  >
    {isRunning ? '停止' : '开始'}
  </button>
</div>
```

`lg-toolbar`、`lg-toolbar__brand`、`lg-toolbar__actions`、`lg-btn`、`lg-btn-primary`、`lg-btn-danger`、`lg-btn-ghost`、`lg-btn-sm` 类已在 `theme.css` 中定义。

- [ ] **Step 2: Web Demo 顶栏迁移到 lg-toolbar**

对 `apps/web-demo/src/App.tsx` 的顶栏（第 365-462 行）应用相同的 CSS 类模式：

```tsx
<div className="lg-toolbar" style={{ padding: '12px 20px', gap: 16 }}>
  <div className="lg-toolbar__brand">
    <span style={{ fontWeight: 'var(--weight-bold)', fontSize: 'var(--text-xl)' }}>
      Listen Graphic
    </span>
  </div>
  <div className="lg-signal-indicator">
    <span className={`lg-signal-dot ${isRunning ? 'lg-signal-dot--active' : 'lg-signal-dot--idle'}`} />
    <span>{isRunning ? '运行中' : '空闲'}</span>
  </div>
  <button
    className={isRunning ? 'lg-btn lg-btn-danger lg-btn-sm' : 'lg-btn lg-btn-primary lg-btn-sm'}
    onClick={isRunning ? handleStop : handleStart}
    disabled={isFixturePreview}
  >
    {isRunning ? '停止' : '开始'}
  </button>
  <div style={{ marginLeft: 'auto', fontFamily: 'monospace', fontSize: 'var(--text-base)', color: 'var(--lg-ink)' }}>
    当前时间: {formatGraphNodeTime(currentTimeMs)}
  </div>
</div>
```

- [ ] **Step 3: 验证构建**

Run: `pnpm typecheck`
Expected: 通过

- [ ] **Step 4: 提交**

```bash
git add apps/extension/src/sidepanel/App.tsx apps/web-demo/src/App.tsx
git commit -m "feat(ui): toolbar layout with lg-toolbar classes and button hierarchy"
```

---

### Task 5: 状态卡片响应式布局

**Files:**
- Modify: `apps/extension/src/sidepanel/App.tsx:857-925`
- Modify: `packages/ui/src/styles/theme.css` — 新增响应式断点

- [ ] **Step 1: 在 theme.css 新增状态卡片响应式样式**

在 `theme.css` 末尾添加：

```css
/* ================================================================
   响应式断点 — 状态卡片
   ================================================================ */
@media (max-width: 399px) {
  .lg-status-cards-grid {
    grid-template-columns: 1fr;
  }
}

@media (min-width: 400px) {
  .lg-status-cards-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
```

- [ ] **Step 2: Extension 状态卡片使用 CSS 类**

将 App.tsx 第 857-866 行的状态卡片容器从 inline grid 改为使用 CSS 类：

```tsx
<div
  data-testid="runtime-status-cards"
  className="lg-status-cards-grid"
  style={{
    padding: '6px 12px',
    gap: 8,
    flexShrink: 0,
  }}
>
```

每个卡片添加 `lg-status-card` 类和 tone 变体类：

```tsx
<div
  key={card.label}
  data-testid={`status-card-${card.label.toLowerCase()}`}
  className={`lg-status-card lg-status-card--${card.tone === 'active' || card.tone === 'waiting' ? 'signal' : card.tone === 'success' ? 'signal' : card.tone === 'warning' || card.tone === 'congested' ? 'insight' : ''}`}
  style={{
    padding: '4px 8px',
    display: 'grid',
    gap: 2,
    minWidth: 0,
  }}
>
  <div className="lg-status-card__header" style={{ marginBottom: 0 }}>
    <span className="lg-status-card__title" style={{ fontSize: 'var(--text-2xs)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
      {card.label}
    </span>
  </div>
  <div className="lg-status-card__body">
    <div className="lg-status-row">
      {/* detail */}
    </div>
  </div>
</div>
```

- [ ] **Step 3: 验证构建和测试**

Run: `pnpm typecheck`
Run: `pnpm --filter extension test:run`
Expected: 全部通过

- [ ] **Step 4: 提交**

```bash
git add packages/ui/src/styles/theme.css apps/extension/src/sidepanel/App.tsx
git commit -m "feat(ui): responsive status cards with lg-status-card classes"
```

---

### Task 6: 空状态组件

**Files:**
- Create: `packages/ui/src/EmptyState.tsx`
- Modify: `packages/ui/src/index.ts` — 导出
- Modify: `apps/extension/src/sidepanel/App.tsx:1010-1028` — 替换空图表区
- Modify: `apps/web-demo/src/App.tsx:467-479` — 替换空图表区

- [ ] **Step 1: 创建 EmptyState 组件**

创建 `packages/ui/src/EmptyState.tsx`：

```tsx
export type EmptyStateProps = {
  title?: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
};

export function EmptyState({
  title = '开始记录',
  description = '点击「开始」按钮，实时语音将被转化为结构化知识图谱',
  actionLabel,
  onAction,
}: EmptyStateProps) {
  return (
    <div className="lg-empty-state">
      <div className="lg-empty-state__icon">&#127908;&#65039;</div>
      <div className="lg-empty-state__title">{title}</div>
      <div className="lg-empty-state__desc">{description}</div>
      {actionLabel && onAction && (
        <button
          className="lg-btn lg-btn-primary"
          style={{ marginTop: 'var(--sp-4)' }}
          onClick={onAction}
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 2: 在 packages/ui/src/index.ts 中导出**

```ts
export { EmptyState } from './EmptyState';
export type { EmptyStateProps } from './EmptyState';
```

- [ ] **Step 3: Extension App.tsx 使用 EmptyState**

在 App.tsx 图表区域（约第 1010 行），当 `panel.graph.nodes.length === 0` 时显示 EmptyState：

```tsx
<div ref={flowContainerRef} style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
  {panel.graph.nodes.length === 0 ? (
    <EmptyState
      actionLabel={isRunning ? undefined : '开始'}
      onAction={isRunning ? undefined : handleStart}
    />
  ) : (
    <>
      <ReactFlow ... />
      {/* log resizer + LogPanel + DebugPanel + ReplayPanel 保持不变 */}
    </>
  )}
</div>
```

- [ ] **Step 4: Web Demo App.tsx 使用 EmptyState**

类似处理 web-demo 的图表区域。

- [ ] **Step 5: 验证构建和测试**

Run: `pnpm typecheck`
Run: `pnpm --filter extension test:run`
Expected: 全部通过

- [ ] **Step 6: 提交**

```bash
git add packages/ui/src/EmptyState.tsx packages/ui/src/index.ts apps/extension/src/sidepanel/App.tsx apps/web-demo/src/App.tsx
git commit -m "feat(ui): add EmptyState component with waveform background"
```

---

### Task 7: 视图切换器改进

**Files:**
- Modify: `apps/extension/src/sidepanel/App.tsx:966-1008`
- Modify: `apps/web-demo/src/App.tsx:428-449`

- [ ] **Step 1: Extension 移除评分数字 + 使用 lg-btn 类**

将 App.tsx 第 966-1008 行的视图切换器改为：

```tsx
{/* 视图切换 */}
<div style={{ padding: '6px 12px', borderBottom: '1px solid var(--lg-rim)', display: 'flex', gap: 6, flexShrink: 0, alignItems: 'center' }}>
  {VISIBLE_VIEW_TYPES.map((v) => {
    const isRecommended = panel.currentView === v && !userViewOverride;
    return (
      <button
        key={v}
        className={currentView === v
          ? (isRecommended ? 'lg-btn lg-btn-primary lg-btn-sm' : 'lg-btn lg-btn-secondary lg-btn-sm')
          : 'lg-btn lg-btn-ghost lg-btn-sm'}
        onClick={() => {
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
      >
        {VIEW_LABELS[v]}
      </button>
    );
  })}
  <button
    className="lg-btn lg-btn-ghost lg-btn-sm"
    onClick={() => requestAutoFit({ force: true })}
    disabled={panel.graph.nodes.length === 0}
  >
    适配视图
  </button>
</div>
```

关键变化：
- 移除 `<span>({viewScores[v].toFixed(2)})</span>`
- 使用 `lg-btn-primary`（推荐视图）、`lg-btn-secondary`（用户选中的其他视图）、`lg-btn-ghost`（未选中视图）

- [ ] **Step 2: Web Demo 视图切换器同样改进**

对 web-demo App.tsx 第 428-449 行做同样处理。

- [ ] **Step 3: 验证构建和测试**

Run: `pnpm typecheck`
Expected: 通过

- [ ] **Step 4: 提交**

```bash
git add apps/extension/src/sidepanel/App.tsx apps/web-demo/src/App.tsx
git commit -m "feat(ui): view switcher uses lg-btn classes, remove score numbers"
```

---

## Phase 4 — 波形元素注入

### Task 8: 状态卡片底边波形条

**Files:**
- Modify: `apps/extension/src/sidepanel/App.tsx:867-924` — 状态卡片模板

- [ ] **Step 1: 在状态卡片底部添加波形条**

在每个状态卡片 div 的末尾、闭合 `</div>` 前，添加波形条 div：

```tsx
<div
  key={card.label}
  data-testid={`status-card-${card.label.toLowerCase()}`}
  className={`lg-status-card lg-status-card--${card.tone === 'active' || card.tone === 'waiting' ? 'signal' : card.tone === 'warning' || card.tone === 'congested' ? 'insight' : ''}`}
  style={{
    position: 'relative',
    overflow: 'hidden',
    padding: '4px 8px',
    display: 'grid',
    gap: 2,
    minWidth: 0,
  }}
>
  {/* 现有内容保持不变 */}
  <div className={`lg-waveform-bar${isRunning ? ' lg-waveform-bar--active' : ''}`} style={{ marginTop: 4 }} />
</div>
```

`lg-waveform-bar` 和 `lg-waveform-bar--active` 已在 theme.css 中定义。`--active` 类会触发渐变动画。

- [ ] **Step 2: 验证构建**

Run: `pnpm typecheck`
Expected: 通过

- [ ] **Step 3: 提交**

```bash
git add apps/extension/src/sidepanel/App.tsx
git commit -m "feat(ui): add waveform bar to status cards"
```

---

### Task 9: 录音信号条

**Files:**
- Modify: `apps/extension/src/sidepanel/App.tsx:846` — 顶栏下方插入
- Modify: `apps/web-demo/src/App.tsx` — 顶栏下方插入

- [ ] **Step 1: Extension 顶栏下方添加录音信号条**

在 App.tsx 顶栏 `</div>` 后、error banner 前，添加：

```tsx
{/* 录音信号条 */}
{isRunning && (
  <div
    className="lg-waveform-bar lg-waveform-bar--active"
    style={{
      height: 2,
      flexShrink: 0,
      transition: 'opacity var(--dur-normal) var(--ease-out)',
    }}
  />
)}
```

- [ ] **Step 2: Web Demo 同样添加**

在 web-demo App.tsx 顶栏 div 后添加相同的录音信号条。

- [ ] **Step 3: 验证构建**

Run: `pnpm typecheck`
Expected: 通过

- [ ] **Step 4: 提交**

```bash
git add apps/extension/src/sidepanel/App.tsx apps/web-demo/src/App.tsx
git commit -m "feat(ui): recording signal bar below toolbar"
```

---

### Task 10: 波形分割线替换

**Files:**
- Modify: `apps/extension/src/sidepanel/App.tsx:826,966` — 顶栏 border-bottom

- [ ] **Step 1: Extension 顶栏 border 替换为波形分割线**

将顶栏的 `borderBottom: '1px solid var(--lg-rim)'` 替换为使用 `lg-wave-divider` 类。

在顶栏 div 之后、error banner 之前，插入波形分割线 div，同时移除顶栏的 borderBottom：

```tsx
<div className="lg-toolbar" style={{ gap: 8, borderBottom: 'none' }}>
  {/* ... 内容 ... */}
</div>
<div className="lg-wave-divider" style={{ margin: 0, height: 8 }} />
```

`lg-wave-divider` 已在 theme.css 中定义，使用 `--waveform-sm` SVG 背景。

注意：不替换视图切换器下方的 `borderBottom`，保持区域分隔的简洁性。只替换顶栏这一个品牌级分割线。

- [ ] **Step 2: 验证构建**

Run: `pnpm typecheck`
Expected: 通过

- [ ] **Step 3: 提交**

```bash
git add apps/extension/src/sidepanel/App.tsx
git commit -m "feat(ui): wave divider between toolbar and content"
```

---

## Phase 5 — 表单和交互状态

### Task 11: FormControls focus ring + error + hover

**Files:**
- Modify: `apps/extension/src/sidepanel/settings/theme.ts:94-104` — inputStyle/selectStyle
- Modify: `apps/extension/src/sidepanel/settings/FormControls.tsx:46-63` — InputField

- [ ] **Step 1: 更新 theme.ts 的 inputStyle 添加 transition**

```ts
export const inputStyle = {
  border: `1px solid ${colors.inputBorder}`,
  borderRadius: 4,
  padding: '4px 6px',
  fontSize: fontSize.base,
  width: '100%',
  transition: 'border-color var(--dur-fast) var(--ease-out), box-shadow var(--dur-fast) var(--ease-out)',
} as const;

export const inputErrorStyle = {
  ...inputStyle,
  borderColor: 'var(--lg-danger)',
  boxShadow: '0 0 0 3px oklch(60% 0.18 25 / 0.1)',
} as const;
```

注意：focus ring 通过 CSS 类 `.lg-input:focus` 已在 theme.css 中定义。由于 React inline style 无法设置 `:focus` 伪类，需要为 InputField 添加 `className="lg-input"` 让 CSS 处理 focus ring。

- [ ] **Step 2: InputField 添加 className 支持 focus ring**

修改 `FormControls.tsx` 的 InputField：

```tsx
export type InputFieldProps = {
  ariaLabel: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  error?: boolean;
};

export function InputField({
  ariaLabel,
  value,
  onChange,
  placeholder,
  type = 'text',
  error = false,
}: InputFieldProps) {
  return (
    <input
      className="lg-input"
      aria-label={ariaLabel}
      type={type}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      style={error ? inputErrorStyle : undefined}
    />
  );
}
```

当有 `className="lg-input"` 时，CSS 会处理 focus ring 和 hover 态。inline style 仅在有 error 时覆盖。

- [ ] **Step 3: SelectField 同样添加 className**

```tsx
export function SelectField({
  ariaLabel,
  value,
  onChange,
  children,
}: SelectFieldProps) {
  return (
    <select
      className="lg-input"
      aria-label={ariaLabel}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {children}
    </select>
  );
}
```

- [ ] **Step 4: 验证构建**

Run: `pnpm typecheck`
Expected: 通过

- [ ] **Step 5: 提交**

```bash
git add apps/extension/src/sidepanel/settings/theme.ts apps/extension/src/sidepanel/settings/FormControls.tsx
git commit -m "feat(ui): form controls with focus ring, hover, and error states"
```

---

### Task 12: OverflowMenu 改进（chevron + 打开动画）

**Files:**
- Modify: `apps/extension/src/sidepanel/OverflowMenu.tsx:74-89`

- [ ] **Step 1: OverflowMenu 按钮添加 chevron 和动画**

修改 toggle 按钮文本和样式：

```tsx
<button
  type="button"
  data-testid="overflow-menu-toggle"
  aria-haspopup="menu"
  aria-expanded={open}
  onClick={() => setOpen((previous) => !previous)}
  className="lg-btn lg-btn-ghost lg-btn-sm"
  style={{
    backgroundColor: open ? 'var(--lg-calm)' : undefined,
    color: open ? 'var(--lg-signal)' : undefined,
  }}
>
  更多
  <span
    style={{
      display: 'inline-block',
      marginLeft: 4,
      fontSize: 'var(--text-2xs)',
      transition: 'transform var(--dur-fast) var(--ease-out)',
      transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
    }}
  >
    &#9660;
  </span>
</button>
```

下拉菜单添加 enter 动画样式：

```tsx
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
```

在 App.tsx 的 `<style>` 标签中添加 keyframe（追加到已有的 `listen-graphic-tour-pulse` 后）：

```css
@keyframes fadeIn {
  from { opacity: 0; transform: translateY(-4px); }
  to { opacity: 1; transform: translateY(0); }
}
```

- [ ] **Step 2: 验证构建**

Run: `pnpm typecheck`
Expected: 通过

- [ ] **Step 3: 提交**

```bash
git add apps/extension/src/sidepanel/OverflowMenu.tsx apps/extension/src/sidepanel/App.tsx
git commit -m "feat(ui): OverflowMenu with chevron animation and enter transition"
```

---

## Phase 6 — 暗色模式

### Task 13: 暗色模式切换基础设施

**Files:**
- Create: `packages/ui/src/hooks/useTheme.ts`
- Modify: `packages/ui/src/index.ts` — 导出
- Modify: `apps/extension/src/sidepanel/App.tsx:823` — 根元素
- Modify: `apps/web-demo/src/App.tsx:363` — 根元素

- [ ] **Step 1: 创建 useTheme hook**

创建 `packages/ui/src/hooks/useTheme.ts`：

```ts
import { useState, useCallback, useEffect } from 'react';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'listen-graphic-theme';

function getInitialTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'dark' || stored === 'light') return stored;
  } catch {}
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(getInitialTheme);

  const toggleTheme = useCallback(() => {
    setThemeState((prev) => {
      const next = prev === 'dark' ? 'light' : 'dark';
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {}
      return next;
    });
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  return { theme, toggleTheme } as const;
}
```

- [ ] **Step 2: Extension App.tsx 接入暗色模式**

在 App.tsx 中引入 hook 并应用到根元素：

```tsx
import { useTheme } from '@listen-graphic/ui';

// 在 App() 函数内：
const { theme, toggleTheme } = useTheme();

// 根元素添加 data-theme:
<div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }} data-theme={theme}>
```

在顶栏 actions 中添加主题切换按钮（在设置按钮前）：

```tsx
<button
  className="lg-btn lg-btn-ghost lg-btn-sm"
  onClick={toggleTheme}
  title="切换主题"
>
  {theme === 'dark' ? '&#9728;&#65039;' : '&#127769;'}
</button>
```

- [ ] **Step 3: Web Demo App.tsx 接入暗色模式**

同样处理 web-demo。

- [ ] **Step 4: 在 packages/ui/src/index.ts 中导出**

```ts
export { useTheme } from './hooks/useTheme';
export type { Theme } from './hooks/useTheme';
```

- [ ] **Step 5: 验证构建**

Run: `pnpm typecheck`
Expected: 通过

- [ ] **Step 6: 提交**

```bash
git add packages/ui/src/hooks/useTheme.ts packages/ui/src/index.ts apps/extension/src/sidepanel/App.tsx apps/web-demo/src/App.tsx
git commit -m "feat(ui): dark mode toggle with useTheme hook and data-theme attribute"
```

---

### Task 14: 暗色模式视觉验证和修复

**Files:**
- Possibly modify: `packages/ui/src/styles/theme.css` — 补充缺失的暗色覆盖
- Possibly modify: 各组件 inline style 中的不兼容值

- [ ] **Step 1: 搜索并替换所有 `'white'` 硬编码**

Run: `grep -rn "'white'" apps/extension/src/sidepanel/`

将所有 `color: 'white'` 和 `backgroundColor: 'white'` 替换为 CSS 变量：
- `color: 'white'` → `color: 'var(--lg-surface)'`
- `backgroundColor: 'white'` → `backgroundColor: 'var(--lg-surface)'`

已知位置（基于当前代码库）：
- `SettingsOverlay.tsx:158` — `backgroundColor: isActive ? 'white' : 'transparent'`

- [ ] **Step 2: 验证 theme.css 暗色覆盖完整性**

检查 `[data-theme="dark"]` 块是否覆盖了所有使用的 token。当前已覆盖的变量足够大部分场景使用，但如果有新增的硬编码 oklch 值，需要在暗色块中添加对应覆盖。

- [ ] **Step 3: 视觉验证**

Run: `pnpm dev:web`

手动检查：
- 顶栏：背景色和文字对比度
- 状态卡片：可读性
- 图节点卡片：颜色辨识度
- 日志面板：文字可读性
- 设置面板：表单控件
- 波形元素：暗色背景下可见

- [ ] **Step 4: 提交修复**

```bash
git add -A
git commit -m "fix(ui): dark mode contrast fixes and hardcoded white replacements"
```

---

## Phase 7 — 响应式适配

### Task 15: 面板宽度断点

**Files:**
- Modify: `packages/ui/src/styles/theme.css` — 新增响应式断点

- [ ] **Step 1: 在 theme.css 新增响应式媒体查询**

在 `theme.css` 末尾添加：

```css
/* ================================================================
   响应式断点 — 全局
   ================================================================ */

/* 窄面板 320-399px */
@media (max-width: 399px) {
  .lg-toolbar {
    flex-wrap: wrap;
    gap: var(--sp-1);
  }

  .lg-toolbar__brand {
    font-size: var(--text-xs);
  }

  .lg-toolbar__actions {
    flex-wrap: wrap;
  }

  .lg-btn-sm {
    min-width: auto;
    padding: var(--sp-1) var(--sp-2);
    font-size: var(--text-2xs);
  }

  .lg-status-cards-grid {
    grid-template-columns: 1fr;
  }

  .lg-empty-state {
    min-height: 180px;
    padding: var(--sp-4);
  }

  .lg-empty-state__title {
    font-size: var(--text-base);
  }

  .lg-empty-state__desc {
    font-size: var(--text-xs);
  }
}

/* 中等宽度 400-499px */
@media (min-width: 400px) and (max-width: 499px) {
  .lg-status-cards-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

/* 宽松布局 500px+ */
@media (min-width: 500px) {
  .lg-toolbar {
    padding: var(--sp-3) var(--sp-5);
  }

  .lg-status-cards-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
```

- [ ] **Step 2: 验证构建**

Run: `pnpm typecheck`
Expected: 通过

- [ ] **Step 3: 提交**

```bash
git add packages/ui/src/styles/theme.css
git commit -m "feat(ui): responsive breakpoints for narrow and wide panels"
```

---

### Task 16: ReplayPanel 美化

**Files:**
- Modify: `apps/extension/src/sidepanel/ReplayPanel.tsx:41-65` — 按钮和 slider

- [ ] **Step 1: ReplayPanel 使用统一配色和 lg-btn 类**

修改 ReplayPanel 的播放按钮和 slider：

```tsx
<div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
  <div style={{ fontWeight: 600 }}>Replay</div>
  <button
    className="lg-btn lg-btn-sm lg-btn-secondary"
    onClick={onTogglePlay}
    disabled={!replayData}
  >
    {replayPlaying ? '暂停' : '播放'}
  </button>
  <span>回放时长: {formatTime(replayData?.durationMs ?? 0)}</span>
</div>
<input
  type="range"
  min={0}
  max={replayData?.durationMs ?? 0}
  step={1000}
  value={Math.min(currentTimeMs, replayData?.durationMs ?? 0)}
  onChange={onScrub}
  style={{
    width: '100%',
    marginBottom: 6,
    accentColor: 'var(--lg-signal)',
    height: 4,
    cursor: replayData ? 'pointer' : 'not-allowed',
  }}
/>
```

- [ ] **Step 2: 验证构建**

Run: `pnpm typecheck`
Expected: 通过

- [ ] **Step 3: 提交**

```bash
git add apps/extension/src/sidepanel/ReplayPanel.tsx
git commit -m "feat(ui): ReplayPanel with unified slider style and lg-btn classes"
```

---

## 最终验证

### Task 17: 全量构建和测试验证

- [ ] **Step 1: 运行 typecheck**

Run: `pnpm typecheck`
Expected: 10/10 包通过

- [ ] **Step 2: 运行构建**

Run: `pnpm build`
Expected: 10/10 包成功

- [ ] **Step 3: 运行 UI 包测试**

Run: `pnpm --filter @listen-graphic/ui test:run`
Expected: 全部通过

- [ ] **Step 4: 运行 Extension 测试**

Run: `pnpm --filter extension test:run`
Expected: 全部通过（排除真实 API 测试）

- [ ] **Step 5: 启动 web-demo 视觉验证**

Run: `pnpm dev:web`

手动验证：
- 亮色模式：顶栏布局、状态卡片、空状态、视图切换器、波形元素
- 暗色模式：所有区域对比度和可读性
- 窄面板：状态卡片单列、按钮堆叠

- [ ] **Step 6: 最终提交（如有遗漏修复）**

```bash
git add -A
git commit -m "chore(ui): final visual fixes for Phase 3-7 migration"
```
