# Readable Auto Fit Font Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make automatic graph fitting keep node text readable by applying a user-configurable minimum readable font size, while leaving manual zoom unrestricted.

**Architecture:** Store graph display preferences separately from provider config through the existing extension settings store. The sidepanel loads those preferences into a focused hook, passes them to the settings UI, and uses them only when automatic fit/reset view calls React Flow `fitView`. Manual React Flow zoom keeps the existing `minZoom`.

**Tech Stack:** TypeScript, React 18, React Flow v11, Chrome extension runtime messaging, Dexie settings repository, Vitest + Testing Library.

---

## File Structure

- Create: `packages/schema/src/display-settings.ts`: add shared graph display settings type.
- Modify `packages/schema/src/index.ts`: export graph display settings type.
- Modify `apps/extension/src/shared/messages.ts`: add `GET_GRAPH_DISPLAY_SETTINGS` / `SAVE_GRAPH_DISPLAY_SETTINGS` messages.
- Modify `packages/storage/src/repositories.ts`: add typed graph display settings get/save helpers on the generic settings repository.
- Create `apps/extension/src/service-worker/graph-display-settings.ts`: normalize defaults and handle graph display settings messages.
- Modify `apps/extension/src/service-worker/index.ts`: route the new messages to the new handlers.
- Modify `apps/extension/src/service-worker/sw-types.ts`: allow service worker responses to include graph display settings.
- Create `apps/extension/src/sidepanel/hooks/useGraphDisplaySettings.ts`: load, edit, and save graph display preferences independently from provider config.
- Modify `apps/extension/src/sidepanel/SettingsPanel.tsx`: render the “图谱显示” setting and expose a change callback.
- Modify `apps/extension/src/sidepanel/App.tsx`: load the hook, pass settings into the panel, add an “适配视图” button, and apply the readable zoom floor only to auto fit/reset fit.
- Modify `apps/extension/src/sidepanel/__test-helpers__/app-test-helpers.tsx`: extend runtime message defaults for graph display settings.
- Modify tests:
  - `apps/extension/src/service-worker/storage-contract.test.ts`
  - `apps/extension/src/service-worker/worker-graph-display-settings.test.ts`
  - `apps/extension/src/sidepanel/App.settings.test.tsx`
  - `apps/extension/src/sidepanel/App.graph-updates.test.tsx`

Do not commit unless the user explicitly asks for a commit.

---

### Task 1: Add Graph Display Settings Contract And Persistence

**Files:**
- Create: `packages/schema/src/display-settings.ts`
- Modify: `packages/schema/src/index.ts`
- Modify: `apps/extension/src/shared/messages.ts`
- Modify: `packages/storage/src/repositories.ts`
- Create: `apps/extension/src/service-worker/graph-display-settings.ts`
- Modify: `apps/extension/src/service-worker/index.ts`
- Modify: `apps/extension/src/service-worker/sw-types.ts`
- Test: `apps/extension/src/service-worker/storage-contract.test.ts`
- Test: `apps/extension/src/service-worker/worker-graph-display-settings.test.ts`

- [ ] **Step 1: Add failing storage contract test**

Add this test to `apps/extension/src/service-worker/storage-contract.test.ts` near the existing settings repository tests:

```ts
it('settings repository 可以保存图谱显示配置', async () => {
  const repository = createSettingsRepository({
    settings: settingsTable,
  });

  await repository.saveGraphDisplaySettings({
    autoFitMinReadableFontPx: 14,
  });

  await expect(repository.getGraphDisplaySettings()).resolves.toEqual({
    autoFitMinReadableFontPx: 14,
  });
});
```

- [ ] **Step 2: Run storage test and verify failure**

Run:

```bash
pnpm --filter extension test:run src/service-worker/storage-contract.test.ts
```

Expected: fail because `saveGraphDisplaySettings` and `getGraphDisplaySettings` do not exist yet.

- [ ] **Step 3: Add shared settings type and messages**

Create `packages/schema/src/display-settings.ts`:

```ts
export interface GraphDisplaySettings {
  autoFitMinReadableFontPx: 10 | 12 | 14 | 16;
}
```

In `packages/schema/src/index.ts`, add:

```ts
export * from './display-settings';
```

In `apps/extension/src/shared/messages.ts`, update the schema import block:

