# 设置面板 UI 重构实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 重构 Chrome 扩展侧边栏的设置面板，从「内联挤占主内容」改为「全页覆盖模式」——打开设置后整个侧边栏被设置页面覆盖，左上角有返回按钮，左侧竖排 Tab 导航（语音识别 / 结构化 / 显示），右侧为对应配置内容。

**Architecture:** 当 `settingsOpen=true` 时，App.tsx **条件渲染**设置页面，**完全替代**主内容（顶栏、图谱、状态卡、日志面板均不挂载）。设置页面内部为左右布局：左侧 ~88px 竖排 Tab 导航，右侧为表单内容区。每个 Tab 内容使用可折叠分组实现渐进式披露。提取共享样式常量，统一控件外观。

**设计决策：**
- **条件渲染 vs z-index 覆盖**：采用条件渲染（方案 A），`settingsOpen ? <SettingsPage /> : <MainContent />`。主内容不挂载，避免 ReactFlow / auto-tour / 日志 tick 等持续消耗资源。
- **顶栏策略**：设置页面有自己的顶栏（← 返回 + 标题），完全替代原顶栏。会话进行中进入设置后无法直接停止——这是预期行为，用户需先返回主界面。
- **aria-label 策略**：用户可见标签全部中文化，但 `aria-label` 属性保持英文（如 `aria-label="ASR Provider Type"`），确保现有测试不因标签变化而失败。
- **dirty 追踪**：在 App 层统一追踪 `providerConfig` + `graphDisplaySettings` 两部分，覆盖所有 Tab。
- **保存反馈**：保存函数返回 `{ ok: boolean; error?: string }`，不依赖 try/catch。

**Tech Stack:** React、TypeScript、inline styles（渐进提取为 constants）、Vitest + Testing Library

---

## 布局示意

```
┌──────────────────────────────────────┐
│ ← 返回                      设置     │  顶栏（back button + 标题）
├─────────┬────────────────────────────┤
│         │                            │
│ 语音识别 │                            │
│ (选中)  │   ASR 配置表单              │
│─────────│                            │
│ 结构化  │   provider 类型 / 密钥 /    │
│         │   高级参数（可折叠）         │
│─────────│                            │
│ 显示    │                            │
│         │                            │
├─────────┴────────────────────────────┤
│ 有未保存的修改    [清除密钥] [保存设置] │  底部操作栏
└──────────────────────────────────────┘
```

---

## 文件结构

| 操作 | 文件路径 | 职责 |
|------|----------|------|
| 创建 | `apps/extension/src/sidepanel/settings/theme.ts` | 共享样式常量 |
| 创建 | `apps/extension/src/sidepanel/settings/FormControls.tsx` | 统一表单控件 |
| 创建 | `apps/extension/src/sidepanel/settings/CollapsibleSection.tsx` | 可折叠分组 |
| 创建 | `apps/extension/src/sidepanel/settings/SecretField.tsx` | 密钥字段复合组件 |
| 创建 | `apps/extension/src/sidepanel/settings/Toast.tsx` | Toast 通知 |
| 创建 | `apps/extension/src/sidepanel/settings/AsrSettings.tsx` | ASR Tab 内容 |
| 创建 | `apps/extension/src/sidepanel/settings/StructurerSettings.tsx` | Structurer Tab 内容 |
| 创建 | `apps/extension/src/sidepanel/settings/DisplaySettings.tsx` | 显示 Tab 内容 |
| 创建 | `apps/extension/src/sidepanel/settings/SettingsOverlay.tsx` | **全页覆盖层**：顶栏 + 左侧竖排 Tab + 右侧内容 + 底部操作栏 |
| 重写 | `apps/extension/src/sidepanel/SettingsPanel.tsx` | 薄壳引入 SettingsOverlay |
| 修改 | `apps/extension/src/sidepanel/App.tsx` | `settingsOpen` 时渲染覆盖层替代主内容 |
| 修改 | `apps/extension/src/sidepanel/hooks/useProviderSettings.ts` | 暴露 initialConfigRef，save 返回 SaveResult |
| 修改 | `apps/extension/src/sidepanel/hooks/useGraphDisplaySettings.ts` | 暴露 initialDisplayRef，save 返回 SaveResult |
| 更新 | `apps/extension/src/sidepanel/App.settings.test.tsx` | 测试适配新结构 |

---

## Phase 1：基础组件（不影响现有代码）

### Task 1: 添加共享样式常量

**Files:**
- Create: `apps/extension/src/sidepanel/settings/theme.ts`

- [ ] **Step 1: 创建 theme.ts**

```ts
// apps/extension/src/sidepanel/settings/theme.ts

export const colors = {
  bg: '#f8fafc',
  cardBg: 'white',
  border: '#e5e7eb',
  borderLight: '#dbe4ee',
  borderFocus: '#3b82f6',
  borderError: '#ef4444',
  text: '#1e293b',
  textSecondary: '#64748b',
  textHint: '#94a3b8',
  primary: '#3b82f6',
  primaryHover: '#2563eb',
  primaryBg: '#eff6ff',
  danger: '#ef4444',
  dangerBg: '#fef2f2',
  dangerBorder: '#fecaca',
  success: '#059669',
  successBg: '#ecfdf5',
  info: '#0369a1',
  infoBg: '#f0f9ff',
  tabActiveBg: '#eff6ff',
  tabInactiveBg: '#f1f5f9',
} as const;

export const spacing = {
  xs: 4,
  sm: 6,
  md: 8,
  lg: 12,
  xl: 16,
} as const;

export const radius = {
  sm: 4,
  md: 6,
  lg: 8,
} as const;

export const fontSize = {
  xs: 10,
  sm: 11,
  md: 12,
  lg: 13,
  xl: 14,
} as const;

export const SIDEBAR_TAB_WIDTH = 88;

export const inputStyle = {
  width: '100%' as const,
  padding: '6px 8px',
  fontSize: 11,
  border: '1px solid #dbe4ee',
  borderRadius: 4,
  outline: 'none',
  boxSizing: 'border-box' as const,
};

export const labelStyle = {
  display: 'grid' as const,
  gap: 4,
};

export const buttonBase = {
  padding: '6px 12px',
  borderRadius: 4,
  fontSize: 11,
  cursor: 'pointer' as const,
  fontWeight: 600 as const,
  border: 'none',
  outline: 'none',
};
```

- [ ] **Step 2: 验证类型**

Run: `pnpm typecheck`
Expected: PASS（新文件未被引用）

- [ ] **Step 3: Commit**

```bash
git add apps/extension/src/sidepanel/settings/theme.ts
git commit -m "feat(ext): add shared style constants for settings UI"
```

---

### Task 2: 创建统一表单控件

**Files:**
- Create: `apps/extension/src/sidepanel/settings/FormControls.tsx`

- [ ] **Step 1: 创建 FormControls.tsx**

