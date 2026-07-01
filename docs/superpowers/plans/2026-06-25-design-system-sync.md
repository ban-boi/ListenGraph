# Design System Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the validated design-system contract into production with shared settings atoms, a lighter pipeline module, extension-owned pipeline detail composers, and a documented visual contract.

**Architecture:** `packages/ui` owns reusable visual atoms and pipeline primitives only. Extension-specific runtime facts stay in `apps/extension/src/sidepanel/panel-reducer.ts`, and extension-specific composers stay in `apps/extension/src/sidepanel/status-cards.ts`. Desktop and web-demo only follow the `PipelineModule` prop change in this batch.

**Tech Stack:** TypeScript, React 18, Vitest, Testing Library, Vite, pnpm workspaces, Turborepo.

---

## File Structure

- Create `packages/ui/src/components/FormControls.tsx`: shared `Button`, `InputField`, `SelectField`, `LabeledField`, and `SectionHeader`.
- Create `packages/ui/src/components/SecretField.tsx`: shared secret input with a show/hide eye button.
- Create `packages/ui/src/components/CollapsibleSection.tsx`: shared disclosure section.
- Create `packages/ui/src/components/FormControls.test.tsx`: tests for the shared form controls.
- Create `packages/ui/src/components/SecretField.test.tsx`: tests for configured-secret copy and reveal/hide behavior.
- Create `packages/ui/src/components/CollapsibleSection.test.tsx`: tests for default collapse and toggling.
- Create `packages/ui/src/components/PipelineModule.test.tsx`: tests for the no-status module contract.
- Modify `packages/ui/src/components/PipelineModule.tsx`: remove `status` prop and render.
- Modify `packages/ui/src/index.ts`: export shared atoms and updated types.
- Modify `apps/extension/src/sidepanel/settings/AsrSettings.tsx`: import shared atoms from `@listen-graphic/ui`.
- Modify `apps/extension/src/sidepanel/settings/StructurerSettings.tsx`: import shared atoms from `@listen-graphic/ui`.
- Modify `apps/extension/src/sidepanel/settings/DisplaySettings.tsx`: import shared atoms from `@listen-graphic/ui`.
- Modify `apps/extension/src/sidepanel/settings/SettingsOverlay.tsx`: import shared `Button` and use honest reset copy.
- Delete `apps/extension/src/sidepanel/settings/FormControls.tsx`, `SecretField.tsx`, and `CollapsibleSection.tsx` after consumers switch.
- Modify `apps/extension/src/sidepanel/App.settings.test.tsx`: add reset-copy and secret-toggle assertions.
- Modify `apps/extension/src/sidepanel/types.ts`: add `PipelineModuleData`, `LastTranscriptTail`, and `LastGraphDelta`.
- Modify `apps/extension/src/sidepanel/panel-reducer.ts`: add durable `lastTranscriptTail` and `lastGraphDelta`.
- Create `apps/extension/src/sidepanel/status-cards.test.ts`: focused composer tests.
- Modify `apps/extension/src/sidepanel/status-cards.ts`: return pipeline module data and add `computeGraphStatusCard`.
- Modify `apps/extension/src/sidepanel/App.tsx`: stop passing module `status`, pass auto-tour state to graph composer.
- Modify `apps/extension/src/sidepanel/App.logging.test.tsx`: update status text assertions to detail text assertions.
- Modify `apps/desktop/src/App.tsx`: remove `status` from `PipelineLayout` module objects if present.
- Modify `apps/web-demo/src/App.tsx`: remove `status` from `PipelineLayout` module objects if present.
- Create `docs/extension/pipeline-visual-contract.md`: production contract for pipeline modules and waves.
- Modify `docs/README.md`: link the new pipeline contract.

## Task 1: Prepare Isolated Worktree

**Files:**
- No source edits

- [ ] **Step 1: Create an isolated worktree**

Run from `C:\Users\finni\Desktop\ListenGraph`:

```powershell
git status --short
git worktree add ..\ListenGraph-design-system-sync -b feat/design-system-sync
```

Expected: `git status --short` is empty before the worktree is created, and Git reports a new worktree checked out on `feat/design-system-sync`.

- [ ] **Step 2: Move into the worktree**

```powershell
Set-Location C:\Users\finni\Desktop\ListenGraph-design-system-sync
git status --short
```

Expected: empty status.

## Task 2: Shared Settings Atoms In `packages/ui`

**Files:**
- Create: `packages/ui/src/components/FormControls.tsx`
- Create: `packages/ui/src/components/FormControls.test.tsx`
- Create: `packages/ui/src/components/SecretField.tsx`
- Create: `packages/ui/src/components/SecretField.test.tsx`
- Create: `packages/ui/src/components/CollapsibleSection.tsx`
- Create: `packages/ui/src/components/CollapsibleSection.test.tsx`
- Modify: `packages/ui/src/index.ts`

- [ ] **Step 1: Write tests for shared controls**

Create `packages/ui/src/components/FormControls.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  Button,
  InputField,
  LabeledField,
  SectionHeader,
  SelectField,
} from './FormControls';

describe('FormControls', () => {
  it('renders a labeled field with hint and child control', () => {
    render(
      <LabeledField label="Endpoint" hint="Used by the provider">
        <input aria-label="Endpoint" />
      </LabeledField>,
    );
    expect(screen.getByText('Endpoint')).toBeInTheDocument();
    expect(screen.getByText('Used by the provider')).toBeInTheDocument();
    expect(screen.getByLabelText('Endpoint')).toBeInTheDocument();
  });

  it('maps input changes to string values', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<InputField ariaLabel="Model" value="" onChange={onChange} />);
    await user.type(screen.getByLabelText('Model'), 'gpt');
    expect(onChange).toHaveBeenLastCalledWith('t');
  });

  it('maps select changes to string values', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <SelectField ariaLabel="Provider" value="mock" onChange={onChange}>
        <option value="mock">Mock</option>
        <option value="openai">OpenAI</option>
      </SelectField>,
    );
    await user.selectOptions(screen.getByLabelText('Provider'), 'openai');
    expect(onChange).toHaveBeenCalledWith('openai');
  });

  it('renders button variants and section headers', () => {
    render(
      <>
        <Button variant="primary">Save</Button>
        <Button variant="danger">Reset</Button>
        <SectionHeader>Advanced</SectionHeader>
      </>,
    );
    expect(screen.getByRole('button', { name: 'Save' })).toHaveClass('lg-btn-primary');
    expect(screen.getByRole('button', { name: 'Reset' })).toHaveClass('lg-btn-danger');
    expect(screen.getByText('Advanced')).toHaveClass('lg-form-section-header');
  });
});
```