```ts
import type {
  GraphDisplaySettings,
  MergedGraph,
  ProviderConfig,
  ProviderRuntimeSummary,
  SerializableProviderError,
  SegmentGraph,
  StructurerResponseDiagnostics,
  TranscriptChunk,
} from '@listen-graphic/schema';
```

Extend the `AppMessage` union near provider settings messages:

```ts
  | {
      type: 'GET_GRAPH_DISPLAY_SETTINGS';
      target: 'service-worker';
      payload: {};
    }
  | {
      type: 'SAVE_GRAPH_DISPLAY_SETTINGS';
      target: 'service-worker';
      payload: { settings: GraphDisplaySettings };
    }
```

- [ ] **Step 4: Add repository helpers**

In `packages/storage/src/repositories.ts`, update imports:

```ts
import type {
  GraphDisplaySettings,
  MergedGraph,
  ProviderConfig,
  SegmentGraph,
  TranscriptChunk,
} from '@listen-graphic/schema';
```

Then add a key next to `PROVIDER_CONFIG_KEY`:

```ts
const GRAPH_DISPLAY_SETTINGS_KEY = 'graph-display-settings';
```

Inside `createSettingsRepository`, add:

```ts
    async getGraphDisplaySettings() {
      return this.get<GraphDisplaySettings>(GRAPH_DISPLAY_SETTINGS_KEY);
    },
    async saveGraphDisplaySettings(settings: GraphDisplaySettings) {
      await this.set(GRAPH_DISPLAY_SETTINGS_KEY, settings);
    },
```

- [ ] **Step 5: Add service worker handlers**

Create `apps/extension/src/service-worker/graph-display-settings.ts`:

```ts
import type { GraphDisplaySettings } from '../shared/messages';
import type { ServiceWorkerResponse } from './sw-types';

export const DEFAULT_GRAPH_DISPLAY_SETTINGS: GraphDisplaySettings = {
  autoFitMinReadableFontPx: 12,
};

const ALLOWED_AUTO_FIT_FONT_SIZES = new Set([10, 12, 14, 16]);

export interface GraphDisplaySettingsDeps {
  settingsRepository: {
    getGraphDisplaySettings(): Promise<GraphDisplaySettings | null | undefined>;
    saveGraphDisplaySettings(settings: GraphDisplaySettings): Promise<void>;
  };
}

export function normalizeGraphDisplaySettings(
  settings: Partial<GraphDisplaySettings> | null | undefined,
): GraphDisplaySettings {
  const requested = settings?.autoFitMinReadableFontPx;
  return {
    autoFitMinReadableFontPx: ALLOWED_AUTO_FIT_FONT_SIZES.has(requested ?? 0)
      ? requested as GraphDisplaySettings['autoFitMinReadableFontPx']
      : DEFAULT_GRAPH_DISPLAY_SETTINGS.autoFitMinReadableFontPx,
  };
}

export async function handleGetGraphDisplaySettings(
  deps: GraphDisplaySettingsDeps,
): Promise<ServiceWorkerResponse> {
  const storedSettings = await deps.settingsRepository.getGraphDisplaySettings();
  return {
    success: true,
    graphDisplaySettings: normalizeGraphDisplaySettings(storedSettings),
  };
}

export async function handleSaveGraphDisplaySettings(
  settings: GraphDisplaySettings,
  deps: GraphDisplaySettingsDeps,
): Promise<ServiceWorkerResponse> {
  const normalized = normalizeGraphDisplaySettings(settings);
  await deps.settingsRepository.saveGraphDisplaySettings(normalized);
  return {
    success: true,
    graphDisplaySettings: normalized,
  };
}
```

- [ ] **Step 6: Wire service worker message routing**

In `apps/extension/src/service-worker/sw-types.ts`, add:

```ts
  graphDisplaySettings?: import('../shared/messages').GraphDisplaySettings;
```

In `apps/extension/src/service-worker/index.ts`, import:

```ts
import {
  handleGetGraphDisplaySettings,
  handleSaveGraphDisplaySettings,
} from './graph-display-settings';
```

Add the switch cases after provider settings:

```ts
    case 'GET_GRAPH_DISPLAY_SETTINGS':
      return handleGetGraphDisplaySettings({ settingsRepository });
    case 'SAVE_GRAPH_DISPLAY_SETTINGS':
      return handleSaveGraphDisplaySettings(message.payload.settings, {
        settingsRepository,
      });
```