```tsx
// apps/extension/src/sidepanel/settings/FormControls.tsx

import type { CSSProperties, InputHTMLAttributes, SelectHTMLAttributes } from 'react';
import { colors, inputStyle, labelStyle, buttonBase } from './theme';

type FieldLabelProps = {
  children: React.ReactNode;
  hint?: string;
};

export function FieldLabel({ children, hint }: FieldLabelProps) {
  return (
    <label style={labelStyle}>
      <span style={{ fontSize: 11, color: colors.text }}>{children}</span>
      {hint && (
        <span style={{ fontSize: 10, color: colors.textHint }}>{hint}</span>
      )}
    </label>
  );
}

type FieldInputProps = InputHTMLAttributes<HTMLInputElement> & {
  error?: boolean;
};

export function FieldInput({ error, style, ...rest }: FieldInputProps) {
  return (
    <input
      {...rest}
      style={{
        ...inputStyle,
        ...(error ? { borderColor: colors.borderError } : {}),
        ...style,
      }}
    />
  );
}

type FieldSelectProps = SelectHTMLAttributes<HTMLSelectElement>;

export function FieldSelect({ style, ...rest }: FieldSelectProps) {
  return (
    <select
      {...rest}
      style={{ ...inputStyle, ...style }}
    />
  );
}

type ButtonVariant = 'primary' | 'danger' | 'ghost';

type ActionButtonProps = {
  children: React.ReactNode;
  variant?: ButtonVariant;
  disabled?: boolean;
  onClick: () => void;
};

const variantStyles: Record<ButtonVariant, CSSProperties> = {
  primary: { ...buttonBase, backgroundColor: colors.primary, color: 'white' },
  danger: { ...buttonBase, backgroundColor: 'transparent', color: colors.danger, border: '1px solid #fecaca' },
  ghost: { ...buttonBase, backgroundColor: 'transparent', color: colors.textSecondary, border: '1px solid #dbe4ee' },
};

export function ActionButton({ children, variant = 'primary', disabled, onClick }: ActionButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        ...variantStyles[variant],
        opacity: disabled ? 0.5 : 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    >
      {children}
    </button>
  );
}
```

- [ ] **Step 2: typecheck**

- [ ] **Step 3: Commit**

```bash
git add apps/extension/src/sidepanel/settings/FormControls.tsx
git commit -m "feat(ext): add shared form control components"
```

---

### Task 3: 创建可折叠分组组件

**Files:**
- Create: `apps/extension/src/sidepanel/settings/CollapsibleSection.tsx`

- [ ] **Step 1: 创建 CollapsibleSection.tsx**

```tsx
// apps/extension/src/sidepanel/settings/CollapsibleSection.tsx

import { useState } from 'react';
import { colors } from './theme';

type CollapsibleSectionProps = {
  title: string;
  defaultOpen?: boolean;
  badge?: string;
  children: React.ReactNode;
};

export function CollapsibleSection({
  title,
  defaultOpen = true,
  badge,
  children,
}: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div style={{ display: 'grid', gap: open ? 6 : 0 }}>
      <button
        onClick={() => setOpen((prev) => !prev)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: '4px 0',
          fontSize: 12,
          fontWeight: 600,
          color: colors.text,
          width: '100%',
          textAlign: 'left',
        }}
      >
        <span style={{
          display: 'inline-block',
          transition: 'transform 0.15s',
          transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
          fontSize: 10,
          color: colors.textSecondary,
        }}>▶</span>
        <span>{title}</span>
        {badge && (
          <span style={{ fontSize: 10, color: colors.textHint, fontWeight: 400 }}>
            {badge}
          </span>
        )}
      </button>
      {open && (
        <div style={{ display: 'grid', gap: 8, paddingLeft: 8 }}>
          {children}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: typecheck**

- [ ] **Step 3: Commit**

```bash
git add apps/extension/src/sidepanel/settings/CollapsibleSection.tsx
git commit -m "feat(ext): add collapsible section component"
```

---

### Task 4: 创建密钥字段复合组件

**Files:**
- Create: `apps/extension/src/sidepanel/settings/SecretField.tsx`

- [ ] **Step 1: 创建 SecretField.tsx**

```tsx
// apps/extension/src/sidepanel/settings/SecretField.tsx

import { FieldLabel, FieldInput } from './FormControls';
import { colors } from './theme';

type SecretFieldProps = {
  label: string;
  ariaLabel: string;
  value: string;
  placeholder?: string;
  configured: boolean;
  onChange: (value: string) => void;
};

export function SecretField({
  label,
  ariaLabel,
  value,
  placeholder,
  configured,
  onChange,
}: SecretFieldProps) {
  return (
    <FieldLabel hint={configured ? `已保存${label}，留空则保持不变` : undefined}>
      {label}
      <FieldInput
        aria-label={ariaLabel}
        type="password"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? (configured ? '已保存，留空保持不变' : `请输入${label}`)}
      />
      {!configured && (
        <div style={{ fontSize: 10, color: colors.textHint }}>未保存 {label}</div>
      )}
    </FieldLabel>
  );
}
```

- [ ] **Step 2: typecheck**

- [ ] **Step 3: Commit**

```bash
git add apps/extension/src/sidepanel/settings/SecretField.tsx
git commit -m "feat(ext): add secret field composite component"
```

---

### Task 5: 创建 Toast 通知组件

**Files:**
- Create: `apps/extension/src/sidepanel/settings/Toast.tsx`

- [ ] **Step 1: 创建 Toast.tsx**

```tsx
// apps/extension/src/sidepanel/settings/Toast.tsx

import { useEffect, useState } from 'react';
import { colors } from './theme';

type ToastType = 'success' | 'error' | 'info';

type ToastProps = {
  message: string;
  type?: ToastType;
  visible: boolean;
  durationMs?: number;
  onDismiss: () => void;
};

const typeStyles: Record<ToastType, { bg: string; color: string }> = {
  success: { bg: colors.successBg, color: colors.success },
  error: { bg: colors.dangerBg, color: colors.danger },
  info: { bg: colors.infoBg, color: colors.info },
};

export function Toast({ message, type = 'info', visible, durationMs = 3000, onDismiss }: ToastProps) {
  const [show, setShow] = useState(visible);

  useEffect(() => {
    setShow(visible);
    if (visible) {
      const timer = setTimeout(() => { setShow(false); onDismiss(); }, durationMs);
      return () => clearTimeout(timer);
    }
  }, [visible, durationMs, onDismiss]);

  if (!show) return null;

  const style = typeStyles[type];
  return (
    <div role="alert" style={{
      padding: '8px 12px',
      backgroundColor: style.bg,
      color: style.color,
      fontSize: 11,
      fontWeight: 500,
      borderRadius: 4,
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
    }}>
      <span>{message}</span>
      <button onClick={() => { setShow(false); onDismiss(); }} style={{
        background: 'none', border: 'none', color: style.color, cursor: 'pointer', fontSize: 12, padding: 4,
      }}>✕</button>
    </div>
  );
}
```

- [ ] **Step 2: typecheck**

- [ ] **Step 3: Commit**

```bash
git add apps/extension/src/sidepanel/settings/Toast.tsx
git commit -m "feat(ext): add toast notification component"
```

---

## Phase 2：Tab 页面组件

### Task 6: 创建 ASR 设置 Tab

**Files:**
- Create: `apps/extension/src/sidepanel/settings/AsrSettings.tsx`

关键设计：单列表单、腾讯云高级参数默认折叠、所有标签中文化。

- [ ] **Step 1: 创建 AsrSettings.tsx**

注意：`credentialState` 由父组件（SettingsOverlay）预计算后传入，不再自行调用 `getStageCredentialState`。`summary` prop 移除——子组件只关心凭证状态，不关心完整 summary。

```tsx
// apps/extension/src/sidepanel/settings/AsrSettings.tsx