- [ ] **Step 2: Write tests for `SecretField`**

Create `packages/ui/src/components/SecretField.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SecretField } from './SecretField';

describe('SecretField', () => {
  it('keeps configured secrets blank and explains blank preservation', () => {
    render(
      <SecretField
        ariaLabel="Tencent Secret ID"
        label="Secret ID"
        value=""
        configured
        onChange={() => undefined}
      />,
    );
    const input = screen.getByLabelText('Tencent Secret ID') as HTMLInputElement;
    expect(input.type).toBe('password');
    expect(input.placeholder).toContain('已保存');
    expect(screen.getByText(/已保存Secret ID，留空则保持不变/)).toBeInTheDocument();
  });

  it('toggles password visibility with an accessible button', async () => {
    const user = userEvent.setup();
    render(
      <SecretField
        ariaLabel="API Key"
        label="API Key"
        value="sk-test"
        configured={false}
        onChange={vi.fn()}
      />,
    );
    const input = screen.getByLabelText('API Key') as HTMLInputElement;
    expect(input.type).toBe('password');
    await user.click(screen.getByRole('button', { name: '显示 API Key' }));
    expect(input.type).toBe('text');
    await user.click(screen.getByRole('button', { name: '隐藏 API Key' }));
    expect(input.type).toBe('password');
  });
});
```

- [ ] **Step 3: Write tests for `CollapsibleSection`**

Create `packages/ui/src/components/CollapsibleSection.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CollapsibleSection } from './CollapsibleSection';

describe('CollapsibleSection', () => {
  it('defaults to collapsed and toggles content', async () => {
    const user = userEvent.setup();
    render(
      <CollapsibleSection title="高级参数">
        <div>VAD silence</div>
      </CollapsibleSection>,
    );
    expect(screen.queryByText('VAD silence')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /高级参数/ }));
    expect(screen.getByText('VAD silence')).toBeInTheDocument();
  });
});
```

- [ ] **Step 4: Run tests to verify they fail**

```powershell
pnpm --filter @listen-graphic/ui test:run -- FormControls SecretField CollapsibleSection
```

Expected: tests fail because the three component files do not exist yet.

- [ ] **Step 5: Implement `FormControls`**

Create `packages/ui/src/components/FormControls.tsx`:

```tsx
import type { ButtonHTMLAttributes, ReactNode } from 'react';

export type LabeledFieldProps = {
  label: string;
  hint?: string;
  children: ReactNode;
};

export function LabeledField({ label, hint, children }: LabeledFieldProps) {
  return (
    <label className="lg-form-field">
      <span className="lg-form-label">{label}</span>
      {children}
      {hint ? <span className="lg-form-hint">{hint}</span> : null}
    </label>
  );
}

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
      className={`lg-input${error ? ' lg-input--error' : ''}`}
      aria-label={ariaLabel}
      type={type}
      value={value}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

export type SelectFieldProps = {
  ariaLabel: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
};

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
      onChange={(event) => onChange(event.target.value)}
    >
      {children}
    </select>
  );
}

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'danger' | 'default';
};

export function Button({ variant = 'default', className, ...rest }: ButtonProps) {
  const variantClass =
    variant === 'primary'
      ? 'lg-btn-primary'
      : variant === 'danger'
        ? 'lg-btn-danger'
        : 'lg-btn-secondary';
  return (
    <button
      className={['lg-btn', variantClass, className ?? ''].filter(Boolean).join(' ')}
      {...rest}
    />
  );
}

export type SectionHeaderProps = {
  children: ReactNode;
};

export function SectionHeader({ children }: SectionHeaderProps) {
  return <div className="lg-form-section-header">{children}</div>;
}
```

- [ ] **Step 6: Implement `SecretField`**

Create `packages/ui/src/components/SecretField.tsx`:

```tsx
import { useState } from 'react';
import { LabeledField } from './FormControls';

export type SecretFieldProps = {
  ariaLabel: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  configured: boolean;
  placeholder?: string;
};

function EyeIcon({ hidden }: { hidden: boolean }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="lg-secret-field__icon">
      <path
        d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle
        cx="12"
        cy="12"
        r="2.8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      {hidden ? null : (
        <path
          d="M4 20 20 4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      )}
    </svg>
  );
}

export function SecretField({
  ariaLabel,
  label,
  value,
  onChange,
  configured,
  placeholder,
}: SecretFieldProps) {
  const [revealed, setRevealed] = useState(false);
  const resolvedPlaceholder = configured
    ? '已保存，留空保持不变'
    : (placeholder ?? `请输入${label}`);

  return (
    <LabeledField label={label}>
      <span className="lg-secret-field">
        <input
          className="lg-input lg-secret-field__input"
          aria-label={ariaLabel}
          type={revealed ? 'text' : 'password'}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={resolvedPlaceholder}
        />
        <button
          type="button"
          className="lg-secret-field__toggle"
          aria-label={`${revealed ? '隐藏' : '显示'} ${label}`}
          onClick={() => setRevealed((current) => !current)}
        >
          <EyeIcon hidden={!revealed} />
        </button>
      </span>
      {configured ? (
        <span className="lg-form-hint">已保存{label}，留空则保持不变</span>
      ) : null}
    </LabeledField>
  );
}
```

- [ ] **Step 7: Implement `CollapsibleSection`**

Create `packages/ui/src/components/CollapsibleSection.tsx`:

```tsx
import { useState, type ReactNode } from 'react';

export type CollapsibleSectionProps = {
  title: string;
  defaultCollapsed?: boolean;
  children: ReactNode;
};

export function CollapsibleSection({
  title,
  defaultCollapsed = true,
  children,
}: CollapsibleSectionProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  return (
    <section className="lg-collapsible-section">
      <button
        type="button"
        className="lg-collapsible-section__header"
        aria-expanded={!collapsed}
        onClick={() => setCollapsed((current) => !current)}
      >
        <span>{title}</span>
        <span aria-hidden="true" className="lg-collapsible-section__chevron">
          {collapsed ? '>' : 'v'}
        </span>
      </button>
      {collapsed ? null : (
        <div className="lg-collapsible-section__body">{children}</div>
      )}
    </section>
  );
}
```