- [ ] **Step 7: Add service worker message tests**

Create `apps/extension/src/service-worker/worker-graph-display-settings.test.ts` following the mocking style in `worker-provider-settings.test.ts`. Include these cases:

```ts
it('返回默认图谱显示设置', async () => {
  const response = await handleMessage({
    type: 'GET_GRAPH_DISPLAY_SETTINGS',
    target: 'service-worker',
    payload: {},
  } as AppMessage);

  expect(response).toMatchObject({
    success: true,
    graphDisplaySettings: {
      autoFitMinReadableFontPx: 12,
    },
  });
});

it('保存图谱显示设置时会归一化允许的字号', async () => {
  const response = await handleMessage({
    type: 'SAVE_GRAPH_DISPLAY_SETTINGS',
    target: 'service-worker',
    payload: {
      settings: {
        autoFitMinReadableFontPx: 14,
      },
    },
  } as AppMessage);

  expect(response).toMatchObject({
    success: true,
    graphDisplaySettings: {
      autoFitMinReadableFontPx: 14,
    },
  });
});
```

If importing `handleMessage` is not available in the current test structure, test `handleGetGraphDisplaySettings`, `handleSaveGraphDisplaySettings`, and `normalizeGraphDisplaySettings` directly in a focused unit test.

- [ ] **Step 8: Run contract tests**

Run:

```bash
pnpm --filter extension test:run src/service-worker/storage-contract.test.ts src/service-worker/worker-graph-display-settings.test.ts
```

Expected: pass.

---

### Task 2: Add Sidepanel Graph Display Settings UI

**Files:**
- Create: `apps/extension/src/sidepanel/hooks/useGraphDisplaySettings.ts`
- Modify: `apps/extension/src/sidepanel/SettingsPanel.tsx`
- Modify: `apps/extension/src/sidepanel/App.tsx`
- Modify: `apps/extension/src/sidepanel/__test-helpers__/app-test-helpers.tsx`
- Test: `apps/extension/src/sidepanel/App.settings.test.tsx`

- [ ] **Step 1: Add failing settings UI test**

Add a test to `App.settings.test.tsx`:

```ts
it('设置面板可以加载并保存自动适配最小字号', async () => {
  const user = userEvent.setup();
  const messages: Array<{ type?: string; payload?: unknown }> = [];

  (globalThis as any).chrome.runtime.sendMessage.mockImplementation(
    (message: { type?: string; payload?: unknown }) => {
      messages.push(message);
      if (message?.type === 'GET_RUNTIME_SNAPSHOT') {
        return Promise.resolve({
          success: true,
          snapshot: {
            sessionId: null,
            state: 'idle',
            graph: null,
            currentTimeMs: 0,
          },
        });
      }
      if (message?.type === 'GET_PROVIDER_SETTINGS') {
        return Promise.resolve({
          success: true,
          config: {
            asr: { type: 'mock', mode: 'direct', model: 'mock-asr', language: 'zh' },
            structurer: { type: 'mock', mode: 'direct', model: 'mock-structurer', language: 'zh' },
          },
        });
      }
      if (message?.type === 'GET_GRAPH_DISPLAY_SETTINGS') {
        return Promise.resolve({
          success: true,
          graphDisplaySettings: {
            autoFitMinReadableFontPx: 14,
          },
        });
      }
      return Promise.resolve({ success: true });
    },
  );

  await renderApp();
  await act(async () => {
    await user.click(screen.getByRole('button', { name: /^设置$/ }));
  });

  const settingsPanel = await screen.findByTestId('settings-panel');
  const readableFontSelect = within(settingsPanel).getByLabelText('自动适配最小字号');
  expect(readableFontSelect).toHaveValue('14');

  await act(async () => {
    await user.selectOptions(readableFontSelect, '12');
    await user.click(within(settingsPanel).getByRole('button', { name: /保存设置/i }));
  });

  expect(messages).toContainEqual({
    type: 'SAVE_GRAPH_DISPLAY_SETTINGS',
    target: 'service-worker',
    payload: {
      settings: {
        autoFitMinReadableFontPx: 12,
      },
    },
  });
});
```