import type { ProviderConfig } from '@listen-graphic/schema';
import { FieldLabel, FieldInput, FieldSelect } from './FormControls';
import { SecretField } from './SecretField';
import { CollapsibleSection } from './CollapsibleSection';
import { getProviderTypeSelectValue } from '../provider-helpers';
import { colors } from './theme';

type CredentialState = {
  apiKeyConfigured: boolean;
  secretConfigured: boolean;
  bridgeAuthTokenConfigured: boolean;
};

type AsrSettingsProps = {
  config: ProviderConfig['asr'];
  credentialState: CredentialState;
  bridgeHealth: { status: string; detail?: string };
  onUpdateField: (field: keyof ProviderConfig['asr'], value: string) => void;
  onTypeChange: (nextType: string) => void;
};

const asrTypeOptions = [
  { value: 'mock', label: 'Mock（测试）' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'tencent', label: '腾讯云' },
  { value: 'external', label: '本地 ASR Bridge' },
];

export function AsrSettings({ config, credentialState, bridgeHealth, onUpdateField, onTypeChange }: AsrSettingsProps) {
  const isTencent = config.type === 'tencent';
  const isExternal = config.type === 'external';

  return (
    <div style={{ display: 'grid', gap: 12, padding: '12px 0' }}>
      <FieldLabel>
        语音识别服务
        <FieldSelect
          aria-label="ASR Provider Type"
          value={getProviderTypeSelectValue('asr', config)}
          onChange={(e) => onTypeChange(e.target.value)}
        >
          {asrTypeOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </FieldSelect>
      </FieldLabel>

      {isTencent && (
        <div style={{
          padding: 8, backgroundColor: colors.infoBg, borderRadius: 4,
          fontSize: 10, color: colors.info, lineHeight: 1.5,
        }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>腾讯云实时 ASR</div>
          <div>免费额度：10小时/月 | 价格：0.7-1.5元/小时</div>
          <div>推荐区域：华东地区(上海)</div>
          <div style={{ marginTop: 4, opacity: 0.8 }}>
            获取密钥：console.cloud.tencent.com/cam/capi
          </div>
        </div>
      )}

      {isExternal && (
        <div style={{
          padding: 8, backgroundColor: '#ecfeff', borderRadius: 4,
          fontSize: 10, color: '#155e75', lineHeight: 1.5,
        }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>本地 ASR Bridge</div>
          <div>通过 WebSocket 接入本地 ASR 引擎</div>
          <div>推荐地址：ws://127.0.0.1:15377/ws</div>
        </div>
      )}

      {(isTencent || isExternal) && (
        <FieldLabel>
          传输方式
          <FieldSelect
            aria-label={isTencent ? 'Tencent Transport' : 'Local Bridge Transport'}
            value={config.transport ?? 'ws'}
            onChange={(e) => onUpdateField('transport', e.target.value)}
          >
            {isTencent && <option value="batch">批量（Batch）</option>}
            <option value="ws">实时 WebSocket</option>
          </FieldSelect>
        </FieldLabel>
      )}

      {!isTencent && (
        <FieldLabel>
          服务地址
          <FieldInput
            aria-label="ASR Endpoint"
            value={config.endpoint ?? ''}
            onChange={(e) => onUpdateField('endpoint', e.target.value)}
            placeholder={isExternal ? 'ws://127.0.0.1:15377/ws' : 'https://api.openai.com/v1/audio/transcriptions'}
          />
        </FieldLabel>
      )}

      <FieldLabel>
        {isTencent ? '引擎模型' : '模型名称'}
        <FieldInput
          aria-label={isTencent ? 'Tencent Engine Model' : 'ASR Model'}
          value={config.model ?? ''}
          onChange={(e) => onUpdateField('model', e.target.value)}
          placeholder={isTencent ? '16k_zh' : 'whisper-1'}
        />
      </FieldLabel>

      {isTencent && (
        <CollapsibleSection title="腾讯云凭证" defaultOpen={true}>
          <FieldLabel>
            应用 ID（App ID）
            <FieldInput
              aria-label="Tencent App ID"
              value={config.appId ?? ''}
              onChange={(e) => onUpdateField('appId', e.target.value)}
              placeholder="例如 1250000000"
            />
          </FieldLabel>
          <SecretField label="Secret ID" ariaLabel="Tencent Secret ID"
            value={config.secretId ?? ''} configured={credentialState.secretConfigured}
            onChange={(v) => onUpdateField('secretId', v)} />
          <SecretField label="Secret Key" ariaLabel="Tencent Secret Key"
            value={config.secretKey ?? ''} configured={credentialState.secretConfigured}
            onChange={(v) => onUpdateField('secretKey', v)} />
          <FieldLabel>
            区域
            <FieldSelect aria-label="Tencent Region"
              value={config.region ?? 'ap-shanghai'}
              onChange={(e) => onUpdateField('region', e.target.value)}
            >
              <option value="ap-shanghai">华东（上海）- 推荐</option>
              <option value="ap-guangzhou">华南（广州）</option>
              <option value="ap-beijing">华北（北京）</option>
              <option value="ap-chengdu">西南（成都）</option>
            </FieldSelect>
          </FieldLabel>
        </CollapsibleSection>
      )}

      {isTencent && config.transport === 'ws' && (
        <CollapsibleSection title="高级参数（VAD / 热词）" defaultOpen={false} badge="可选">
          <FieldLabel>
            VAD 语音检测
            <FieldSelect aria-label="Tencent Need VAD"
              value={String(config.needVad ?? true)}
              onChange={(e) => onUpdateField('needVad', e.target.value)}
            >
              <option value="true">开启</option>
              <option value="false">关闭</option>
            </FieldSelect>
          </FieldLabel>
          <FieldLabel hint="VAD 检测到静音后的等待时长">
            VAD 静音时长（毫秒）
            <FieldInput aria-label="Tencent VAD Silence Time" type="number"
              value={config.vadSilenceTimeMs ?? ''}
              onChange={(e) => onUpdateField('vadSilenceTimeMs', e.target.value)}
              placeholder="1000" />
          </FieldLabel>
          <FieldLabel hint="单次说话最大时长，超时自动切分">
            最大说话时长（毫秒）
            <FieldInput aria-label="Tencent Max Speak Time" type="number"
              value={config.maxSpeakTimeMs ?? ''}
              onChange={(e) => onUpdateField('maxSpeakTimeMs', e.target.value)}
              placeholder="60000" />
          </FieldLabel>
          <FieldLabel>
            热词 ID
            <FieldInput aria-label="Tencent Hotword ID"
              value={config.hotwordId ?? ''}
              onChange={(e) => onUpdateField('hotwordId', e.target.value)} />
          </FieldLabel>
          <FieldLabel hint="格式：词语|权重，例如「腾讯云|10,语音识别|5」">
            热词列表
            <FieldInput aria-label="Tencent Hotword List"
              value={config.hotwordList ?? ''}
              onChange={(e) => onUpdateField('hotwordList', e.target.value)}
              placeholder="腾讯云|10,语音识别|5" />
          </FieldLabel>
          <FieldLabel>
            词级信息
            <FieldInput aria-label="Tencent Word Info" type="number"
              value={config.wordInfo ?? ''}
              onChange={(e) => onUpdateField('wordInfo', e.target.value)}
              placeholder="0" />
          </FieldLabel>
        </CollapsibleSection>
      )}

      {isExternal && (
        <CollapsibleSection title="Bridge 配置" defaultOpen={true}>
          <FieldLabel>
            协议版本
            <FieldInput aria-label="Local Bridge Protocol"
              value={config.bridgeProtocol ?? ''}
              onChange={(e) => onUpdateField('bridgeProtocol', e.target.value)}
              placeholder="lg-asr-ws-v1" />
          </FieldLabel>
          <SecretField label="认证令牌" ariaLabel="Local Bridge Auth Token"
            value={config.bridgeAuthToken ?? ''} configured={credentialState.bridgeAuthTokenConfigured}
            onChange={(v) => onUpdateField('bridgeAuthToken', v)} placeholder="可选" />
          <div data-testid="local-bridge-health" style={{
            padding: 8,
            backgroundColor: bridgeHealth.status === 'error' ? colors.dangerBg
              : bridgeHealth.status === 'listening' ? colors.successBg : colors.bg,
            border: '1px solid #dbe4ee', borderRadius: 4, fontSize: 10, color: '#334155',
          }}>
            <div style={{ fontWeight: 600 }}>Bridge 状态：{bridgeHealth.status}</div>
            <div style={{ marginTop: 4 }}>{bridgeHealth.detail ?? '保存设置后开始会话，可查看连接状态'}</div>
          </div>
        </CollapsibleSection>
      )}

      {!isTencent && !isExternal && (
        <SecretField label="API 密钥" ariaLabel="ASR API Key"
          value={config.apiKey ?? ''} configured={credentialState.apiKeyConfigured}
          onChange={(v) => onUpdateField('apiKey', v)} />
      )}

      <FieldLabel>
        语言
        <FieldInput aria-label="ASR Language"
          value={config.language ?? ''}
          onChange={(e) => onUpdateField('language', e.target.value)} />
      </FieldLabel>
    </div>
  );
}
```

- [ ] **Step 2: typecheck**

- [ ] **Step 3: Commit**

```bash
git add apps/extension/src/sidepanel/settings/AsrSettings.tsx
git commit -m "feat(ext): add ASR settings tab with collapsible sections"
```

---

### Task 7: 创建 Structurer 设置 Tab

**Files:**
- Create: `apps/extension/src/sidepanel/settings/StructurerSettings.tsx`

- [ ] **Step 1: 创建 StructurerSettings.tsx**

同 AsrSettings，接收预计算的 `credentialState`，不自行调用 `getStageCredentialState`。

```tsx
// apps/extension/src/sidepanel/settings/StructurerSettings.tsx

import type { ProviderConfig } from '@listen-graphic/schema';
import { FieldLabel, FieldInput, FieldSelect } from './FormControls';
import { SecretField } from './SecretField';
import { getProviderTypeSelectValue } from '../provider-helpers';

type CredentialState = {
  apiKeyConfigured: boolean;
};

type StructurerSettingsProps = {
  config: ProviderConfig['structurer'];
  credentialState: CredentialState;
  onUpdateField: (field: keyof ProviderConfig['structurer'], value: string) => void;
  onTypeChange: (nextType: string) => void;
};

const structurerTypeOptions = [
  { value: 'mock', label: 'Mock（测试）' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'aliyun', label: '阿里云百炼' },
  { value: 'baidu', label: '百度千帆' },
  { value: 'zhipu', label: '智谱 GLM' },
  { value: 'zhipu-coding-plan', label: '智谱 GLM（Coding Plan）' },
];

export function StructurerSettings({ config, credentialState, onUpdateField, onTypeChange }: StructurerSettingsProps) {

  return (
    <div style={{ display: 'grid', gap: 12, padding: '12px 0' }}>
      <FieldLabel>
        结构化服务
        <FieldSelect
          aria-label="Structurer Provider Type"
          value={getProviderTypeSelectValue('structurer', config)}
          onChange={(e) => onTypeChange(e.target.value)}
        >
          {structurerTypeOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </FieldSelect>
      </FieldLabel>

      <FieldLabel>
        服务地址
        <FieldInput
          aria-label="Structurer Endpoint"
          value={config.endpoint ?? ''}
          onChange={(e) => onUpdateField('endpoint', e.target.value)}
          placeholder="https://api.openai.com/v1/chat/completions"
        />
      </FieldLabel>

      <FieldLabel>
        模型名称
        <FieldInput
          aria-label="Structurer Model"
          value={config.model ?? ''}
          onChange={(e) => onUpdateField('model', e.target.value)}
        />
      </FieldLabel>

      <SecretField label="API 密钥" ariaLabel="Structurer API Key"
        value={config.apiKey ?? ''} configured={credentialState.apiKeyConfigured}
        onChange={(v) => onUpdateField('apiKey', v)} />

      <FieldLabel>
        语言
        <FieldInput
          aria-label="Structurer Language"
          value={config.language ?? ''}
          onChange={(e) => onUpdateField('language', e.target.value)}
        />
      </FieldLabel>
    </div>
  );
}
```

- [ ] **Step 2: typecheck**

- [ ] **Step 3: Commit**

```bash
git add apps/extension/src/sidepanel/settings/StructurerSettings.tsx
git commit -m "feat(ext): add Structurer settings tab component"
```

---

### Task 8: 创建显示设置 Tab

**Files:**
- Create: `apps/extension/src/sidepanel/settings/DisplaySettings.tsx`

- [ ] **Step 1: 创建 DisplaySettings.tsx**

```tsx
// apps/extension/src/sidepanel/settings/DisplaySettings.tsx

import type { GraphDisplaySettings } from '../../shared/messages';
import { FieldLabel, FieldSelect } from './FormControls';
import { colors } from './theme';

type DisplaySettingsProps = {
  settings: GraphDisplaySettings;
  onUpdateAutoFitMinReadableFontPx: (value: string) => void;
};

export function DisplaySettings({ settings, onUpdateAutoFitMinReadableFontPx }: DisplaySettingsProps) {
  return (
    <div style={{ display: 'grid', gap: 12, padding: '12px 0' }}>
      <FieldLabel hint="仅影响自动适配视图；手动缩放不受此限制">
        自动适配最小字号
        <FieldSelect
          aria-label="自动适配最小字号"
          value={String(settings.autoFitMinReadableFontPx)}
          onChange={(e) => onUpdateAutoFitMinReadableFontPx(e.target.value)}
        >
          <option value="10">10px</option>
          <option value="12">12px</option>
          <option value="14">14px</option>
          <option value="16">16px</option>
        </FieldSelect>
      </FieldLabel>
      <div style={{ color: colors.textSecondary, fontSize: 10, lineHeight: 1.5 }}>
        鼠标滚轮和触控板缩放不受此设置限制。
      </div>
    </div>
  );
}
```

- [ ] **Step 2: typecheck**

- [ ] **Step 3: Commit**

```bash
git add apps/extension/src/sidepanel/settings/DisplaySettings.tsx
git commit -m "feat(ext): add display settings tab component"
```

---

## Phase 3：全页覆盖层（核心变更）

### Task 9: 创建全页覆盖层组件

**Files:**
- Create: `apps/extension/src/sidepanel/settings/SettingsOverlay.tsx`

这是核心组装层。App.tsx 条件渲染此组件（`settingsOpen ? <SettingsOverlay /> : <MainContent />`），**不是** z-index 覆盖。

布局：
- 顶栏：← 返回按钮 + 「设置」标题
- 主体：左侧 88px 竖排 Tab + 右侧可滚动内容
- 底栏：dirty 提示 + 清除密钥/保存按钮
- Toast：固定在顶栏下方

关键设计决策：
- 返回按钮有 dirty guard：未保存修改时弹 confirm
- 保存结果通过返回值判断，不依赖 try/catch（避免假阳性）
- AsrSettings / StructurerSettings 接收预计算的 credentialStates，不自行调用 getStageCredentialState

- [ ] **Step 1: 创建 SettingsOverlay.tsx**

```tsx
// apps/extension/src/sidepanel/settings/SettingsOverlay.tsx

import { useState, useCallback } from 'react';
import type { ProviderConfig, ProviderRuntimeSummary } from '@listen-graphic/schema';
import type { GraphDisplaySettings } from '../../shared/messages';
import type { BridgeHealth } from '../panel-reducer';
import { AsrSettings } from './AsrSettings';
import { StructurerSettings } from './StructurerSettings';
import { DisplaySettings } from './DisplaySettings';
import { ActionButton } from './FormControls';
import { Toast } from './Toast';
import { colors, SIDEBAR_TAB_WIDTH } from './theme';
import { getStageCredentialState } from '../provider-helpers';

type TabKey = 'asr' | 'structurer' | 'display';

type SaveResult = { ok: true } | { ok: false; error: string };

type SettingsOverlayProps = {
  providerConfig: ProviderConfig;
  providerSummary: ProviderRuntimeSummary;
  settingsSaving: boolean;
  bridgeHealth: BridgeHealth;
  graphDisplaySettings: GraphDisplaySettings;
  isDirty: boolean;
  onUpdateProviderEntry: (
    stage: keyof ProviderConfig,
    field: keyof ProviderConfig['asr'],
    value: string,
  ) => void;
  onProviderTypeChange: (stage: keyof ProviderConfig, nextType: string) => void;
  onUpdateAutoFitMinReadableFontPx: (value: string) => void;
  onSaveSettings: () => Promise<SaveResult>;
  onClearSecrets: () => void;
  onClose: () => void;
};

const tabs: { key: TabKey; label: string }[] = [
  { key: 'asr', label: '语音识别' },
  { key: 'structurer', label: '结构化' },
  { key: 'display', label: '显示' },
];

export function SettingsOverlay({
  providerConfig,
  providerSummary,
  settingsSaving,
  bridgeHealth,
  graphDisplaySettings,
  isDirty,
  onUpdateProviderEntry,
  onProviderTypeChange,
  onUpdateAutoFitMinReadableFontPx,
  onSaveSettings,
  onClearSecrets,
  onClose,
}: SettingsOverlayProps) {
  const [activeTab, setActiveTab] = useState<TabKey>('asr');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);

  // 预计算 credential states，避免子组件 hack getStageCredentialState
  const asrCredentialState = getStageCredentialState(providerSummary, 'asr');
  const structurerCredentialState = getStageCredentialState(providerSummary, 'structurer');

  const handleSave = useCallback(async () => {
    const result = await onSaveSettings();
    if (result.ok) {
      setToast({ message: '设置已保存', type: 'success' });
    } else {
      setToast({ message: result.error, type: 'error' });
    }
  }, [onSaveSettings]);

  const handleClear = useCallback(() => {
    if (!window.confirm('确定要清除所有已保存的密钥吗？此操作不可撤销。')) return;
    onClearSecrets();
    setToast({ message: '密钥已清除', type: 'info' });
  }, [onClearSecrets]);

  const handleClose = useCallback(() => {
    if (isDirty && !window.confirm('有未保存的修改，确定离开？')) return;
    onClose();
  }, [isDirty, onClose]);

  return (
    <div
      data-testid="settings-panel"
      style={{
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: colors.bg,
      }}
    >
      {/* 顶栏：返回按钮 + 标题 */}
      <div style={{
        padding: '8px 12px',
        borderBottom: `1px solid ${colors.border}`,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        flexShrink: 0,
        backgroundColor: colors.cardBg,
      }}>
        <button
          onClick={handleClose}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            padding: '4px 8px',
            borderRadius: 4,
            border: `1px solid ${colors.border}`,
            backgroundColor: 'transparent',
            color: colors.text,
            fontSize: 11,
            cursor: 'pointer',
            fontWeight: 500,
          }}
        >
          ← 返回
        </button>
        <span style={{ fontWeight: 600, fontSize: 13 }}>设置</span>
      </div>

      {/* Toast 区域（顶栏下方，内容区上方） */}
      {toast && (
        <Toast message={toast.message} type={toast.type} visible={true} onDismiss={() => setToast(null)} />
      )}

      {/* 主体：左侧竖排 Tab + 右侧内容 */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {/* 左侧竖排 Tab */}
        <div style={{
          width: SIDEBAR_TAB_WIDTH,
          flexShrink: 0,
          borderRight: `1px solid ${colors.border}`,
          backgroundColor: colors.tabInactiveBg,
          display: 'flex',
          flexDirection: 'column',
        }}>
          {tabs.map((tab) => {
            const isActive = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                style={{
                  padding: '12px 8px',
                  fontSize: 11,
                  fontWeight: isActive ? 600 : 400,
                  color: isActive ? colors.primary : colors.textSecondary,
                  backgroundColor: isActive ? colors.tabActiveBg : 'transparent',
                  border: 'none',
                  borderLeft: isActive ? `3px solid ${colors.primary}` : '3px solid transparent',
                  cursor: 'pointer',
                  textAlign: 'left',
                  lineHeight: 1.3,
                }}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* 右侧内容区（可滚动） */}
        <div style={{
          flex: 1,
          overflowY: 'auto',
          padding: '0 12px',
          minWidth: 0,
        }}>
          {activeTab === 'asr' && (
            <AsrSettings
              config={providerConfig.asr}
              credentialState={asrCredentialState}
              bridgeHealth={bridgeHealth}
              onUpdateField={(field, value) => onUpdateProviderEntry('asr', field, value)}
              onTypeChange={(nextType) => onProviderTypeChange('asr', nextType)}
            />
          )}
          {activeTab === 'structurer' && (
            <StructurerSettings
              config={providerConfig.structurer}
              credentialState={structurerCredentialState}
              onUpdateField={(field, value) => onUpdateProviderEntry('structurer', field, value)}
              onTypeChange={(nextType) => onProviderTypeChange('structurer', nextType)}
            />
          )}
          {activeTab === 'display' && (
            <DisplaySettings
              settings={graphDisplaySettings}
              onUpdateAutoFitMinReadableFontPx={onUpdateAutoFitMinReadableFontPx}
            />
          )}
        </div>
      </div>

      {/* 底部操作栏 */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '8px 12px',
        borderTop: `1px solid ${colors.border}`,
        flexShrink: 0,
        backgroundColor: colors.cardBg,
      }}>
        {isDirty ? (
          <span style={{ fontSize: 10, color: colors.primary }}>有未保存的修改</span>
        ) : (
          <span style={{ fontSize: 10, color: colors.textHint }}>
            ASR: {providerSummary.asr.type} | 结构化: {providerSummary.structurer.type}
          </span>
        )}
        <div style={{ display: 'flex', gap: 6 }}>
          <ActionButton variant="danger" onClick={handleClear}>清除密钥</ActionButton>
          <ActionButton variant="primary" onClick={handleSave} disabled={settingsSaving}>
            {settingsSaving ? '保存中...' : '保存设置'}
          </ActionButton>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: typecheck**

- [ ] **Step 3: Commit**

```bash
git add apps/extension/src/sidepanel/settings/SettingsOverlay.tsx
git commit -m "feat(ext): add full-page settings overlay with vertical tab navigation"
```

---

## Phase 4：集成到 App.tsx（核心变更）

### Task 10: 添加统一 dirty 追踪（覆盖 provider + graphDisplay）

**Files:**
- Modify: `apps/extension/src/sidepanel/hooks/useProviderSettings.ts`
- Modify: `apps/extension/src/sidepanel/hooks/useGraphDisplaySettings.ts`
- Modify: `apps/extension/src/sidepanel/App.tsx`

dirty 追踪必须覆盖**两部分**：`providerConfig`（ASR + Structurer）和 `graphDisplaySettings`（显示 Tab）。方案：在 App 层统一计算 dirty，而非在单个 hook 内。

- [ ] **Step 1: useProviderSettings 添加快照 ref**

在文件顶部 import 中添加 `useRef`（如果还没有）。

在 `useProviderSettings` 函数体内添加：

```ts
const initialConfigRef = useRef<ProviderConfig | null>(null);
```

在 `handleToggleSettings` 的成功分支（`setProviderConfig(...)` 之后）保存快照：

```ts
initialConfigRef.current = pinProviderConfigToDirectMode(normalizeProviderConfig(response.config));
```

在 `handleSaveSettings` 成功后更新快照：

```ts
initialConfigRef.current = normalized;
```

在 return 对象中添加 `initialConfigRef`（供 App 层读取）。

- [ ] **Step 2: useGraphDisplaySettings 添加快照 ref**

在 `useGraphDisplaySettings.ts` 中同理：

```ts
const initialDisplayRef = useRef<GraphDisplaySettings | null>(null);
```

在加载设置成功后保存快照；在保存成功后更新快照。在 return 中导出 `initialDisplayRef`。

- [ ] **Step 3: App.tsx 中统一计算 isDirty**

```ts
const isDirty = useMemo(() => {
  // provider dirty
  const providerDirty = (() => {
    if (!providerInitialConfigRef.current) return false;
    const current = JSON.stringify(normalizeProviderConfig(providerConfig));
    const initial = JSON.stringify(normalizeProviderConfig(providerInitialConfigRef.current));
    return current !== initial;
  })();
  // display dirty
  const displayDirty = (() => {
    if (!displayInitialRef.current) return false;
    return JSON.stringify(graphDisplaySettings) !== JSON.stringify(displayInitialRef.current);
  })();
  return providerDirty || displayDirty;
}, [providerConfig, graphDisplaySettings]);
```

从各 hook 的 return 中解构对应的 ref，传入 `useMemo`。

- [ ] **Step 4: 修改两个 hook 的 save 函数返回 SaveResult**

当前 `handleSaveSettings` 和 `saveGraphDisplaySettings` 失败时只 `addLog + return`，不 throw。必须改为返回 `SaveResult`，否则 `handleSaveAllSettings` 永远 `{ ok: true }`。

**useProviderSettings.ts — handleSaveSettings 改为返回 SaveResult：**

```ts
type SaveResult = { ok: true } | { ok: false; error: string };

const handleSaveSettings = useCallback(async (): Promise<SaveResult> => {
  setSettingsSaving(true);
  try {
    const normalized = pinProviderConfigToDirectMode(normalizeProviderConfig(providerConfig));
    const response = await chrome.runtime.sendMessage({
      type: 'SAVE_PROVIDER_SETTINGS',
      target: 'service-worker',
      payload: { config: normalized },
    } as AppMessage);

    if (!response?.success) {
      const error = response?.error || '保存失败';
      addLog(`保存设置失败: ${error}`);
      if (normalized.asr.type === 'external') {
        setLocalBridgeHealth({ status: 'error', detail: error });
      }
      return { ok: false, error };
    }

    setProviderConfig(normalized);
    setProviderSummary(redactProviderConfig(normalized));
    initialConfigRef.current = normalized; // 保存成功后更新快照，清除 dirty
    addLog('provider 设置已保存');
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : '保存 provider 设置失败';
    addLog(`保存设置失败: ${message}`);
    return { ok: false, error: message };
  } finally {
    setSettingsSaving(false);
  }
}, [addLog, providerConfig]);
```

**useGraphDisplaySettings.ts — saveGraphDisplaySettings 同理返回 SaveResult：**

同样模式：成功时更新 `initialDisplayRef.current`（清除 dirty），失败时返回 `{ ok: false, error }`。

- [ ] **Step 5: handleSaveAllSettings 检查两部分结果**

```ts
const handleSaveAllSettings = useCallback(async (): Promise<SaveResult> => {
  const providerResult = await handleSaveSettings();
  if (!providerResult.ok) return providerResult;

  const displayResult = await saveGraphDisplaySettings();
  if (!displayResult.ok) return displayResult;

  return { ok: true };
}, [handleSaveSettings, saveGraphDisplaySettings]);
```

关键：任一失败立即返回，不继续保存。成功后两个 snapshot ref 都已更新，dirty 自动清除。

- [ ] **Step 6: typecheck**

- [ ] **Step 7: Commit**

```bash
git add apps/extension/src/sidepanel/hooks/useProviderSettings.ts apps/extension/src/sidepanel/hooks/useGraphDisplaySettings.ts apps/extension/src/sidepanel/App.tsx
git commit -m "feat(ext): add unified dirty tracking covering provider + display settings"
```

---

### Task 11: 重写 SettingsPanel.tsx 并修改 App.tsx（条件渲染）

**Files:**
- Rewrite: `apps/extension/src/sidepanel/SettingsPanel.tsx`
- Modify: `apps/extension/src/sidepanel/App.tsx`

这是核心集成步骤。关键变更：

1. **条件渲染**：`settingsOpen` 时，整个 `return` 替换为 `<SettingsPanel />`。主内容（顶栏、状态卡、图谱、日志面板、底部状态）**不挂载**。
2. `SettingsPanel.tsx` 变为薄壳，引入 `SettingsOverlay`
3. `onSaveSettings` 签名为 `() => Promise<SaveResult>`，返回成功/失败

- [ ] **Step 1: 重写 SettingsPanel.tsx**

```tsx
// apps/extension/src/sidepanel/SettingsPanel.tsx

import type { ProviderConfig, ProviderRuntimeSummary } from '@listen-graphic/schema';
import type { GraphDisplaySettings } from '../shared/messages';
import type { BridgeHealth } from './panel-reducer';
import { SettingsOverlay } from './settings/SettingsOverlay';

type SaveResult = { ok: true } | { ok: false; error: string };

export type SettingsPanelProps = {
  providerConfig: ProviderConfig;
  providerSummary: ProviderRuntimeSummary;
  settingsSaving: boolean;
  bridgeHealth: BridgeHealth;
  graphDisplaySettings: GraphDisplaySettings;
  isDirty: boolean;
  onUpdateProviderEntry: (
    stage: keyof ProviderConfig,
    field: keyof ProviderConfig['asr'],
    value: string,
  ) => void;
  onProviderTypeChange: (stage: keyof ProviderConfig, nextType: string) => void;
  onUpdateAutoFitMinReadableFontPx: (value: string) => void;
  onSaveSettings: () => Promise<SaveResult>;
  onClearSecrets: () => void;
  onClose: () => void;
};

export function SettingsPanel(props: SettingsPanelProps) {
  return <SettingsOverlay {...props} />;
}
```

- [ ] **Step 2: 修改 App.tsx 渲染逻辑（条件渲染）**

当前 App.tsx 的 `return`（从第 710 行开始）渲染完整主内容。改为：

```tsx
if (settingsOpen) {
  return (
    <SettingsPanel
      providerConfig={providerConfig}
      providerSummary={providerSummary}
      settingsSaving={settingsSaving || graphDisplaySettingsSaving}
      bridgeHealth={bridgeHealth}
      graphDisplaySettings={graphDisplaySettings}
      isDirty={isDirty}
      onUpdateProviderEntry={updateProviderEntry}
      onProviderTypeChange={handleProviderTypeChange}
      onUpdateAutoFitMinReadableFontPx={updateAutoFitMinReadableFontPx}
      onSaveSettings={handleSaveAllSettings}
      onClearSecrets={handleClearSecrets}
      onClose={() => void handleToggleAllSettings()}
    />
  );
}

// 原有的主内容 return ...
```

这是真正的条件渲染：settingsOpen 时 ReactFlow、状态卡、日志面板、auto-tour 等全部不挂载，不消耗资源。

- [ ] **Step 3: typecheck + 修复**

Run: `pnpm typecheck`
Expected: 修复类型错误后 PASS。主要注意：
- `handleSaveAllSettings` 签名需改为 `() => Promise<SaveResult>`（Task 10 已处理）
- `isDirty` 从 App 层计算（Task 10 已处理）
- `handleToggleAllSettings` 的 void 包装兼容 `onClose: () => void`

- [ ] **Step 4: 更新 App.settings.test.tsx（含 aria-label 策略）**

**aria-label 策略**：用户可见标签中文化，但 `aria-label` 保持英文。新组件中的 aria-label 对照：

| 旧 aria-label | 新 aria-label | 说明 |
|---------------|---------------|------|
| `ASR Provider Type` | `ASR Provider Type` | 不变 |
| `ASR Endpoint` | `ASR Endpoint` | 不变 |
| `ASR Model` | `ASR Model` | 不变 |
| `ASR API Key` | `ASR API Key` | 不变 |
| `Tencent Secret ID` | `Tencent Secret ID` | 不变 |
| `Tencent Transport` | `Tencent Transport` | 不变 |
| `Tencent Need VAD` | `Tencent Need VAD` | 不变 |
| `Structurer Provider Type` | `Structurer Provider Type` | 不变 |
| `Structurer Endpoint` | `Structurer Endpoint` | 不变 |
| `Structurer API Key` | `Structurer API Key` | 不变 |
| `自动适配最小字号` | `自动适配最小字号` | **例外：保持中文**，显示设置原本就是中文 aria-label，测试用 `getByLabelText('自动适配最小字号')` 不需改 |

**Tab 切换**：测试需要先点击正确的 Tab 才能找到对应字段。示例：

```tsx
// 测试 ASR 字段
fireEvent.click(screen.getByRole('button', { name: '语音识别' }));
expect(screen.getByLabelText('ASR Provider Type')).toBeInTheDocument();

// 测试 Structurer 字段
fireEvent.click(screen.getByRole('button', { name: '结构化' }));
expect(screen.getByLabelText('Structurer Provider Type')).toBeInTheDocument();
```

**测试迁移结构性变化清单**（Tab 化带来的测试修改）：

1. **Tab 切换前置**：所有涉及 ASR / Structurer 字段的测试用例必须先 `fireEvent.click(screen.getByRole('button', { name: '语音识别' }))` 或 `screen.getByRole('button', { name: '结构化' }))` 切到对应 Tab，否则字段不在 DOM 中。
2. **`getAllByLabelText(...)[1]` 索引修正**：旧版两列布局中 Structurer 的同名字段（如 `getByLabelText('ASR API Key')`）可能用 `getAllByLabelText(...)[1]` 取第二个。Tab 化后每个 Tab 内字段唯一，改为 `getByLabelText` 即可，不再需要索引。
3. **Structurer 选项可见性**：旧版 Structurer 下拉选项与 ASR 共存于同一 DOM，查询 `getAllByRole('option')` 可能匹配到 ASR 的选项。Tab 化后 Structurer Tab 中只有 Structurer 自身选项，断言数量需相应调整。
4. **条件渲染影响**：设置打开时主内容（ReactFlow、状态卡、日志面板）不挂载。若现有测试在设置打开后断言主内容元素（如 `data-testid="reactflow"`），需调整为 `expect(screen.queryByTestId('reactflow')).not.toBeInTheDocument()`。
5. **SecretField hint 断言变更**：原有合并 hint `已保存 Secret ID / Secret Key，留空则保持不变` 拆为按字段独立提示。测试 `screen.getByText(/已保存 Secret ID/)` 改为 `screen.getByText(/已保存Secret ID/)`（注意空格变化），或使用更宽松的 `/已保存.*Secret ID/`。
6. **新增 mock 字段**：测试渲染 SettingsPanel 时需提供新 props：`graphDisplaySettings`、`isDirty`、`onUpdateAutoFitMinReadableFontPx`、`onClose`。`onSaveSettings` mock 返回 `Promise.resolve({ ok: true })`。
7. **`data-testid="settings-panel"` 保留**：新组件中保留此 testid，`screen.getByTestId('settings-panel')` 断言无需改。
8. **保存测试场景**：新增「保存成功检查 `ok === true`」「保存失败检查 toast 显示 error」两个用例，验证 SaveResult 链路。

- [ ] **Step 5: 运行测试并修复**

Run: `pnpm --filter extension test:run`

- [ ] **Step 6: Commit**

```bash
git add apps/extension/src/sidepanel/SettingsPanel.tsx apps/extension/src/sidepanel/App.tsx apps/extension/src/sidepanel/App.settings.test.tsx
git commit -m "feat(ext): replace inline settings with conditional-rendered full-page settings"
```

---

## Phase 5：清理

### Task 12: 移除已迁移的 renderSecretHint

**Files:**
- Modify: `apps/extension/src/sidepanel/provider-helpers.tsx`

- [ ] **Step 1: 用 Grep 确认 renderSecretHint 无引用**

Search: `renderSecretHint`
Expected: 只有 provider-helpers.tsx 中的定义，无其他引用

- [ ] **Step 2: 删除 renderSecretHint 函数**

- [ ] **Step 3: typecheck + test**

- [ ] **Step 4: Commit**

```bash
git add apps/extension/src/sidepanel/provider-helpers.tsx
git commit -m "refactor(ext): remove migrated renderSecretHint from provider-helpers"
```

---

## 自审清单

### 1. 规格覆盖

| 用户需求 | 对应 Task | 备注 |
|----------|-----------|------|
| 从「挤占主内容」改为覆盖层 | Task 11（条件渲染） | 主内容不挂载 |
| 选择设置后整个页面被设置覆盖 | Task 11（if settingsOpen return <SettingsPanel />） | DOM 层面完全替代 |
| 左上角返回按钮 | Task 9（← 返回 + onClose） | 有 dirty guard |
| 竖排 Tab 导航 | Task 9（左侧 88px 竖排 Tab） | |
| ASR 配置独立 Tab | Task 6（AsrSettings.tsx） | |
| Structurer 配置独立 Tab | Task 7（StructurerSettings.tsx） | |
| 显示配置独立 Tab | Task 8（DisplaySettings.tsx） | dirty 包含此项 |
| 高级参数折叠 | Task 6（CollapsibleSection） | |
| 中英文统一 | Task 6-8（中文可见标签） | aria-label 保持英文 |
| 共享样式系统 | Task 1-2（theme.ts + FormControls） | |
| Toast 反馈 | Task 5 + Task 9 | 基于 SaveResult，非 try/catch |
| 清除密钥确认 | Task 9（window.confirm） | |
| Dirty 状态 | Task 10 | 覆盖 provider + display |
| 返回按钮 dirty guard | Task 9（handleClose） | 未保存时弹 confirm |

### 2. Placeholder 扫描

无 TBD / TODO / 空代码块。

### 3. 类型一致性

- `onSaveSettings`: `() => Promise<SaveResult>` — 与 App.tsx 中 `handleSaveAllSettings` 返回值一致
- `onClose`: `() => void` — 由 `() => void handleToggleAllSettings()` 提供
- `bridgeHealth`: `BridgeHealth` — 与 App.tsx 中已有的类型一致
- `isDirty`: `boolean` — App 层统一计算，覆盖 provider + graphDisplay
- `credentialState`: 由 SettingsOverlay 预计算后传入 AsrSettings/StructurerSettings，不传 summary
- `SaveResult`: `{ ok: true } | { ok: false; error: string }` — SettingsPanel、SettingsOverlay、handleSaveAllSettings 三处一致

### 4. 已知取舍

- **顶栏隐藏**：设置模式下原顶栏（含开始/停止按钮）不显示。用户需返回主界面才能停止会话。
- **SettingsPanel 薄壳**：多一层 indirection，但减少 App.tsx 的 diff 面积，可接受。
- **88px 竖排 Tab**：320px 侧栏下内容区约 220px，足够；Tab 文字可能换行 2-3 行，验收时需确认。
- **Mock provider 仍显示 API Key**：与现行为一致，后续可优化。
- **handleClearSecrets 无反馈**：`onClearSecrets` 当前是 async 但不返回结果。失败时仍会 toast「密钥已清除」。Task 9 中 handleClear 可加 `await`，并在 catch 中显示失败 toast，作为后续优化。
- **SecretField hint 变更**：原有合并 hint `已保存 Secret ID / Secret Key，留空则保持不变` 被拆为按字段独立提示。Task 11 Step 4 需注明测试 `screen.getByText(/已保存 Secret ID/)` 断言需改为 `screen.getByText(/已保存Secret ID/)` 格式。
- **onClose 行为**：`handleToggleAllSettings` 会重新 loadGraphDisplaySettings()。用户 confirm 放弃修改后，从服务端重载是合理行为——确保脏数据不被保留。implementer 不应删除此逻辑。
- **display dirty 用 normalize**：`JSON.stringify` 比较可能因字段顺序或默认值差异产生假 dirty。建议在 `useGraphDisplaySettings` 中添加 `normalizeGraphDisplaySettings()` 对称处理，或在 `useMemo` 中对 display 做字段排序。
- **Tab 可访问性**：竖排 Tab 按钮缺少 `role="tablist"` / `role="tab"` / `aria-selected`。不挡 MVP，记入后续优化。

---

## 执行后验证

- [ ] `pnpm typecheck` 通过
- [ ] `pnpm --filter extension test:run` 通过
- [ ] `pnpm lint` 无新增错误
- [ ] Chrome 中加载扩展：
  1. 点击「设置」→ 整个侧边栏变为设置页面，图谱/状态卡/日志面板完全消失
  2. 左上角有「← 返回」按钮，点击后返回主界面
  3. 修改字段后点击「← 返回」→ 弹「有未保存的修改，确定离开？」
  4. 左侧竖排 Tab：语音识别 / 结构化 / 显示
  5. 点击不同 Tab 切换配置页面
  6. 选择「腾讯云」→ 高级参数默认折叠
  7. 修改字段 → 底部显示「有未保存的修改」
  8. 保存 → toast 显示「设置已保存」（而非假阳性）
  9. 保存失败 → toast 显示错误信息
  10. 「清除密钥」→ 弹确认框
  11. 所有可见标签为中文
  12. aria-label 保持英文（测试不因标签变化失败）
- [ ] 320px 侧栏宽度验收：
  - 竖排 Tab 文字不截断
  - 表单输入框宽度可正常输入
  - 内容区可正常滚动