- [ ] **Step 8: Add styles to `packages/ui/src/styles/theme.css`**

Append these classes:

```css
.lg-form-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: var(--text-xs);
  color: var(--lg-muted);
}

.lg-form-label,
.lg-form-section-header {
  font-size: var(--text-xs);
  font-weight: 600;
  color: var(--lg-text);
}

.lg-form-hint {
  font-size: var(--text-2xs);
  color: var(--lg-muted);
}

.lg-input--error {
  border-color: var(--lg-danger);
}

.lg-btn-danger {
  color: var(--lg-danger);
  border-color: var(--lg-danger);
  background: transparent;
}

.lg-secret-field {
  position: relative;
  display: flex;
  align-items: center;
}

.lg-secret-field__input {
  width: 100%;
  padding-right: 32px;
}

.lg-secret-field__toggle {
  position: absolute;
  right: 6px;
  width: 24px;
  height: 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--lg-muted);
  background: transparent;
  border: 0;
  cursor: pointer;
}

.lg-secret-field__icon {
  width: 16px;
  height: 16px;
}

.lg-collapsible-section__header {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 0;
  color: var(--lg-text);
  background: transparent;
  border: 0;
  cursor: pointer;
  font-size: var(--text-xs);
  font-weight: 600;
}

.lg-collapsible-section__body {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
```

- [ ] **Step 9: Export components**

Add to `packages/ui/src/index.ts`:

```ts
export {
  Button,
  InputField,
  LabeledField,
  SectionHeader,
  SelectField,
} from './components/FormControls';
export type {
  ButtonProps,
  InputFieldProps,
  LabeledFieldProps,
  SectionHeaderProps,
  SelectFieldProps,
} from './components/FormControls';
export { SecretField } from './components/SecretField';
export type { SecretFieldProps } from './components/SecretField';
export { CollapsibleSection } from './components/CollapsibleSection';
export type { CollapsibleSectionProps } from './components/CollapsibleSection';
```

- [ ] **Step 10: Run focused UI tests**

```powershell
pnpm --filter @listen-graphic/ui test:run -- FormControls SecretField CollapsibleSection
```

Expected: all new tests pass.

- [ ] **Step 11: Commit shared atoms**

```powershell
git add packages/ui/src/components/FormControls.tsx packages/ui/src/components/FormControls.test.tsx packages/ui/src/components/SecretField.tsx packages/ui/src/components/SecretField.test.tsx packages/ui/src/components/CollapsibleSection.tsx packages/ui/src/components/CollapsibleSection.test.tsx packages/ui/src/styles/theme.css packages/ui/src/index.ts
git commit -m "feat(ui): add shared settings controls"
```

## Task 3: Switch Extension Settings To Shared Atoms

**Files:**
- Modify: `apps/extension/src/sidepanel/settings/AsrSettings.tsx`
- Modify: `apps/extension/src/sidepanel/settings/StructurerSettings.tsx`
- Modify: `apps/extension/src/sidepanel/settings/DisplaySettings.tsx`
- Modify: `apps/extension/src/sidepanel/settings/SettingsOverlay.tsx`
- Modify: `apps/extension/src/sidepanel/App.settings.test.tsx`
- Delete: `apps/extension/src/sidepanel/settings/FormControls.tsx`
- Delete: `apps/extension/src/sidepanel/settings/SecretField.tsx`
- Delete: `apps/extension/src/sidepanel/settings/CollapsibleSection.tsx`

- [ ] **Step 1: Add extension tests for reveal toggle and reset copy**

Append to `apps/extension/src/sidepanel/App.settings.test.tsx` inside the existing `describe('App - 设置面板', () => { ... })`:

```tsx
  it('密钥字段可以临时显示和隐藏', async () => {
    (globalThis as any).chrome.runtime.sendMessage.mockImplementation(
      (message: { type?: string }) => {
        if (message?.type === 'GET_RUNTIME_SNAPSHOT') {
          return Promise.resolve({
            success: true,
            snapshot: { sessionId: null, state: 'idle', graph: null, currentTimeMs: 0 },
          });
        }
        if (message?.type === 'GET_PROVIDER_SETTINGS') {
          return Promise.resolve({
            success: true,
            config: {
              asr: { type: 'tencent', mode: 'direct', region: 'ap-shanghai', language: 'zh' },
              structurer: { type: 'mock', mode: 'direct', model: 'mock-structurer', language: 'zh' },
            },
          });
        }
        return Promise.resolve({ success: true });
      },
    );
    const user = userEvent.setup();
    await renderApp();
    await act(async () => {
      await user.click(screen.getByRole('button', { name: /^设置$/ }));
    });
    const settingsPanel = await screen.findByTestId('settings-panel');
    const input = within(settingsPanel).getByLabelText('Tencent Secret ID') as HTMLInputElement;
    await act(async () => {
      await user.type(input, 'secret-id');
      await user.click(within(settingsPanel).getByRole('button', { name: '显示 Secret ID' }));
    });
    expect(input.type).toBe('text');
    await act(async () => {
      await user.click(within(settingsPanel).getByRole('button', { name: '隐藏 Secret ID' }));
    });
    expect(input.type).toBe('password');
  });

  it('恢复默认配置按钮诚实描述重置范围', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    (globalThis as any).chrome.runtime.sendMessage.mockImplementation(
      (message: { type?: string }) => {
        if (message?.type === 'GET_RUNTIME_SNAPSHOT') {
          return Promise.resolve({
            success: true,
            snapshot: { sessionId: null, state: 'idle', graph: null, currentTimeMs: 0 },
          });
        }
        if (message?.type === 'GET_PROVIDER_SETTINGS') {
          return Promise.resolve({
            success: true,
            config: {
              asr: { type: 'openai', mode: 'direct', endpoint: 'https://api.openai.com/v1', model: 'gpt-4o-mini-transcribe', language: 'zh' },
              structurer: { type: 'openai', mode: 'direct', endpoint: 'https://api.openai.com/v1', model: 'gpt-4.1-mini', language: 'zh' },
            },
          });
        }
        return Promise.resolve({ success: true });
      },
    );
    const user = userEvent.setup();
    await renderApp();
    await act(async () => {
      await user.click(screen.getByRole('button', { name: /^设置$/ }));
    });
    const settingsPanel = await screen.findByTestId('settings-panel');
    await act(async () => {
      await user.click(within(settingsPanel).getByRole('button', { name: '恢复默认配置' }));
    });
    expect(confirmSpy).toHaveBeenCalledWith(
      expect.stringContaining('provider type、endpoint、model 和密钥'),
    );
    expect((globalThis as any).chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'CLEAR_PROVIDER_SECRETS' }),
    );
    confirmSpy.mockRestore();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

```powershell
pnpm --filter extension test:run -- src/sidepanel/App.settings.test.tsx
```

Expected: the new tests fail because shared imports and reset copy are not in place.

- [ ] **Step 3: Update imports in settings files**

In `apps/extension/src/sidepanel/settings/AsrSettings.tsx`, replace local imports with:

```ts
import {
  CollapsibleSection,
  InputField,
  SecretField,
  SectionHeader,
  SelectField,
} from '@listen-graphic/ui';
```

In `apps/extension/src/sidepanel/settings/StructurerSettings.tsx`, replace local imports with:

```ts
import {
  InputField,
  SecretField,
  SectionHeader,
  SelectField,
} from '@listen-graphic/ui';
```

In `apps/extension/src/sidepanel/settings/DisplaySettings.tsx`, replace local imports with:

```ts
import {
  LabeledField,
  SectionHeader,
  SelectField,
} from '@listen-graphic/ui';
```

In `apps/extension/src/sidepanel/settings/SettingsOverlay.tsx`, replace:

```ts
import { Button } from './FormControls';
```

with:

```ts
import { Button } from '@listen-graphic/ui';
```

- [ ] **Step 4: Update reset copy**

In `apps/extension/src/sidepanel/settings/SettingsOverlay.tsx`, change `handleClear` to:

```ts
  const handleClear = useCallback(() => {
    if (!window.confirm('确定要恢复默认 provider 配置吗？provider type、endpoint、model 和密钥都会回到扩展默认值。')) return;
    onClearSecrets();
    showSuccess('provider 配置已恢复默认');
  }, [onClearSecrets, showSuccess]);