- [ ] **Step 2: Run settings UI test and verify failure**

Run:

```bash
pnpm --filter extension test:run src/sidepanel/App.settings.test.tsx -t "自动适配最小字号"
```

Expected: fail because the hook, message, and UI field do not exist yet.

- [ ] **Step 3: Create graph display settings hook**

Create `apps/extension/src/sidepanel/hooks/useGraphDisplaySettings.ts`:

```ts
import { useCallback, useState } from 'react';
import type {
  AppMessage,
  GraphDisplaySettings,
} from '../../shared/messages';

export const DEFAULT_GRAPH_DISPLAY_SETTINGS: GraphDisplaySettings = {
  autoFitMinReadableFontPx: 12,
};

interface UseGraphDisplaySettingsOptions {
  addLog: (msg: string) => void;
}

function normalizeGraphDisplaySettings(
  settings: Partial<GraphDisplaySettings> | null | undefined,
): GraphDisplaySettings {
  const value = settings?.autoFitMinReadableFontPx;
  return {
    autoFitMinReadableFontPx:
      value === 10 || value === 12 || value === 14 || value === 16
        ? value
        : DEFAULT_GRAPH_DISPLAY_SETTINGS.autoFitMinReadableFontPx,
  };
}

export function useGraphDisplaySettings({
  addLog,
}: UseGraphDisplaySettingsOptions) {
  const [graphDisplaySettings, setGraphDisplaySettings] =
    useState<GraphDisplaySettings>(DEFAULT_GRAPH_DISPLAY_SETTINGS);
  const [graphDisplaySettingsSaving, setGraphDisplaySettingsSaving] =
    useState(false);

  const loadGraphDisplaySettings = useCallback(async () => {
    try {
      const response = (await chrome.runtime.sendMessage({
        type: 'GET_GRAPH_DISPLAY_SETTINGS',
        target: 'service-worker',
        payload: {},
      } as AppMessage)) as
        | { success: true; graphDisplaySettings?: GraphDisplaySettings }
        | { success: false; error?: string };

      if (!response?.success) {
        addLog(`加载图谱显示设置失败: ${response?.error || '未知错误'}`);
        return;
      }

      setGraphDisplaySettings(
        normalizeGraphDisplaySettings(response.graphDisplaySettings),
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : '读取图谱显示设置失败';
      addLog(`加载图谱显示设置失败: ${message}`);
    }
  }, [addLog]);

  const updateAutoFitMinReadableFontPx = useCallback((value: string) => {
    const numericValue = Number(value);
    setGraphDisplaySettings(
      normalizeGraphDisplaySettings({
        autoFitMinReadableFontPx: numericValue as GraphDisplaySettings['autoFitMinReadableFontPx'],
      }),
    );
  }, []);

  const saveGraphDisplaySettings = useCallback(async () => {
    setGraphDisplaySettingsSaving(true);
    try {
      const response = (await chrome.runtime.sendMessage({
        type: 'SAVE_GRAPH_DISPLAY_SETTINGS',
        target: 'service-worker',
        payload: {
          settings: graphDisplaySettings,
        },
      } as AppMessage)) as
        | { success: true; graphDisplaySettings?: GraphDisplaySettings }
        | { success: false; error?: string };

      if (!response?.success) {
        addLog(`保存图谱显示设置失败: ${response?.error || '未知错误'}`);
        return;
      }

      setGraphDisplaySettings(
        normalizeGraphDisplaySettings(response.graphDisplaySettings),
      );
      addLog('图谱显示设置已保存');
    } catch (error) {
      const message =
        error instanceof Error ? error.message : '保存图谱显示设置失败';
      addLog(`保存图谱显示设置失败: ${message}`);
    } finally {
      setGraphDisplaySettingsSaving(false);
    }
  }, [addLog, graphDisplaySettings]);

  return {
    graphDisplaySettings,
    graphDisplaySettingsSaving,
    loadGraphDisplaySettings,
    updateAutoFitMinReadableFontPx,
    saveGraphDisplaySettings,
  };
}
```

- [ ] **Step 4: Wire hook into App settings open/save**

In `App.tsx`, import:

```ts
import { useGraphDisplaySettings } from './hooks/useGraphDisplaySettings';
```

Inside `App`, after `useProviderSettings`, add:

