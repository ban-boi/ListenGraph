import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { act, type ReactNode } from 'react';

vi.mock('reactflow', () => ({
  ReactFlow: ({
    children,
    nodes = [],
    onNodeClick,
  }: {
    children?: ReactNode;
    nodes?: Array<{ id: string; data?: { label?: string; timestampMs?: number } }>;
    onNodeClick?: (_event: React.MouseEvent, node: any) => void;
  }) => (
    <div data-testid="reactflow-mock">
      {nodes.map((node) => (
        <button
          key={node.id}
          type="button"
          onClick={(event) => onNodeClick?.(event as unknown as React.MouseEvent, node)}
        >
          {node.data?.label}
        </button>
      ))}
      {children}
    </div>
  ),
  Background: () => <div data-testid="reactflow-background" />,
  Controls: () => <div data-testid="reactflow-controls" />,
  Handle: () => null,
  Position: {
    Top: 'top',
    Bottom: 'bottom',
    Left: 'left',
    Right: 'right',
  },
}));

import App from '../sidepanel/App';

async function renderApp() {
  render(<App />);
  await act(async () => {
    await Promise.resolve();
  });
}

describe('App 组件', () => {
  let consoleErrorSpy: any;
  let consoleWarnSpy: any;
  let stderrWriteSpy: any;
  let originalConsoleError: typeof console.error;
  let originalConsoleWarn: typeof console.warn;
  let originalStderrWrite: typeof process.stderr.write;
  let createObjectURLSpy: any;
  let revokeObjectURLSpy: any;
  let anchorClickSpy: any;

  beforeEach(() => {
    vi.clearAllMocks();
    originalConsoleError = console.error;
    originalConsoleWarn = console.warn;
    originalStderrWrite = process.stderr.write.bind(process.stderr);
    consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation((...args: unknown[]) => {
        const text = args.join(' ');
        if (text.includes('ReactDOMTestUtils.act is deprecated')) {
          return;
        }
        originalConsoleError(...(args as Parameters<typeof console.error>));
      });
    consoleWarnSpy = vi
      .spyOn(console, 'warn')
      .mockImplementation((...args: unknown[]) => {
        const text = args.join(' ');
        if (text.includes('ReactDOMTestUtils.act is deprecated')) {
          return;
        }
        originalConsoleWarn(...(args as Parameters<typeof console.warn>));
      });
    stderrWriteSpy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(((chunk: unknown, ...rest: unknown[]) => {
        const text = String(chunk);
        if (text.includes('ReactDOMTestUtils.act')) {
          return true;
        }
        return originalStderrWrite(
          chunk as Parameters<typeof process.stderr.write>[0],
          ...(rest as Parameters<typeof process.stderr.write>[1][]),
        );
      }) as typeof process.stderr.write);
    (globalThis as any).chrome.runtime.sendMessage.mockImplementation(
      (message: { type?: string }) => {
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
        return Promise.resolve({ success: true });
      },
    );
    createObjectURLSpy = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValue('blob:listen-graphic-export');
    revokeObjectURLSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    anchorClickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    consoleErrorSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    stderrWriteSpy.mockRestore();
    createObjectURLSpy.mockRestore();
    revokeObjectURLSpy.mockRestore();
    anchorClickSpy.mockRestore();
  });

  it('应该渲染日志区域', async () => {
    await renderApp();

    // 检查日志区域是否存在
    const logArea = screen.getByTestId('log-area');
    expect(logArea).toBeInTheDocument();
  });

  it('应该显示日志区域内容', async () => {
    await renderApp();

    // 空状态应该显示当前实现的占位文案
    const logArea = screen.getByTestId('log-area');
    expect(logArea).toBeInTheDocument();
    const logContent = screen.getByText(/点击"开始"启动会话|标签页 ID/i);
    expect(logContent).toBeInTheDocument();
  });

  it('应该渲染开始/停止按钮', async () => {
    await renderApp();

    // 检查按钮是否存在
    const startButton = screen.getByRole('button', { name: /开始/i });
    expect(startButton).toBeInTheDocument();
  });

  it('应该渲染视图切换按钮', async () => {
    await renderApp();

    // 检查视图按钮是否存在
    expect(screen.getByText('因果')).toBeInTheDocument();
    expect(screen.getByText('时间线')).toBeInTheDocument();
  });

  it('应该渲染底部状态栏', async () => {
    await renderApp();

    // 检查状态栏
    expect(screen.getByText(/节点: 0/)).toBeInTheDocument();
    expect(screen.getByText(/边: 0/)).toBeInTheDocument();
  });

  it('点击开始按钮后应该改变状态', async () => {
    const user = userEvent.setup();
    await renderApp();

    // 点击开始按钮
    const startButton = screen.getByRole('button', { name: /开始/i });
    await act(async () => {
      await user.click(startButton);
    });

    const stopButton = await waitFor(() =>
      screen.getByRole('button', { name: /停止/i }),
    );
    expect(stopButton).toBeInTheDocument();
  });

  it('展开设置面板后会拉取并展示 provider 配置', async () => {
    (globalThis as any).chrome.runtime.sendMessage.mockImplementation(
      (message: { type?: string }) => {
        if (message?.type === 'GET_RUNTIME_SNAPSHOT') {
          return Promise.resolve({
            success: true,
            snapshot: {
              sessionId: null,
              state: 'idle',
              graph: null,
              currentTimeMs: 0,
              providerSummary: {
                asr: {
                  type: 'mock',
                  mode: 'direct',
                  model: 'mock-asr',
                  language: 'zh',
                  apiKeyConfigured: false,
                  sessionTokenConfigured: false,
                },
                structurer: {
                  type: 'mock',
                  mode: 'direct',
                  model: 'mock-structurer',
                  language: 'zh',
                  apiKeyConfigured: false,
                  sessionTokenConfigured: false,
                },
              },
              lastProviderError: null,
            },
          });
        }
        if (message?.type === 'GET_PROVIDER_SETTINGS') {
          return Promise.resolve({
            success: true,
            config: {
              asr: {
                type: 'openai',
                mode: 'direct',
                endpoint: 'https://api.openai.com/v1',
                apiKey: 'secret-asr',
                model: 'gpt-4o-mini-transcribe',
                language: 'zh',
              },
              structurer: {
                type: 'openai',
                mode: 'direct',
                endpoint: 'https://api.openai.com/v1',
                apiKey: 'secret-structurer',
                model: 'gpt-4.1-mini',
                language: 'zh',
              },
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
    expect(settingsPanel).toBeInTheDocument();
    expect(
      within(settingsPanel).getAllByDisplayValue('https://api.openai.com/v1').length,
    ).toBeGreaterThanOrEqual(1);
    expect(
      within(settingsPanel).getByDisplayValue('gpt-4o-mini-transcribe'),
    ).toBeInTheDocument();
  });

  it('保存设置时会把 provider 配置发送给 service worker', async () => {
    (globalThis as any).chrome.runtime.sendMessage.mockImplementation(
      (message: { type?: string; payload?: any }) => {
        if (message?.type === 'GET_RUNTIME_SNAPSHOT') {
          return Promise.resolve({
            success: true,
            snapshot: {
              sessionId: null,
              state: 'idle',
              graph: null,
              currentTimeMs: 0,
              providerSummary: {
                asr: {
                  type: 'mock',
                  mode: 'direct',
                  model: 'mock-asr',
                  language: 'zh',
                  apiKeyConfigured: false,
                  sessionTokenConfigured: false,
                },
                structurer: {
                  type: 'mock',
                  mode: 'direct',
                  model: 'mock-structurer',
                  language: 'zh',
                  apiKeyConfigured: false,
                  sessionTokenConfigured: false,
                },
              },
              lastProviderError: null,
            },
          });
        }
        if (message?.type === 'GET_PROVIDER_SETTINGS') {
          return Promise.resolve({
            success: true,
            config: {
              asr: {
                type: 'mock',
                mode: 'direct',
                model: 'mock-asr',
                language: 'zh',
              },
              structurer: {
                type: 'mock',
                mode: 'direct',
                model: 'mock-structurer',
                language: 'zh',
              },
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
    const endpointInputs = within(settingsPanel).getAllByLabelText(/Endpoint/i);
    const modelInputs = within(settingsPanel).getAllByLabelText(/Model/i);
    const apiKeyInputs = within(settingsPanel).getAllByLabelText(/API Key/i);

    await act(async () => {
      await user.selectOptions(within(settingsPanel).getAllByLabelText(/Provider Type/i)[0], 'openai');
      await user.clear(endpointInputs[0]);
      await user.type(endpointInputs[0], 'https://api.openai.com/v1');
      await user.clear(modelInputs[0]);
      await user.type(modelInputs[0], 'gpt-4o-mini-transcribe');
      await user.clear(apiKeyInputs[0]);
      await user.type(apiKeyInputs[0], 'asr-secret');
      await user.click(within(settingsPanel).getByRole('button', { name: /保存设置/i }));
    });

    expect((globalThis as any).chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'SAVE_PROVIDER_SETTINGS',
        payload: {
          config: expect.objectContaining({
            asr: expect.objectContaining({
              type: 'openai',
              endpoint: 'https://api.openai.com/v1',
              model: 'gpt-4o-mini-transcribe',
              apiKey: 'asr-secret',
            }),
          }),
        },
      }),
    );
  });

  it('冷启动时会从 service worker 恢复会话快照', async () => {
    (globalThis as any).chrome.runtime.sendMessage.mockImplementation(
      (message: { type?: string }) => {
        if (message?.type === 'GET_RUNTIME_SNAPSHOT') {
          return Promise.resolve({
            success: true,
            snapshot: {
              sessionId: 'session_123',
              state: 'capturing',
              currentTimeMs: 30000,
              currentView: 'timeline',
              currentViewPinned: true,
              graph: {
                sessionId: 'session_123',
                revision: 1,
                topics: [],
                nodes: [
                  {
                    id: 'n1',
                    type: 'claim',
                    text: '已恢复的节点',
                    timestampMs: 5000,
                    status: 'confirmed',
                  },
                ],
                edges: [],
                viewHints: {
                  defaultView: 'timeline',
                  scores: {
                    timeline: 3,
                    causal: 0,
                    comparison: 0,
                    flow: 0,
                    hierarchy: 0,
                  },
                },
                updatedAt: Date.now(),
              },
            },
          });
        }
        return Promise.resolve({ success: true });
      },
    );

    await renderApp();

    expect(await screen.findByText(/会话: session_123/)).toBeInTheDocument();
    expect(screen.getByText(/当前时间: 0:30/)).toBeInTheDocument();
    expect(screen.getByText('已恢复的节点')).toBeInTheDocument();
  });

  it('恢复已停止会话资产后切换视图不会再回写 worker', async () => {
    (globalThis as any).chrome.runtime.sendMessage.mockImplementation(
      (message: { type?: string }) => {
        if (message?.type === 'GET_RUNTIME_SNAPSHOT') {
          return Promise.resolve({
            success: true,
            snapshot: {
              sessionId: 'session_history',
              state: 'stopped',
              currentTimeMs: 30000,
              currentView: 'timeline',
              currentViewPinned: false,
              graph: {
                sessionId: 'session_history',
                revision: 1,
                topics: [],
                nodes: [
                  {
                    id: 'n1',
                    type: 'claim',
                    text: '历史节点',
                    timestampMs: 5000,
                    status: 'confirmed',
                  },
                ],
                edges: [],
                viewHints: {
                  defaultView: 'timeline',
                  scores: {
                    timeline: 3,
                    causal: 1,
                    comparison: 2,
                    flow: 0,
                    hierarchy: 0,
                  },
                },
                updatedAt: Date.now(),
              },
            },
          });
        }
        return Promise.resolve({ success: true });
      },
    );
    const user = userEvent.setup();

    await renderApp();
    await act(async () => {
      await user.click(screen.getByRole('button', { name: /对比/i }));
    });

    const messageTypes = (globalThis as any).chrome.runtime.sendMessage.mock.calls.map(
      (call: [{ type?: string }]) => call[0]?.type,
    );
    expect(messageTypes).toEqual(['GET_RUNTIME_SNAPSHOT']);
  });

  it('恢复已停止会话资产后点击节点不会发送 seek 消息', async () => {
    (globalThis as any).chrome.runtime.sendMessage.mockImplementation(
      (message: { type?: string }) => {
        if (message?.type === 'GET_RUNTIME_SNAPSHOT') {
          return Promise.resolve({
            success: true,
            snapshot: {
              sessionId: 'session_history',
              state: 'stopped',
              currentTimeMs: 30000,
              currentView: 'timeline',
              currentViewPinned: false,
              graph: {
                sessionId: 'session_history',
                revision: 1,
                topics: [],
                nodes: [
                  {
                    id: 'n1',
                    type: 'claim',
                    text: '历史节点',
                    timestampMs: 5000,
                    status: 'confirmed',
                  },
                ],
                edges: [],
                viewHints: {
                  defaultView: 'timeline',
                  scores: {
                    timeline: 3,
                    causal: 1,
                    comparison: 2,
                    flow: 0,
                    hierarchy: 0,
                  },
                },
                updatedAt: Date.now(),
              },
            },
          });
        }
        return Promise.resolve({ success: true });
      },
    );
    const user = userEvent.setup();

    await renderApp();
    await act(async () => {
      await user.click(screen.getByRole('button', { name: '历史节点' }));
    });

    const messageTypes = (globalThis as any).chrome.runtime.sendMessage.mock.calls.map(
      (call: [{ type?: string }]) => call[0]?.type,
    );
    expect(messageTypes).toEqual(['GET_RUNTIME_SNAPSHOT']);
  });

  it('点击导出 JSON 后会请求 worker 并触发下载', async () => {
    (globalThis as any).chrome.runtime.sendMessage.mockImplementation(
      (message: { type?: string }) => {
        if (message?.type === 'GET_RUNTIME_SNAPSHOT') {
          return Promise.resolve({
            success: true,
            snapshot: {
              sessionId: 'session_export',
              state: 'stopped',
              currentTimeMs: 30000,
              currentView: 'timeline',
              currentViewPinned: false,
              graph: {
                sessionId: 'session_export',
                revision: 1,
                topics: [],
                nodes: [
                  {
                    id: 'n1',
                    type: 'claim',
                    text: '可导出节点',
                    timestampMs: 0,
                    status: 'confirmed',
                  },
                ],
                edges: [],
                viewHints: {
                  defaultView: 'timeline',
                  scores: {
                    timeline: 3,
                    causal: 1,
                    comparison: 2,
                    flow: 0,
                    hierarchy: 0,
                  },
                },
                updatedAt: Date.now(),
              },
            },
          });
        }
        if (message?.type === 'EXPORT_SESSION') {
          return Promise.resolve({
            success: true,
            exportData: {
              filename: 'session_export.json',
              mimeType: 'application/json',
              content: '{"sessionId":"session_export"}',
            },
          });
        }
        return Promise.resolve({ success: true });
      },
    );
    const user = userEvent.setup();

    await renderApp();
    await act(async () => {
      await user.click(screen.getByRole('button', { name: /导出 JSON/i }));
    });

    expect((globalThis as any).chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'EXPORT_SESSION',
        payload: {
          sessionId: 'session_export',
          format: 'json',
        },
      }),
    );
    expect(URL.createObjectURL).toHaveBeenCalled();
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalled();
  });

  it('收到 stopped 后仍保留最近会话上下文以便立刻导出', async () => {
    const listeners: Array<(message: any) => void> = [];
    (globalThis as any).chrome.runtime.onMessage.addListener.mockImplementation(
      (listener: (message: any) => void) => {
        listeners.push(listener);
      },
    );
    (globalThis as any).chrome.runtime.sendMessage.mockImplementation(
      (message: { type?: string }) => {
        if (message?.type === 'GET_RUNTIME_SNAPSHOT') {
          return Promise.resolve({
            success: true,
            snapshot: {
              sessionId: 'session_live',
              state: 'capturing',
              currentTimeMs: 30000,
              currentView: 'timeline',
              currentViewPinned: false,
              graph: {
                sessionId: 'session_live',
                revision: 1,
                topics: [],
                nodes: [
                  {
                    id: 'n1',
                    type: 'claim',
                    text: '刚停止的节点',
                    timestampMs: 0,
                    status: 'confirmed',
                  },
                ],
                edges: [],
                viewHints: {
                  defaultView: 'timeline',
                  scores: {
                    timeline: 3,
                    causal: 0,
                    comparison: 0,
                    flow: 0,
                    hierarchy: 0,
                  },
                },
                updatedAt: Date.now(),
              },
            },
          });
        }
        if (message?.type === 'EXPORT_SESSION') {
          return Promise.resolve({
            success: true,
            exportData: {
              filename: 'session_live.json',
              mimeType: 'application/json',
              content: '{"ok":true}',
            },
          });
        }
        return Promise.resolve({ success: true });
      },
    );
    const user = userEvent.setup();

    await renderApp();
    await act(async () => {
      listeners[0]?.({
        type: 'SESSION_STATE_CHANGED',
        target: 'sidepanel',
        payload: { sessionId: 'session_live', state: 'stopped' },
      });
      await Promise.resolve();
    });

    expect(screen.getByText(/会话: session_live/)).toBeInTheDocument();
    await act(async () => {
      await user.click(screen.getByRole('button', { name: /导出 JSON/i }));
    });
    expect((globalThis as any).chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'EXPORT_SESSION',
        payload: expect.objectContaining({
          sessionId: 'session_live',
          format: 'json',
        }),
      }),
    );
  });

  it('点击停止后会等待 stopped 广播，再恢复可导出状态', async () => {
    const listeners: Array<(message: any) => void> = [];
    (globalThis as any).chrome.runtime.onMessage.addListener.mockImplementation(
      (listener: (message: any) => void) => {
        listeners.push(listener);
      },
    );
    (globalThis as any).chrome.runtime.sendMessage.mockImplementation(
      (message: { type?: string }) => {
        if (message?.type === 'GET_RUNTIME_SNAPSHOT') {
          return Promise.resolve({
            success: true,
            snapshot: {
              sessionId: 'session_stop_flow',
              state: 'capturing',
              currentTimeMs: 30000,
              currentView: 'timeline',
              currentViewPinned: false,
              graph: {
                sessionId: 'session_stop_flow',
                revision: 1,
                topics: [],
                nodes: [
                  {
                    id: 'n1',
                    type: 'claim',
                    text: '停止后可导出',
                    timestampMs: 0,
                    status: 'confirmed',
                  },
                ],
                edges: [],
                viewHints: {
                  defaultView: 'timeline',
                  scores: {
                    timeline: 3,
                    causal: 0,
                    comparison: 0,
                    flow: 0,
                    hierarchy: 0,
                  },
                },
                updatedAt: Date.now(),
              },
            },
          });
        }
        if (message?.type === 'EXPORT_SESSION') {
          return Promise.resolve({
            success: true,
            exportData: {
              filename: 'session_stop_flow.json',
              mimeType: 'application/json',
              content: '{"ok":true}',
            },
          });
        }
        return Promise.resolve({ success: true });
      },
    );
    const user = userEvent.setup();

    await renderApp();
    await act(async () => {
      await user.click(screen.getByRole('button', { name: /^停止$/ }));
    });

    expect(screen.getByRole('button', { name: /导出 JSON/i })).toBeDisabled();

    await act(async () => {
      listeners[0]?.({
        type: 'SESSION_STATE_CHANGED',
        target: 'sidepanel',
        payload: { sessionId: 'session_stop_flow', state: 'stopped' },
      });
      await Promise.resolve();
    });

    expect(screen.getByRole('button', { name: /导出 JSON/i })).not.toBeDisabled();
    await act(async () => {
      await user.click(screen.getByRole('button', { name: /导出 JSON/i }));
    });
    expect((globalThis as any).chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'EXPORT_SESSION',
        payload: expect.objectContaining({
          sessionId: 'session_stop_flow',
          format: 'json',
        }),
      }),
    );
  });

  it('transcribing 状态下会禁用导出按钮', async () => {
    (globalThis as any).chrome.runtime.sendMessage.mockImplementation(
      (message: { type?: string }) => {
        if (message?.type === 'GET_RUNTIME_SNAPSHOT') {
          return Promise.resolve({
            success: true,
            snapshot: {
              sessionId: 'session_busy',
              state: 'transcribing',
              currentTimeMs: 30000,
              currentView: 'timeline',
              currentViewPinned: false,
              graph: {
                sessionId: 'session_busy',
                revision: 1,
                topics: [],
                nodes: [
                  {
                    id: 'n1',
                    type: 'claim',
                    text: '处理中节点',
                    timestampMs: 0,
                    status: 'confirmed',
                  },
                ],
                edges: [],
                viewHints: {
                  defaultView: 'timeline',
                  scores: {
                    timeline: 3,
                    causal: 0,
                    comparison: 0,
                    flow: 0,
                    hierarchy: 0,
                  },
                },
                updatedAt: Date.now(),
              },
            },
          });
        }
        return Promise.resolve({ success: true });
      },
    );

    await renderApp();

    expect(screen.getByRole('button', { name: /导出 JSON/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /导出 Markdown/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /导出 Mermaid/i })).toBeDisabled();
  });

  it('展开调试面板后会拉取并展示 session debug 数据', async () => {
    (globalThis as any).chrome.runtime.sendMessage.mockImplementation(
      (message: { type?: string }) => {
        if (message?.type === 'GET_RUNTIME_SNAPSHOT') {
          return Promise.resolve({
            success: true,
            snapshot: {
              sessionId: 'session_debug',
              state: 'stopped',
              currentTimeMs: 30000,
              currentView: 'timeline',
              currentViewPinned: false,
              graph: {
                sessionId: 'session_debug',
                revision: 1,
                topics: [],
                nodes: [
                  {
                    id: 'n1',
                    type: 'claim',
                    text: '调试图节点',
                    timestampMs: 0,
                    status: 'confirmed',
                  },
                ],
                edges: [],
                viewHints: {
                  defaultView: 'timeline',
                  scores: {
                    timeline: 3,
                    causal: 1,
                    comparison: 2,
                    flow: 0,
                    hierarchy: 0,
                  },
                },
                updatedAt: Date.now(),
              },
            },
          });
        }
        if (message?.type === 'GET_DEBUG_SESSION') {
          return Promise.resolve({
            success: true,
            debugData: {
              session: {
                sessionId: 'session_debug',
                sourceType: 'tab',
                createdAt: 100,
                endedAt: 200,
              },
              transcripts: [
                {
                  chunkId: 'chunk_1',
                  sessionId: 'session_debug',
                  text: '第一段调试转写',
                  startMs: 0,
                  endMs: 30000,
                  provider: 'mock-asr',
                },
              ],
              graph: {
                sessionId: 'session_debug',
                revision: 1,
                topics: [],
                nodes: [
                  {
                    id: 'n1',
                    type: 'claim',
                    text: '调试图节点',
                    timestampMs: 0,
                    status: 'confirmed',
                  },
                ],
                edges: [],
                viewHints: {
                  defaultView: 'timeline',
                  scores: {
                    timeline: 3,
                    causal: 1,
                    comparison: 2,
                    flow: 0,
                    hierarchy: 0,
                  },
                },
                updatedAt: 200,
              },
            },
          });
        }
        return Promise.resolve({ success: true });
      },
    );
    const user = userEvent.setup();

    await renderApp();
    await act(async () => {
      await user.click(screen.getByRole('button', { name: /^调试$/ }));
    });

    expect((globalThis as any).chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'GET_DEBUG_SESSION',
        payload: { sessionId: 'session_debug' },
      }),
    );
    const debugPanel = await screen.findByTestId('debug-panel');
    expect(within(debugPanel).getByText(/sessionId: session_debug/)).toBeInTheDocument();
    expect(within(debugPanel).getByText(/transcript chunks: 1/)).toBeInTheDocument();
    expect(within(debugPanel).getByText(/第一段调试转写/)).toBeInTheDocument();
    expect(within(debugPanel).getByText(/调试图节点/)).toBeInTheDocument();
  });

  it('点击回放后会拉取回放资产并显示当前片段', async () => {
    (globalThis as any).chrome.runtime.sendMessage.mockImplementation(
      (message: { type?: string }) => {
        if (message?.type === 'GET_RUNTIME_SNAPSHOT') {
          return Promise.resolve({
            success: true,
            snapshot: {
              sessionId: 'session_replay',
              state: 'stopped',
              currentTimeMs: 60000,
              currentView: 'timeline',
              currentViewPinned: false,
              graph: {
                sessionId: 'session_replay',
                revision: 1,
                topics: [],
                nodes: [
                  {
                    id: 'n1',
                    type: 'claim',
                    text: '回放图节点',
                    timestampMs: 0,
                    status: 'confirmed',
                  },
                ],
                edges: [],
                viewHints: {
                  defaultView: 'timeline',
                  scores: {
                    timeline: 3,
                    causal: 1,
                    comparison: 0,
                    flow: 0,
                    hierarchy: 0,
                  },
                },
                updatedAt: Date.now(),
              },
            },
          });
        }
        if (message?.type === 'GET_REPLAY_SESSION') {
          return Promise.resolve({
            success: true,
            replayData: {
              session: {
                sessionId: 'session_replay',
                sourceType: 'tab',
                createdAt: 100,
                endedAt: 200,
              },
              transcripts: [
                {
                  chunkId: 'chunk_1',
                  sessionId: 'session_replay',
                  text: '第一段回放转写',
                  startMs: 0,
                  endMs: 30000,
                  provider: 'mock-asr',
                },
                {
                  chunkId: 'chunk_2',
                  sessionId: 'session_replay',
                  text: '第二段回放转写',
                  startMs: 30000,
                  endMs: 60000,
                  provider: 'mock-asr',
                },
              ],
              graph: {
                sessionId: 'session_replay',
                revision: 1,
                topics: [],
                nodes: [
                  {
                    id: 'n1',
                    type: 'claim',
                    text: '回放图节点',
                    timestampMs: 0,
                    status: 'confirmed',
                  },
                ],
                edges: [],
                viewHints: {
                  defaultView: 'timeline',
                  scores: {
                    timeline: 3,
                    causal: 1,
                    comparison: 0,
                    flow: 0,
                    hierarchy: 0,
                  },
                },
                updatedAt: 200,
              },
              durationMs: 60000,
            },
          });
        }
        return Promise.resolve({ success: true });
      },
    );
    const user = userEvent.setup();

    await renderApp();
    await act(async () => {
      await user.click(screen.getByRole('button', { name: /^回放$/ }));
    });

    expect((globalThis as any).chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'GET_REPLAY_SESSION',
        payload: { sessionId: 'session_replay' },
      }),
    );
    const replayPanel = await screen.findByTestId('replay-panel');
    expect(replayPanel).toBeInTheDocument();
    expect(within(replayPanel).getByText(/回放时长: 1:00/)).toBeInTheDocument();
    expect(within(replayPanel).getByText(/当前片段: 第一段回放转写/)).toBeInTheDocument();
    expect(within(replayPanel).getByText(/回放当前时间: 0:00/)).toBeInTheDocument();
  });

  it('开始回放后会推进当前时间', async () => {
    vi.useFakeTimers();
    (globalThis as any).chrome.runtime.sendMessage.mockImplementation(
      (message: { type?: string }) => {
        if (message?.type === 'GET_RUNTIME_SNAPSHOT') {
          return Promise.resolve({
            success: true,
            snapshot: {
              sessionId: 'session_replay',
              state: 'stopped',
              currentTimeMs: 0,
              currentView: 'timeline',
              currentViewPinned: false,
              graph: {
                sessionId: 'session_replay',
                revision: 1,
                topics: [],
                nodes: [
                  {
                    id: 'n1',
                    type: 'claim',
                    text: '回放图节点',
                    timestampMs: 0,
                    status: 'confirmed',
                  },
                ],
                edges: [],
                viewHints: {
                  defaultView: 'timeline',
                  scores: {
                    timeline: 3,
                    causal: 1,
                    comparison: 0,
                    flow: 0,
                    hierarchy: 0,
                  },
                },
                updatedAt: Date.now(),
              },
            },
          });
        }
        if (message?.type === 'GET_REPLAY_SESSION') {
          return Promise.resolve({
            success: true,
            replayData: {
              session: {
                sessionId: 'session_replay',
                sourceType: 'tab',
                createdAt: 100,
                endedAt: 200,
              },
              transcripts: [
                {
                  chunkId: 'chunk_1',
                  sessionId: 'session_replay',
                  text: '第一段回放转写',
                  startMs: 0,
                  endMs: 30000,
                  provider: 'mock-asr',
                },
              ],
              graph: {
                sessionId: 'session_replay',
                revision: 1,
                topics: [],
                nodes: [
                  {
                    id: 'n1',
                    type: 'claim',
                    text: '回放图节点',
                    timestampMs: 0,
                    status: 'confirmed',
                  },
                ],
                edges: [],
                viewHints: {
                  defaultView: 'timeline',
                  scores: {
                    timeline: 3,
                    causal: 1,
                    comparison: 0,
                    flow: 0,
                    hierarchy: 0,
                  },
                },
                updatedAt: 200,
              },
              durationMs: 30000,
            },
          });
        }
        return Promise.resolve({ success: true });
      },
    );
    await renderApp();
    await act(async () => {
      screen.getByRole('button', { name: /^回放$/ }).click();
      await Promise.resolve();
    });
    await act(async () => {
      screen.getByRole('button', { name: /^播放$/ }).click();
      await Promise.resolve();
    });
    await act(async () => {
      vi.advanceTimersByTime(1000);
      await Promise.resolve();
    });

    const replayPanel = screen.getByTestId('replay-panel');
    expect(within(replayPanel).getByRole('button', { name: /^暂停$/ })).toBeInTheDocument();
    expect(within(replayPanel).getByText(/回放当前时间: 0:01/)).toBeInTheDocument();
  });

  it('从历史会话开始新采集时会先清空旧上下文，避免误停旧 session', async () => {
    let resolveStart!: (value: unknown) => void;
    (globalThis as any).chrome.runtime.sendMessage.mockImplementation(
      (message: { type?: string }) => {
        if (message?.type === 'GET_RUNTIME_SNAPSHOT') {
          return Promise.resolve({
            success: true,
            snapshot: {
              sessionId: 'session_history',
              state: 'stopped',
              currentTimeMs: 30000,
              currentView: 'timeline',
              currentViewPinned: false,
              graph: {
                sessionId: 'session_history',
                revision: 1,
                topics: [],
                nodes: [
                  {
                    id: 'n1',
                    type: 'claim',
                    text: '历史节点',
                    timestampMs: 0,
                    status: 'confirmed',
                  },
                ],
                edges: [],
                viewHints: {
                  defaultView: 'timeline',
                  scores: {
                    timeline: 3,
                    causal: 1,
                    comparison: 0,
                    flow: 0,
                    hierarchy: 0,
                  },
                },
                updatedAt: Date.now(),
              },
            },
          });
        }
        if (message?.type === 'SESSION_START') {
          return new Promise((resolve) => {
            resolveStart = resolve;
          });
        }
        return Promise.resolve({ success: true });
      },
    );
    const user = userEvent.setup();

    await renderApp();
    await act(async () => {
      await user.click(screen.getByRole('button', { name: /^开始$/ }));
    });

    expect(screen.getByText(/会话: 无/)).toBeInTheDocument();
    expect(screen.getByText(/当前时间: 0:00/)).toBeInTheDocument();
    expect(screen.getByText(/节点: 0/)).toBeInTheDocument();

    await act(async () => {
      await user.click(screen.getByRole('button', { name: /^停止$/ }));
    });

    const sentMessageTypes = (globalThis as any).chrome.runtime.sendMessage.mock.calls.map(
      (call: [{ type?: string }]) => call[0]?.type,
    );
    expect(sentMessageTypes).not.toContain('SESSION_STOP');

    await act(async () => {
      resolveStart({ success: true, sessionId: 'session_live_new' });
      await Promise.resolve();
    });
  });
});