```

Change the danger button body to:

```tsx
          <Button variant="danger" onClick={handleClear}>
            恢复默认配置
          </Button>
```

In `apps/extension/src/sidepanel/hooks/useProviderSettings.ts`, change user-facing log strings:

```ts
addLog(`恢复默认配置失败: ${response?.error || '未知错误'}`);
addLog('provider 配置已恢复默认');
const message = error instanceof Error ? error.message : '恢复 provider 默认配置失败';
addLog(`恢复默认配置失败: ${message}`);
```

- [ ] **Step 5: Delete extension-private atom files**

Remove:

```powershell
Remove-Item -LiteralPath apps/extension/src/sidepanel/settings/FormControls.tsx
Remove-Item -LiteralPath apps/extension/src/sidepanel/settings/SecretField.tsx
Remove-Item -LiteralPath apps/extension/src/sidepanel/settings/CollapsibleSection.tsx
```

- [ ] **Step 6: Run extension settings tests**

```powershell
pnpm --filter extension test:run -- src/sidepanel/App.settings.test.tsx
```

Expected: all settings tests pass.

- [ ] **Step 7: Run extension typecheck for import drift**

```powershell
pnpm --filter extension typecheck
```

Expected: typecheck exits 0.

- [ ] **Step 8: Commit settings migration**

```powershell
git add apps/extension/src/sidepanel/settings apps/extension/src/sidepanel/hooks/useProviderSettings.ts apps/extension/src/sidepanel/App.settings.test.tsx
git commit -m "refactor(extension): consume shared settings controls"
```

## Task 4: Remove PipelineModule Status

**Files:**
- Create: `packages/ui/src/components/PipelineModule.test.tsx`
- Modify: `packages/ui/src/components/PipelineModule.tsx`
- Modify: `apps/extension/src/sidepanel/App.tsx`
- Modify: `apps/desktop/src/App.tsx`
- Modify: `apps/web-demo/src/App.tsx`
- Modify: tests that still assert module status text

- [ ] **Step 1: Write the PipelineModule contract test**

Create `packages/ui/src/components/PipelineModule.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PipelineModule } from './PipelineModule';