```ts
  const {
    graphDisplaySettings,
    graphDisplaySettingsSaving,
    loadGraphDisplaySettings,
    updateAutoFitMinReadableFontPx,
    saveGraphDisplaySettings,
  } = useGraphDisplaySettings({ addLog });
```

Create a combined settings toggle:

```ts
  const handleToggleAllSettings = useCallback(async () => {
    const willOpen = !settingsOpen;
    await handleToggleSettings();
    if (willOpen) {
      await loadGraphDisplaySettings();
    }
  }, [handleToggleSettings, loadGraphDisplaySettings, settingsOpen]);
```

Create a combined save handler:

```ts
  const handleSaveAllSettings = useCallback(async () => {
    await handleSaveSettings();
    await saveGraphDisplaySettings();
  }, [handleSaveSettings, saveGraphDisplaySettings]);
```

Change the settings button:

```tsx
<button onClick={() => void handleToggleAllSettings()}
```

Pass these props to `SettingsPanel`:

```tsx
          graphDisplaySettings={graphDisplaySettings}
          settingsSaving={settingsSaving || graphDisplaySettingsSaving}
          onUpdateAutoFitMinReadableFontPx={updateAutoFitMinReadableFontPx}
          onSaveSettings={handleSaveAllSettings}
```

- [ ] **Step 5: Add SettingsPanel props and UI**

In `SettingsPanel.tsx`, import `GraphDisplaySettings`:

```ts
import type {
  GraphDisplaySettings,
} from '../shared/messages';
```

Extend props:

```ts
  graphDisplaySettings: GraphDisplaySettings;
  onUpdateAutoFitMinReadableFontPx: (value: string) => void;
```

Render this card before the footer summary:

```tsx
      <div
        style={{
          gridColumn: '1 / -1',
          border: '1px solid #dbe4ee',
          borderRadius: 6,
          padding: 10,
          backgroundColor: 'white',
          display: 'grid',
          gap: 6,
        }}
      >
        <div style={{ fontWeight: 600 }}>图谱显示</div>
        <label style={{ display: 'grid', gap: 4 }}>
          <span>自动适配最小字号</span>
          <select
            aria-label="自动适配最小字号"
            value={String(graphDisplaySettings.autoFitMinReadableFontPx)}
            onChange={(event) =>
              onUpdateAutoFitMinReadableFontPx(event.target.value)
            }
          >
            <option value="10">10px</option>
            <option value="12">12px</option>
            <option value="14">14px</option>
            <option value="16">16px</option>
          </select>
        </label>
        <div style={{ color: '#64748b', fontSize: 10, lineHeight: 1.5 }}>
          只影响首次自动适配和手动适配视图；鼠标滚轮、触控板和 React Flow 控件缩放不受限制。
        </div>
      </div>
```

- [ ] **Step 6: Update test helper default messages**

In `app-test-helpers.tsx`, add to the default `sendMessage` mock:

```ts
      if (message?.type === 'GET_GRAPH_DISPLAY_SETTINGS') {
        return Promise.resolve({
          success: true,
          graphDisplaySettings: {
            autoFitMinReadableFontPx: 12,
          },
        });
      }
```

- [ ] **Step 7: Run settings test**

Run:

```bash
pnpm --filter extension test:run src/sidepanel/App.settings.test.tsx -t "自动适配最小字号"
```

Expected: pass.

---

### Task 3: Apply Readable Zoom Floor To Auto Fit And Reset View

**Files:**
- Modify: `apps/extension/src/sidepanel/App.tsx`
- Test: `apps/extension/src/sidepanel/App.graph-updates.test.tsx`

- [ ] **Step 1: Add failing auto fit test**

In `App.graph-updates.test.tsx`, add a test that loads a graph and graph display settings of `14px`, then asserts auto fit uses `minZoom: 14 / 12`:

```ts
it('首次自动适配会使用最小可读字号换算出的 minZoom', async () => {
  (globalThis as any).chrome.runtime.sendMessage.mockImplementation(
    (message: { type?: string }) => {
      if (message?.type === 'GET_RUNTIME_SNAPSHOT') {
        return Promise.resolve({
          success: true,
          snapshot: {
            sessionId: 'session_readable_fit',
            state: 'capturing',
            currentTimeMs: 0,
            currentView: 'timeline',
            currentViewPinned: false,
            graph: {
              sessionId: 'session_readable_fit',
              revision: 1,
              topics: [],
              nodes: [
                {
                  id: 'n1',
                  type: 'claim',
                  text: '需要保持可读的节点',
                  timestampMs: 0,
                  status: 'confirmed',
                },
              ],
              edges: [],
              viewHints: {
                defaultView: 'timeline',
                scores: {
                  timeline: 1,
                  causal: 0,
                  comparison: 0,
                  flow: 0,
                  hierarchy: 0,
                },
              },
              updatedAt: 100,
            },
          },
        });
      }
      if (message?.type === 'GET_GRAPH_DISPLAY_SETTINGS') {
        return Promise.resolve({
          success: true,
          graphDisplaySettings: {
            autoFitMinReadableFontPx: 14,
          },
        });
      }
      return Promise.resolve({ success: true });
    },
  );

  await renderApp();

  expect(reactFlowFitViewSpy).toHaveBeenCalledWith(
    expect.objectContaining({
      minZoom: 14 / 12,
    }),
  );
});
```

- [ ] **Step 2: Run auto fit test and verify failure**

Run:

```bash
pnpm --filter extension test:run src/sidepanel/App.graph-updates.test.tsx -t "最小可读字号"
```

Expected: fail because `requestAutoFit` does not pass `minZoom`.

- [ ] **Step 3: Add readable zoom helper in App**

Near the `nodeTypes` constant in `App.tsx`, add:

```ts
const GRAPH_NODE_BODY_FONT_PX = 12;
const AUTO_FIT_PADDING = 0.16;
const AUTO_FIT_DURATION_MS = 240;

function getReadableAutoFitMinZoom(readableFontPx: number) {
  return readableFontPx / GRAPH_NODE_BODY_FONT_PX;
}
```

- [ ] **Step 4: Load graph display settings before auto fit**

Add a mount effect after the graph display settings hook:

```ts
  useEffect(() => {
    void loadGraphDisplaySettings();
  }, [loadGraphDisplaySettings]);
```

This ensures auto fit has persisted display settings even if the settings panel has never been opened. The default remains `12px` while the async load is pending.

- [ ] **Step 5: Update requestAutoFit**

Change `requestAutoFit` signature:

```ts
    (options?: {
      sizeHint?: { width: number; height: number };
      force?: boolean;
    }) => {
      if (!panel.graph.nodes.length || (!options?.force && hasAutoFitRef.current)) return;
      const inst = reactFlowInstanceRef.current;
      if (!inst?.fitView) return;
      const el = flowContainerRef.current;
      const w = options?.sizeHint?.width ?? el?.clientWidth ?? 0;
      const h = options?.sizeHint?.height ?? el?.clientHeight ?? 0;
      if (w < 2 || h < 2) return;
      inst.fitView({
        padding: AUTO_FIT_PADDING,
        duration: AUTO_FIT_DURATION_MS,
        minZoom: getReadableAutoFitMinZoom(
          graphDisplaySettings.autoFitMinReadableFontPx,
        ),
      });
      hasAutoFitRef.current = true;
    },
    [graphDisplaySettings.autoFitMinReadableFontPx, panel.graph.nodes.length],
```

Update call sites:

```ts
  useLayoutEffect(() => { requestAutoFit(); }, [requestAutoFit]);
```

ResizeObserver call:

```ts
      requestAutoFit({
        sizeHint: {
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        },
      });
```

`onInit` stays:

```ts
            queueMicrotask(() => requestAutoFit());
```

- [ ] **Step 6: Add manual reset fit button**

In the view controls row near sort controls, add:

```tsx
          <button
            onClick={() => requestAutoFit({ force: true })}
            disabled={panel.graph.nodes.length === 0}
            style={{
              padding: '2px 6px',
              borderRadius: 3,
              fontSize: 10,
              border: '1px solid #e5e7eb',
              backgroundColor: panel.graph.nodes.length === 0 ? '#f3f4f6' : 'white',
              color: '#6b7280',
              cursor: panel.graph.nodes.length === 0 ? 'not-allowed' : 'pointer',
            }}
          >
            适配视图
          </button>
```

This button reuses the same readable `minZoom` rule and does not alter React Flow `minZoom`.