describe('PipelineModule', () => {
  it('renders dot, label, and detail without a secondary status label', () => {
    render(
      <PipelineModule
        label="Graph"
        detail="图谱已稳定 · 3 节点 · 2 关系"
        tone="success"
        testId="status-card-graph"
      />,
    );
    expect(screen.getByTestId('status-card-graph')).toBeInTheDocument();
    expect(screen.getByText('Graph')).toBeInTheDocument();
    expect(screen.getByText('图谱已稳定 · 3 节点 · 2 关系')).toBeInTheDocument();
    expect(document.querySelector('.lg-pipeline-mod__status')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```powershell
pnpm --filter @listen-graphic/ui test:run -- PipelineModule
```

Expected: TypeScript or test failure because `status` is still required and rendered.

- [ ] **Step 3: Update `PipelineModule`**

Change `packages/ui/src/components/PipelineModule.tsx` to:

```tsx
import type { StatusCardTone } from './StatusCard';

export interface PipelineModuleProps {
  label: string;
  detail: string;
  tone: StatusCardTone;
  testId?: string;
}

const DOT_CLASS: Record<StatusCardTone, string> = {
  active: 'lg-signal-dot--active',
  waiting: 'lg-signal-dot--active',
  success: 'lg-signal-dot--idle',
  warning: 'lg-signal-dot--idle',
  congested: 'lg-signal-dot--active',
  error: 'lg-signal-dot--error',
  neutral: 'lg-signal-dot--idle',
};

const LABEL_COLORS: Record<StatusCardTone, string> = {
  active: 'var(--lg-signal-dim)',
  waiting: 'var(--lg-signal-dim)',
  success: 'var(--lg-success)',
  warning: 'var(--lg-insight-dim)',
  congested: 'var(--lg-insight-dim)',
  error: 'var(--lg-danger)',
  neutral: 'var(--lg-muted)',
};

export function PipelineModule({ label, detail, tone, testId }: PipelineModuleProps) {
  return (
    <div data-testid={testId} className="lg-pipeline-mod">
      <div className="lg-pipeline-mod__header">
        <div className={`lg-signal-dot ${DOT_CLASS[tone] ?? 'lg-signal-dot--idle'}`} />
        <span className="lg-pipeline-mod__label" style={{ color: LABEL_COLORS[tone] }}>
          {label}
        </span>
      </div>
      <div className="lg-pipeline-mod__detail" title={detail}>
        {detail}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Remove `status` from app consumers**

In `apps/extension/src/sidepanel/App.tsx`, remove the three `status:` fields inside `PipelineLayout` module objects. Keep `label`, `detail`, `tone`, and `testId`.

In `apps/desktop/src/App.tsx` and `apps/web-demo/src/App.tsx`, remove any `status:` field passed to `PipelineLayout` module objects. Do not redesign their detail text.

- [ ] **Step 5: Update tests that asserted old status copy**

In `apps/extension/src/sidepanel/App.logging.test.tsx`, replace assertions for old `delayed`, `processing`, or node-count status text inside `status-card-structurer` with detail-based assertions from Task 6 after the composers are rewritten. If this task is run before Task 6, leave those exact updates for Task 6 and only remove direct `lg-pipeline-mod__status` assumptions.

- [ ] **Step 6: Run focused UI and type checks**

```powershell
pnpm --filter @listen-graphic/ui test:run -- PipelineModule
pnpm --filter @listen-graphic/ui typecheck
pnpm --filter extension typecheck
pnpm --filter desktop typecheck
pnpm --filter web-demo typecheck
```

Expected: all commands exit 0 after all consumers stop passing `status`.

- [ ] **Step 7: Commit PipelineModule change**

```powershell
git add packages/ui/src/components/PipelineModule.tsx packages/ui/src/components/PipelineModule.test.tsx apps/extension/src/sidepanel/App.tsx apps/desktop/src/App.tsx apps/web-demo/src/App.tsx
git commit -m "refactor(ui): remove pipeline module status text"
```

## Task 5: Add Reducer Facts For ASR Tail And Graph Delta

**Files:**
- Modify: `apps/extension/src/sidepanel/types.ts`
- Modify: `apps/extension/src/sidepanel/panel-reducer.ts`
- Modify: `apps/extension/src/sidepanel/panel-reducer.fixture.test.ts`

- [ ] **Step 1: Add reducer tests**

Append to `apps/extension/src/sidepanel/panel-reducer.fixture.test.ts`:

```ts
describe('pipeline detail facts', () => {
  it('stores the latest stable transcript tail', () => {
    const next = panelReducer(initialPanelState, {
      type: 'TRANSCRIPT_READY',
      payload: {
        utteranceKey: 'asr-utterance-1',
        transcript: {
          text: '这是最新一句稳定转写',
          startMs: 1000,
          endMs: 2000,
          provider: 'mock',
        },
      },
    });
    expect(next.lastTranscriptTail).toEqual({
      text: '这是最新一句稳定转写',
      stable: true,
      at: expect.any(Number),
    });
  });

  it('stores graph delta counts from merged graph updates', () => {
    const previousGraph: MergedGraph = {
      ...graph,
      revision: 1,
      nodes: [{ id: 'n1', type: 'claim', text: 't', timestampMs: 0, status: 'confirmed' }],
      edges: [],
    };
    const nextGraph: MergedGraph = {
      ...previousGraph,
      revision: 2,
      nodes: [
        ...previousGraph.nodes,
        { id: 'n2', type: 'reason', text: 'r', timestampMs: 1000, status: 'confirmed' },
      ],
      edges: [{ id: 'e1', source: 'n1', target: 'n2', type: 'supports' }],
    };
    const next = panelReducer(initialPanelState, {
      type: 'MERGED_GRAPH_UPDATED',
      payload: {
        graph: nextGraph,
        shouldPreserveView: false,
        previousGraph,
        addedNodeIds: ['n2'],
        anchorNodeIds: ['n1'],
      },
    });
    expect(next.lastGraphDelta).toEqual({
      addedNodeCount: 1,
      addedEdgeCount: 1,
      at: expect.any(Number),
    });
  });

  it('clears graph delta and transcript tail on runtime UI reset', () => {
    const withFacts = {
      ...initialPanelState,
      lastTranscriptTail: { text: '旧转写', stable: true, at: 1 },
      lastGraphDelta: { addedNodeCount: 1, addedEdgeCount: 1, at: 2 },
    };
    const next = panelReducer(withFacts, { type: 'RESET_RUNTIME_UI' });
    expect(next.lastTranscriptTail).toBeNull();
    expect(next.lastGraphDelta).toBeNull();
  });

  it('clears graph delta on fixture sequence arm', () => {
    const withDelta = {
      ...initialPanelState,
      lastGraphDelta: { addedNodeCount: 1, addedEdgeCount: 1, at: 2 },
    };
    const next = panelReducer(withDelta, {
      type: 'FIXTURE_SEQUENCE_ARM',
      payload: { sessionId: 'fixture-seq-x', initialGraph: graph },
    });
    expect(next.lastGraphDelta).toBeNull();
  });
});
```

- [ ] **Step 2: Run reducer tests to verify failure**

```powershell
pnpm --filter extension test:run -- src/sidepanel/panel-reducer.fixture.test.ts
```

Expected: tests fail because `lastTranscriptTail` and `lastGraphDelta` do not exist.

- [ ] **Step 3: Add types**

In `apps/extension/src/sidepanel/types.ts`, add:

```ts
export type LastTranscriptTail = {
  text: string;
  stable: boolean;
  at: number;
} | null;

export type LastGraphDelta = {
  addedNodeCount: number;
  addedEdgeCount: number;
  at: number;
} | null;

export type PipelineModuleData = {
  label: string;
  detail: string;
  tone: StatusCardTone;
};
```

- [ ] **Step 4: Wire reducer fields**

In `apps/extension/src/sidepanel/panel-reducer.ts`, import the new types:

```ts
import type {
  LastGraphDelta,
  LastTranscriptTail,
  TimelineEvent,
} from './types';
```

Add to `PanelState`:

```ts
  lastTranscriptTail: LastTranscriptTail;
  lastGraphDelta: LastGraphDelta;
```

Add to `initialPanelState`:

```ts
  lastTranscriptTail: null,
  lastGraphDelta: null,
```

In `TRANSCRIPT_READY`, add:

```ts
        lastTranscriptTail: {
          text: transcript.text,
          stable: true,
          at: Date.now(),
        },
```

In `MERGED_GRAPH_UPDATED`, compute and store:

```ts
      const addedEdgeCount = nextGraph.edges.filter(
        (edge) => !action.payload.previousGraph.edges.some((prev) => prev.id === edge.id),
      ).length;
```

Then add to the returned state:

```ts
        lastGraphDelta: {
          addedNodeCount: action.payload.addedNodeIds.length,
          addedEdgeCount,
          at: Date.now(),
        },
```

Clear both fields in `RESET_RUNTIME_UI`; clear `lastGraphDelta` in `FIXTURE_SEQUENCE_ARM`; clear both fields in `RESET_CONTEXT` and idle graph reset paths where the graph is replaced with `createEmptyGraph()`.

- [ ] **Step 5: Run reducer tests**

```powershell
pnpm --filter extension test:run -- src/sidepanel/panel-reducer.fixture.test.ts
```

Expected: reducer tests pass.

- [ ] **Step 6: Commit reducer facts**

```powershell
git add apps/extension/src/sidepanel/types.ts apps/extension/src/sidepanel/panel-reducer.ts apps/extension/src/sidepanel/panel-reducer.fixture.test.ts
git commit -m "feat(extension): track pipeline detail facts"
```

## Task 6: Rewrite Extension Pipeline Composers

**Files:**
- Create: `apps/extension/src/sidepanel/status-cards.test.ts`
- Modify: `apps/extension/src/sidepanel/status-cards.ts`
- Modify: `apps/extension/src/sidepanel/App.tsx`
- Modify: `apps/extension/src/sidepanel/App.logging.test.tsx`

- [ ] **Step 1: Write composer tests**

Create `apps/extension/src/sidepanel/status-cards.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { MergedGraph } from '@listen-graphic/schema';
import { initialPanelState } from './panel-reducer';
import {
  computeAsrStatusCard,
  computeGraphStatusCard,
  computeStructurerStatusCard,
} from './status-cards';

const nowMs = 10_000;

const graph: MergedGraph = {
  sessionId: 's1',
  revision: 1,
  topics: [],
  nodes: [
    { id: 'n1', type: 'claim', text: '观点', timestampMs: 0, status: 'confirmed' },
    { id: 'n2', type: 'reason', text: '理由', timestampMs: 1, status: 'confirmed' },
  ],
  edges: [{ id: 'e1', source: 'n1', target: 'n2', type: 'supports' }],
  updatedAt: nowMs,
};

describe('pipeline status composers', () => {
  it('uses stable transcript tail for ASR detail', () => {
    const card = computeAsrStatusCard({
      panel: {
        ...initialPanelState,
        sessionState: 'capturing',
        lastTranscriptTail: { text: '最后一句稳定转写', stable: true, at: nowMs - 500 },
      },
      providerAsrType: 'mock',
      statusNowMs: nowMs,
    });
    expect(card).toMatchObject({
      label: 'ASR',
      detail: '最后一句稳定转写',
      tone: 'success',
    });
  });

  it('summarizes structurer pressure without lastStructurerRun', () => {
    const card = computeStructurerStatusCard({
      panel: {
        ...initialPanelState,
        sessionState: 'structuring',
        structuringSince: nowMs - 2400,
        pendingTranscriptCount: 3,
        pendingWorkCount: 1,
        lastStructurerRun: { status: 'success', durationMs: 10, mode: 'window' } as any,
      },
      providerAsrType: 'mock',
      statusNowMs: nowMs,
    });
    expect(card.detail).toBe('2.4s · 排队 3');
    expect(card.tone).toBe('congested');
  });

  it('prioritizes graph error over delta and tour', () => {
    const card = computeGraphStatusCard({
      graph,
      pendingWorkCount: 2,
      recentStructurerError: { stage: 'structurer', message: 'fail' } as any,
      lastGraphDelta: { addedNodeCount: 1, addedEdgeCount: 1, at: nowMs },
      lastGraphUpdatedAt: nowMs,
      statusNowMs: nowMs,
      tourStatus: 'touring',
      tourProgress: { current: 1, total: 2 },
    });
    expect(card.detail).toBe('保留旧图 · 待处理 2');
    expect(card.tone).toBe('error');
  });

  it('uses fresh graph delta within 1000ms', () => {
    const card = computeGraphStatusCard({
      graph,
      pendingWorkCount: 0,
      recentStructurerError: null,
      lastGraphDelta: { addedNodeCount: 2, addedEdgeCount: 1, at: nowMs - 1000 },
      lastGraphUpdatedAt: nowMs - 1000,
      statusNowMs: nowMs,
      tourStatus: 'idle',
      tourProgress: { current: 0, total: 0 },
    });
    expect(card.detail).toBe('新增 2 节点 · 1 关系');
  });

  it('uses tour detail after fresh delta window', () => {
    const card = computeGraphStatusCard({
      graph,
      pendingWorkCount: 0,
      recentStructurerError: null,
      lastGraphDelta: { addedNodeCount: 2, addedEdgeCount: 1, at: nowMs - 1001 },
      lastGraphUpdatedAt: nowMs - 1001,
      statusNowMs: nowMs,
      tourStatus: 'touring',
      tourProgress: { current: 1, total: 2 },
    });
    expect(card.detail).toBe('导览 1/2');
  });

  it('uses recent replay within 5000ms and stable text after that', () => {
    const recent = computeGraphStatusCard({
      graph,
      pendingWorkCount: 0,
      recentStructurerError: null,
      lastGraphDelta: null,
      lastGraphUpdatedAt: nowMs - 5000,
      statusNowMs: nowMs,
      tourStatus: 'idle',
      tourProgress: { current: 0, total: 0 },
    });
    expect(recent.detail).toBe('回显 2 节点 · 1 关系');

    const stable = computeGraphStatusCard({
      graph,
      pendingWorkCount: 0,
      recentStructurerError: null,
      lastGraphDelta: null,
      lastGraphUpdatedAt: nowMs - 5001,
      statusNowMs: nowMs,
      tourStatus: 'idle',
      tourProgress: { current: 0, total: 0 },
    });
    expect(stable.detail).toBe('图谱已稳定 · 2 节点 · 1 关系');
  });
});
```

- [ ] **Step 2: Run composer tests to verify failure**

```powershell
pnpm --filter extension test:run -- src/sidepanel/status-cards.test.ts
```

Expected: tests fail because `computeGraphStatusCard` and new detail behavior do not exist.

- [ ] **Step 3: Update `status-cards.ts` types and constants**

Add imports:

```ts
import type { MergedGraph } from '@listen-graphic/schema';
import type {
  AutoTourStatus,
  LastGraphDelta,
  PipelineModuleData,
} from './types';
```

Add constants:

```ts
const GRAPH_FRESH_DELTA_MS = 1000;
const GRAPH_RECENT_REPLAY_MS = 5000;

function graphCountDetail(prefix: string, graph: MergedGraph) {
  return `${prefix}${graph.nodes.length} 节点 · ${graph.edges.length} 关系`;
}
```

Remove the old `StatusCardData` import. Change `computeAsrStatusCard` and `computeStructurerStatusCard` return type from `StatusCardData` to `PipelineModuleData`. Keep the error and bridge branches but return `label`, `detail`, and `tone` only.

- [ ] **Step 4: Implement ASR detail behavior**

In `computeAsrStatusCard`, after ASR error and bridge-health handling, use:

```ts
  const tailText = panel.lastTranscriptTail?.text.trim();
  const fallbackDetail = lastTranscriptAt
    ? `最近稳定句子 ${formatRelativeAge(lastTranscriptAt, statusNowMs)}`
    : '等待转写';

  if (sessionState === 'transcribing') {
    return {
      label: 'ASR',
      detail: tailText || fallbackDetail,
      tone: 'active',
    };
  }
  if (sessionState === 'capturing') {
    return {
      label: 'ASR',
      detail: tailText || fallbackDetail,
      tone: tailText ? 'success' : 'waiting',
    };
  }
  return {
    label: 'ASR',
    detail: tailText || fallbackDetail,
    tone: tailText ? 'neutral' : 'neutral',
  };
```

- [ ] **Step 5: Implement Structurer pressure detail**

Replace the existing `sessionState === 'structuring'` detail block with:

```ts
    const queueCount = Math.max(pendingTranscriptCount, pendingWorkCount);
    const elapsedText = `${Math.max(Math.round(structurerElapsedMs / 100) / 10, 0)}s`;
    const pressureText = queueCount > 0 ? `排队 ${queueCount}` : '队列 0';
    return {
      label: 'Structurer',
      detail: `${elapsedText} · ${pressureText}`,
      tone:
        status === 'processing'
          ? 'active'
          : status === 'congested'
            ? 'congested'
            : 'warning',
    };
```

For stop drain, return:

```ts
return {
  label: 'Structurer',
  detail: `排空 剩余 ${stopDrainPendingCount} · 正在收尾`,
  tone: 'warning',
};
```

For bootstrap waiting, return:

```ts
return {
  label: 'Structurer',
  detail: pendingTranscriptCount > 0 ? `等待建图 · 排队 ${pendingTranscriptCount}` : '等待可结构化上下文',
  tone: 'waiting',
};
```

For idle, return:

```ts
return {
  label: 'Structurer',
  detail: graph.nodes.length > 0 ? '队列 0' : '等待可结构化上下文',
  tone: graph.nodes.length > 0 ? 'neutral' : 'waiting',
};
```

- [ ] **Step 6: Implement `computeGraphStatusCard`**

Add:

```ts
export interface GraphStatusCardInputs {
  graph: MergedGraph;
  pendingWorkCount: number;
  recentStructurerError: PanelState['recentProviderError'];
  lastGraphDelta: LastGraphDelta;
  lastGraphUpdatedAt: number | null;
  statusNowMs: number;
  tourStatus: AutoTourStatus;
  tourProgress: { current: number; total: number };
}

export function computeGraphStatusCard({
  graph,
  pendingWorkCount,
  recentStructurerError,
  lastGraphDelta,
  lastGraphUpdatedAt,
  statusNowMs,
  tourStatus,
  tourProgress,
}: GraphStatusCardInputs): PipelineModuleData {
  if (recentStructurerError?.stage === 'structurer') {
    return {
      label: 'Graph',
      detail: `保留旧图 · 待处理 ${pendingWorkCount}`,
      tone: 'error',
    };
  }

  if (
    lastGraphDelta &&
    statusNowMs - lastGraphDelta.at <= GRAPH_FRESH_DELTA_MS
  ) {
    return {
      label: 'Graph',
      detail: `新增 ${lastGraphDelta.addedNodeCount} 节点 · ${lastGraphDelta.addedEdgeCount} 关系`,
      tone: 'active',
    };
  }

  if (tourStatus === 'touring') {
    return {
      label: 'Graph',
      detail: `导览 ${tourProgress.current}/${tourProgress.total}`,
      tone: 'success',
    };
  }

  if (tourStatus === 'paused') {
    return {
      label: 'Graph',
      detail: `导览暂停 ${tourProgress.current}/${tourProgress.total}`,
      tone: 'warning',
    };
  }

  if (graph.nodes.length === 0) {
    return {
      label: 'Graph',
      detail: '等待图谱数据',
      tone: 'neutral',
    };
  }

  if (
    lastGraphUpdatedAt &&
    statusNowMs - lastGraphUpdatedAt <= GRAPH_RECENT_REPLAY_MS
  ) {
    return {
      label: 'Graph',
      detail: graphCountDetail('回显 ', graph),
      tone: 'success',
    };
  }

  return {
    label: 'Graph',
    detail: graphCountDetail('图谱已稳定 · ', graph),
    tone: 'success',
  };
}
```

- [ ] **Step 7: Wire App to the Graph composer**

In `apps/extension/src/sidepanel/App.tsx`, import `computeGraphStatusCard`, compute:

```ts
  const graphStatusCard = useMemo(
    () => computeGraphStatusCard({
      graph: panel.graph,
      pendingWorkCount: panel.pendingWorkCount,
      recentStructurerError: panel.recentProviderError,
      lastGraphDelta: panel.lastGraphDelta,
      lastGraphUpdatedAt: panel.lastGraphUpdatedAt,
      statusNowMs,
      tourStatus: autoTourStatus,
      tourProgress: autoTourProgress,
    }),
    [
      autoTourProgress,
      autoTourStatus,
      panel.graph,
      panel.lastGraphDelta,
      panel.lastGraphUpdatedAt,
      panel.pendingWorkCount,
      panel.recentProviderError,
      statusNowMs,
    ],
  );
```

Use it in `PipelineLayout`:

```tsx
        graph={{
          module: {
            label: graphStatusCard.label,
            detail: graphStatusCard.detail,
            tone: graphStatusCard.tone,
            testId: 'status-card-graph',
          },
          waveStatus: graphWaveStatus,
          waveTone: 'neutral',
        }}
```

- [ ] **Step 8: Update logging/rendering tests**

In `apps/extension/src/sidepanel/App.logging.test.tsx`, update structurer card assertions to look for detail strings such as `排队`, `队列 0`, or `排空 剩余` instead of old `status` words. Use `within(screen.getByTestId('status-card-structurer')).getByText(/排队|队列|排空/)`.

In `apps/extension/src/sidepanel/App.rendering.test.tsx`, add:

```tsx
expect(screen.getByTestId('status-card-graph')).toBeInTheDocument();
```

- [ ] **Step 9: Run focused tests**

```powershell
pnpm --filter extension test:run -- src/sidepanel/status-cards.test.ts src/sidepanel/panel-reducer.fixture.test.ts src/sidepanel/App.rendering.test.tsx src/sidepanel/App.logging.test.tsx
```

Expected: focused extension tests pass.

- [ ] **Step 10: Commit composers**

```powershell
git add apps/extension/src/sidepanel/status-cards.ts apps/extension/src/sidepanel/status-cards.test.ts apps/extension/src/sidepanel/App.tsx apps/extension/src/sidepanel/App.logging.test.tsx apps/extension/src/sidepanel/App.rendering.test.tsx
git commit -m "feat(extension): compose pipeline details from runtime state"
```

## Task 7: Document Production Pipeline Contract

**Files:**
- Create: `docs/extension/pipeline-visual-contract.md`
- Modify: `docs/README.md`

- [ ] **Step 1: Create the contract doc**

Create `docs/extension/pipeline-visual-contract.md`:

```markdown
# Pipeline 可视化契约

本文档是生产实现的当前契约。原型可用于追踪设计来源，但生产实现以这里和代码测试为准。

## 布局

- `< 400px`: 单列竖排，横向波浪。
- `400px - 599px`: ASR / Structurer 顶行，Graph 单独一行。
- `>= 600px`: 三段并排，竖向波浪。

## 模块

每个模块只显示 dot、label、detail。不要在 label 旁边再显示 status 文本。

- ASR detail 回答“刚听到什么”。
- Structurer detail 回答“当前处理压力如何”。
- Graph detail 回答“图谱现在产出了什么”。

## Graph 状态优先级

1. Structurer 错误：`保留旧图 · 待处理 N`
2. 新增落地，`nowMs - lastGraphDelta.at <= 1000`: `新增 N 节点 · M 关系`
3. 自动导览中：`导览 current/total`
4. 导览暂停：`导览暂停 current/total`
5. 最近回显，`nowMs - lastGraphUpdatedAt <= 5000`: `回显 N 节点 · M 关系`
6. 稳定：`图谱已稳定 · N 节点 · M 关系`
7. 空图：`等待图谱数据`

## 波浪

生产继续使用 `PipelineWaveDivider` 的 SVG path + ResizeObserver 实现。不要用原型里的 CSS background-image 替换它。

当前视觉常量：

- wavelength: 40px
- amplitude: 7px
- statuses: idle, active, complete, error
- tones: signal, insight, neutral

## Release Surface Rule

provider、model、endpoint、token、错误堆栈和调试日志不进入常驻 pipeline 模块。它们属于设置、错误提示、调试面板或诊断抽屉。
```

- [ ] **Step 2: Link from docs README**

In `docs/README.md`, under "运行时现状与关键决策", add:

```markdown
- [Pipeline 可视化契约](C:/Users/finni/Desktop/ListenGraph/docs/extension/pipeline-visual-contract.md)
  - ASR / Structurer / Graph 三段 detail 应显示什么
  - Graph 多态时序、1000ms / 5000ms 时间窗、波浪视觉常量
  - release surface 中哪些诊断信息不应常驻
```

- [ ] **Step 3: Commit docs**

```powershell
git add docs/extension/pipeline-visual-contract.md docs/README.md
git commit -m "docs: record pipeline visual contract"
```

## Task 8: Final Verification

**Files:**
- No new source edits unless verification exposes failures

- [ ] **Step 1: Run package-level focused tests**

```powershell
pnpm --filter @listen-graphic/ui test:run
pnpm --filter extension test:run -- src/sidepanel/status-cards.test.ts src/sidepanel/panel-reducer.fixture.test.ts src/sidepanel/App.settings.test.tsx src/sidepanel/App.rendering.test.tsx src/sidepanel/App.logging.test.tsx
```

Expected: both commands exit 0.

- [ ] **Step 2: Run lint and typecheck gates**

```powershell
pnpm lint
pnpm typecheck
```

Expected: both commands exit 0.

- [ ] **Step 3: Run extension contract and replay gates**

```powershell
pnpm test:ext:contract
pnpm test:ext:replay
```

Expected: both commands exit 0.

- [ ] **Step 4: Run thin E2E if visible flow changed beyond text**

Run this if the settings interaction or pipeline layout behavior changed in a way that cannot be covered by Vitest:

```powershell
pnpm test:ext:e2e
```

Expected: command exits 0 when run. If skipped, record the reason in the final report.

- [ ] **Step 5: Inspect final diff**

```powershell
git status --short
git log --oneline -6
```

Expected: working tree is clean after all task commits, and the recent commits correspond to this plan's tasks.

## Plan Self-Review

- Spec coverage: shared atoms are covered by Tasks 2-3; `PipelineModule` status removal by Task 4; reducer facts by Task 5; ASR/Structurer/Graph composers by Task 6; production contract docs by Task 7; repository gates by Task 8.
- Scope check: `SessionList`, `DiagnosticsDrawer`, desktop settings pages, desktop/web-demo detail redesign, wave implementation replacement, and `lastStructurerRun` runtime repair are not included.
- Type consistency: `LastTranscriptTail`, `LastGraphDelta`, and `PipelineModuleData` are defined before use. `computeGraphStatusCard` consumes only durable reducer fields plus auto-tour state passed by `App.tsx`.
- Testing check: each production behavior has a focused test before the implementation step, then a command that proves the focused behavior.