- [ ] **Step 7: Add reset view test**

In `App.graph-updates.test.tsx`, add:

```ts
it('适配视图按钮会复用最小可读字号约束', async () => {
  const user = userEvent.setup();

  (globalThis as any).chrome.runtime.sendMessage.mockImplementation(
    (message: { type?: string }) => {
      if (message?.type === 'GET_RUNTIME_SNAPSHOT') {
        return Promise.resolve({
          success: true,
          snapshot: {
            sessionId: 'session_reset_readable_fit',
            state: 'capturing',
            currentTimeMs: 0,
            currentView: 'timeline',
            currentViewPinned: false,
            graph: {
              sessionId: 'session_reset_readable_fit',
              revision: 1,
              topics: [],
              nodes: [
                {
                  id: 'n1',
                  type: 'claim',
                  text: '节点一',
                  timestampMs: 0,
                  status: 'confirmed',
                },
              ],
              edges: [],
              viewHints: {
                defaultView: 'timeline',
                scores: {
                  timeline: 1,
                  causal: 0,
                  comparison: 0,
                  flow: 0,
                  hierarchy: 0,
                },
              },
              updatedAt: 100,
            },
          },
        });
      }
      if (message?.type === 'GET_GRAPH_DISPLAY_SETTINGS') {
        return Promise.resolve({
          success: true,
          graphDisplaySettings: {
            autoFitMinReadableFontPx: 16,
          },
        });
      }
      return Promise.resolve({ success: true });
    },
  );

  await renderApp();
  reactFlowFitViewSpy.mockClear();

  await act(async () => {
    await user.click(screen.getByRole('button', { name: '适配视图' }));
  });

  expect(reactFlowFitViewSpy).toHaveBeenCalledWith(
    expect.objectContaining({
      minZoom: 16 / 12,
    }),
  );
});
```

Ensure `userEvent` is imported in the test file if it is not already imported:

```ts
import userEvent from '@testing-library/user-event';
```

- [ ] **Step 8: Run graph update tests**

Run:

```bash
pnpm --filter extension test:run src/sidepanel/App.graph-updates.test.tsx
```

Expected: pass, including the existing “不再次 fitView” test. Keep the no-repeat behavior unchanged.

---

### Task 4: Full Verification And Documentation Check

**Files:**
- Modify: `docs/superpowers/specs/2026-05-15-readable-auto-fit-font-design.md` only if implementation reveals a needed clarification.

- [ ] **Step 1: Run focused sidepanel and service worker tests**

Run:

```bash
pnpm --filter extension test:run src/sidepanel/App.settings.test.tsx src/sidepanel/App.graph-updates.test.tsx src/service-worker/storage-contract.test.ts src/service-worker/worker-graph-display-settings.test.ts
```

Expected: pass.

- [ ] **Step 2: Run extension typecheck**

Run:

```bash
pnpm --filter extension typecheck
```

Expected: pass with no TypeScript errors.

- [ ] **Step 3: Run complete extension test suite**

Run:

```bash
pnpm --filter extension test:run
```

Expected: pass. If unrelated existing tests fail, capture the failing test names and error snippets instead of changing unrelated behavior.

- [ ] **Step 4: Manual behavior checklist**

Use the extension sidepanel after `pnpm dev:ext`:

```bash
pnpm dev:ext
```

Check:

- Settings panel shows `图谱显示` and `自动适配最小字号`.
- Saving `10px`, `12px`, `14px`, or `16px` persists after reopening the sidepanel.
- First graph appearance uses readable auto fit.
- `适配视图` uses the same readable auto fit.
- Manual wheel/trackpad zoom can still shrink below the readable auto fit level because React Flow `minZoom` remains unchanged.

---

## Self-Review

- Spec coverage: auto fit readable floor is implemented in Task 3; settings UI is implemented in Task 2; settings persistence is implemented in Task 1; manual zoom remains unrestricted because React Flow `minZoom` is not changed.
- No unresolved placeholders remain.
- Type consistency: `GraphDisplaySettings.autoFitMinReadableFontPx` is used consistently across messages, service worker handlers, hook state, settings UI, and auto fit calculation.
- Scope stays focused on font readability for automatic fit/reset view; semantic layout, node padding, dagre/elk, and DOM measurement remain outside this plan.
