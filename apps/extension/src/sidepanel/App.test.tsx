import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

  it('拖动日志分割条时会调整日志面板高度', async () => {
    await renderApp();

    const logArea = screen.getByTestId('log-area');
    const resizer = screen.getByTestId('log-resizer');

    expect(logArea).toHaveStyle({ height: '120px' });

    fireEvent.mouseDown(resizer, { clientY: 500 });
    fireEvent.mouseMove(window, { clientY: 440 });
    fireEvent.mouseUp(window);

    expect(logArea).toHaveStyle({ height: '180px' });
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

  it('应该显示 UI 和 Worker 的构建标识', async () => {
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
              workerBuild: {
                version: '0.0.1',
                buildId: '20260330173000',
                label: 'v0.0.1#20260330173000',
              },
            },
          });
        }
        return Promise.resolve({ success: true });
      },
    );

    await renderApp();

    expect(screen.getByTestId('build-info')).toHaveTextContent(
      /UI .* \| Worker v0\.0\.1#20260330173000/,
    );
  });

  it('snapshot 带有 lastProviderError 时会显示顶部最近错误提示', async () => {
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
              lastProviderError: {
                code: 'CONFIG_ERROR',
                message: 'Tencent ASR provider requires secretId and secretKey',
                provider: 'provider-config',
                stage: 'asr',
                retriable: false,
              },
            },
          });
        }
        return Promise.resolve({ success: true });
      },
    );

    await renderApp();

    const banner = screen.getByTestId('recent-error-banner');
    expect(banner).toBeInTheDocument();
    expect(within(banner).getByText(/最近错误/)).toBeInTheDocument();
    expect(within(banner).getByText(/ASR \/ CONFIG_ERROR/)).toBeInTheDocument();
    expect(within(banner).getByText(/secretId and secretKey/)).toBeInTheDocument();
  });

  it('收到错误后会显示最近错误提示，后续成功消息会清除', async () => {
    let runtimeMessageListener: ((message: any) => void) | undefined;
    (globalThis as any).chrome.runtime.onMessage.addListener.mockImplementation((listener: any) => {
      runtimeMessageListener = listener;
    });

    await renderApp();
    expect(screen.queryByTestId('recent-error-banner')).not.toBeInTheDocument();

    await act(async () => {
      runtimeMessageListener?.({
        type: 'ERROR',
        target: 'sidepanel',
        payload: {
          code: 'TIMEOUT_ERROR',
          message: 'Structurer request timed out',
        },
      });
      await Promise.resolve();
    });

    const banner = screen.getByTestId('recent-error-banner');
    expect(within(banner).getByText(/Structurer \/ TIMEOUT_ERROR/)).toBeInTheDocument();
    expect(within(banner).getByText(/timed out/)).toBeInTheDocument();

    await act(async () => {
      runtimeMessageListener?.({
        type: 'TRANSCRIPT_READY',
        target: 'sidepanel',
        payload: {
          transcript: {
            chunkId: 'chunk_1',
            sessionId: 'session_1',
            text: '恢复后的转写',
            startMs: 0,
            endMs: 1000,
            provider: 'mock-asr',
          },
        },
      });
      await Promise.resolve();
    });

    expect(screen.queryByTestId('recent-error-banner')).not.toBeInTheDocument();
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
    expect(
      within(settingsPanel).getByRole('option', { name: '智谱 GLM' }),
    ).toBeInTheDocument();
    expect(within(settingsPanel).queryByLabelText('ASR Mode')).not.toBeInTheDocument();
    expect(within(settingsPanel).queryByLabelText('Structurer Mode')).not.toBeInTheDocument();
    expect(within(settingsPanel).queryByLabelText('ASR Session Token')).not.toBeInTheDocument();
    expect(
      within(settingsPanel).queryByLabelText('Structurer Session Token'),
    ).not.toBeInTheDocument();
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
              mode: 'direct',
              endpoint: 'https://api.openai.com/v1',
              model: 'gpt-4o-mini-transcribe',
              apiKey: 'asr-secret',
              sessionToken: undefined,
            }),
          }),
        },
      }),
    );
  });

  it('历史 relay 配置进入设置页后仍会按 direct 形态保存', async () => {
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
                  type: 'openai',
                  mode: 'relay',
                  model: 'gpt-4o-mini-transcribe',
                  language: 'zh',
                  apiKeyConfigured: false,
                  sessionTokenConfigured: true,
                },
                structurer: {
                  type: 'openai',
                  mode: 'relay',
                  model: 'gpt-4.1-mini',
                  language: 'zh',
                  apiKeyConfigured: false,
                  sessionTokenConfigured: true,
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
                mode: 'relay',
                endpoint: 'https://api.openai.com/v1',
                sessionToken: 'relay-token',
                model: 'gpt-4o-mini-transcribe',
                language: 'zh',
              },
              structurer: {
                type: 'openai',
                mode: 'relay',
                endpoint: 'https://api.openai.com/v1',
                sessionToken: 'relay-token',
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
    expect(within(settingsPanel).queryByLabelText('ASR Mode')).not.toBeInTheDocument();
    expect(within(settingsPanel).queryByLabelText('Structurer Mode')).not.toBeInTheDocument();
    expect(within(settingsPanel).queryByLabelText('ASR Session Token')).not.toBeInTheDocument();
    expect(
      within(settingsPanel).queryByLabelText('Structurer Session Token'),
    ).not.toBeInTheDocument();

    await act(async () => {
      await user.click(within(settingsPanel).getByRole('button', { name: /保存设置/i }));
    });

    expect((globalThis as any).chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'SAVE_PROVIDER_SETTINGS',
        payload: {
          config: expect.objectContaining({
            asr: expect.objectContaining({
              mode: 'direct',
              sessionToken: undefined,
            }),
            structurer: expect.objectContaining({
              mode: 'direct',
              sessionToken: undefined,
            }),
          }),
        },
      }),
    );
  });

  it('切换到智谱 GLM 后会自动回填默认 endpoint 和 model', async () => {
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
    const providerTypeSelects = within(settingsPanel).getAllByLabelText(/Provider Type/i);
    const endpointInputs = within(settingsPanel).getAllByLabelText(/Endpoint/i);
    const modelInputs = within(settingsPanel).getAllByLabelText(/Model/i);

    await act(async () => {
      await user.selectOptions(providerTypeSelects[1], 'zhipu');
    });

    expect(endpointInputs[1]).toHaveValue('https://open.bigmodel.cn/api/paas/v4');
    expect(modelInputs[1]).toHaveValue('glm-4.7-flash');
    expect(
      within(settingsPanel).queryByLabelText('Structurer Endpoint Preset'),
    ).not.toBeInTheDocument();
  });

  it('切换到百度千帆后会自动回填默认 endpoint 和 model', async () => {
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
    const providerTypeSelects = within(settingsPanel).getAllByLabelText(/Provider Type/i);
    const endpointInputs = within(settingsPanel).getAllByLabelText(/Endpoint/i);
    const modelInputs = within(settingsPanel).getAllByLabelText(/Model/i);

    await act(async () => {
      await user.selectOptions(providerTypeSelects[1], 'baidu');
    });

    expect(endpointInputs[1]).toHaveValue('https://qianfan.baidubce.com/v2');
    expect(modelInputs[1]).toHaveValue('ernie-speed-8k');
  });

  it('切换到阿里云百炼后会自动回填默认 endpoint 和 model', async () => {
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
    const providerTypeSelects = within(settingsPanel).getAllByLabelText(/Provider Type/i);
    const endpointInputs = within(settingsPanel).getAllByLabelText(/Endpoint/i);
    const modelInputs = within(settingsPanel).getAllByLabelText(/Model/i);

    await act(async () => {
      await user.selectOptions(providerTypeSelects[1], 'aliyun');
    });

    expect(endpointInputs[1]).toHaveValue('https://dashscope.aliyuncs.com/compatible-mode/v1');
    expect(modelInputs[1]).toHaveValue('qwen-plus');
  });

  it('Structurer provider type 可以直接切换到智谱 GLM（Coding Plan）', async () => {
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
    const providerTypeSelects = within(settingsPanel).getAllByLabelText(/Provider Type/i);

    await act(async () => {
      await user.selectOptions(providerTypeSelects[1], 'zhipu-coding-plan');
    });

    const endpointInput = within(settingsPanel).getByLabelText('Structurer Endpoint');
    const modelInput = within(settingsPanel).getByLabelText('Structurer Model');

    expect(endpointInput).toHaveValue('https://open.bigmodel.cn/api/coding/paas/v4');
    expect(modelInput).toHaveValue('glm-4.7-flash');
  });

  it('保存腾讯设置时空的 secret 字段会以 undefined 发送，避免覆盖本地已存密钥', async () => {
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
                type: 'tencent',
                mode: 'direct',
                region: 'ap-shanghai',
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
    const providerTypeSelect = within(settingsPanel).getAllByLabelText(/Provider Type/i)[0];

    await act(async () => {
      await user.selectOptions(providerTypeSelect, 'tencent');
    });

    const secretIdInput = within(settingsPanel).getByLabelText('Tencent Secret ID');
    const secretKeyInput = within(settingsPanel).getByLabelText('Tencent Secret Key');

    await act(async () => {
      await user.type(secretIdInput, 'temp-secret-id');
      await user.clear(secretIdInput);
      await user.type(secretKeyInput, 'temp-secret-key');
      await user.clear(secretKeyInput);
      await user.click(within(settingsPanel).getByRole('button', { name: /保存设置/i }));
    });

    expect((globalThis as any).chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'SAVE_PROVIDER_SETTINGS',
        payload: {
          config: expect.objectContaining({
            asr: expect.objectContaining({
              type: 'tencent',
              secretId: undefined,
              secretKey: undefined,
            }),
          }),
        },
      }),
    );
  });

  it('腾讯 realtime 设置会连同 transport 和 appId 一起保存', async () => {
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
                  type: 'tencent',
                  mode: 'direct',
                  transport: 'batch',
                  language: 'zh',
                  apiKeyConfigured: false,
                  sessionTokenConfigured: false,
                  secretConfigured: false,
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
                type: 'tencent',
                mode: 'direct',
                transport: 'batch',
                region: 'ap-shanghai',
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

    await act(async () => {
      await user.selectOptions(within(settingsPanel).getByLabelText('Tencent Transport'), 'ws');
      await user.type(within(settingsPanel).getByLabelText('Tencent App ID'), '1250000000');
      await user.selectOptions(within(settingsPanel).getByLabelText('Tencent Need VAD'), 'true');
      await user.type(within(settingsPanel).getByLabelText('Tencent VAD Silence Time'), '1200');
      await user.click(within(settingsPanel).getByRole('button', { name: /保存设置/i }));
    });

    expect((globalThis as any).chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'SAVE_PROVIDER_SETTINGS',
        payload: {
          config: expect.objectContaining({
            asr: expect.objectContaining({
              type: 'tencent',
              transport: 'ws',
              appId: '1250000000',
              needVad: true,
              vadSilenceTimeMs: 1200,
            }),
          }),
        },
      }),
    );
  });

  it('已保存的腾讯密钥不会回显明文，但会显示留空保持不变的提示', async () => {
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
                  type: 'tencent',
                  mode: 'direct',
                  language: 'zh',
                  apiKeyConfigured: false,
                  sessionTokenConfigured: false,
                  secretConfigured: true,
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
                type: 'tencent',
                mode: 'direct',
                region: 'ap-shanghai',
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
    const secretIdInput = within(settingsPanel).getByLabelText('Tencent Secret ID') as HTMLInputElement;
    const secretKeyInput = within(settingsPanel).getByLabelText('Tencent Secret Key') as HTMLInputElement;

    expect(secretIdInput.value).toBe('');
    expect(secretKeyInput.value).toBe('');
    expect(secretIdInput.placeholder).toContain('已保存');
    expect(screen.getByText(/已保存 Secret ID \/ Secret Key，留空则保持不变/)).toBeInTheDocument();
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
    const stoppedGraph = {
      sessionId: 'session_live',
      revision: 1,
      topics: [] as [],
      nodes: [
        {
          id: 'n1',
          type: 'claim' as const,
          text: '刚停止的节点',
          timestampMs: 0,
          status: 'confirmed' as const,
        },
      ],
      edges: [],
      viewHints: {
        defaultView: 'timeline' as const,
        scores: {
          timeline: 3,
          causal: 0,
          comparison: 0,
          flow: 0,
          hierarchy: 0,
        },
      },
      updatedAt: Date.now(),
    };
    await act(async () => {
      listeners[0]?.({
        type: 'SESSION_STATE_CHANGED',
        target: 'sidepanel',
        payload: {
          sessionId: 'session_live',
          state: 'stopped',
          mergedGraph: stoppedGraph,
          currentTimeMs: 30000,
          currentView: 'timeline',
          currentViewPinned: false,
        },
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

  it('收到 provider progress 后会把腾讯调试进度写入日志', async () => {
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
              sessionId: 'session_progress',
              state: 'transcribing',
              graph: null,
              currentTimeMs: 10000,
            },
          });
        }
        return Promise.resolve({ success: true });
      },
    );

    await renderApp();

    await act(async () => {
      listeners[0]?.({
        type: 'PROVIDER_PROGRESS',
        target: 'sidepanel',
        payload: {
          stage: 'asr',
          message: '腾讯 ASR 任务已创建，TaskId=9527',
        },
      });
      await Promise.resolve();
    });

    expect(
      screen.getByText(/ASR: 腾讯 ASR 任务已创建，TaskId=9527/),
    ).toBeInTheDocument();
  });

  it('连续腾讯实时中间结果在日志区仅保留一行（覆盖更新）', async () => {
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
              sessionId: 'session_tencent_merge',
              state: 'capturing',
              graph: null,
              currentTimeMs: 0,
            },
          });
        }
        return Promise.resolve({ success: true });
      },
    );

    await renderApp();

    await act(async () => {
      listeners[0]?.({
        type: 'PROVIDER_PROGRESS',
        target: 'sidepanel',
        payload: {
          stage: 'asr',
          message: '腾讯实时 ASR 中间结果: first',
        },
      });
      await Promise.resolve();
    });
    await act(async () => {
      listeners[0]?.({
        type: 'PROVIDER_PROGRESS',
        target: 'sidepanel',
        payload: {
          stage: 'asr',
          message: '腾讯实时 ASR 中间结果: second',
        },
      });
      await Promise.resolve();
    });

    const logArea = screen.getByTestId('log-area');
    const partialLines = within(logArea).getAllByText(/腾讯实时 ASR 中间结果/);
    expect(partialLines).toHaveLength(1);
    expect(partialLines[0]).toHaveTextContent(/second/);
    expect(partialLines[0]).not.toHaveTextContent(/first/);
  });

  it('非流式腾讯 ASR 进度仍逐条追加，不被合并', async () => {
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
              sessionId: 'session_batch_asr',
              state: 'transcribing',
              graph: null,
              currentTimeMs: 0,
            },
          });
        }
        return Promise.resolve({ success: true });
      },
    );

    await renderApp();

    await act(async () => {
      listeners[0]?.({
        type: 'PROVIDER_PROGRESS',
        target: 'sidepanel',
        payload: {
          stage: 'asr',
          message: '腾讯 ASR 轮询 A',
        },
      });
      await Promise.resolve();
    });
    await act(async () => {
      listeners[0]?.({
        type: 'PROVIDER_PROGRESS',
        target: 'sidepanel',
        payload: {
          stage: 'asr',
          message: '腾讯 ASR 轮询 B',
        },
      });
      await Promise.resolve();
    });

    const logArea = screen.getByTestId('log-area');
    expect(within(logArea).getAllByText(/腾讯 ASR 轮询 A/)).toHaveLength(1);
    expect(within(logArea).getAllByText(/腾讯 ASR 轮询 B/)).toHaveLength(1);
  });

  it('TRANSCRIPT_READY 会清除腾讯实时流式行再写转写', async () => {
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
              sessionId: 'session_transcript_clear',
              state: 'capturing',
              graph: null,
              currentTimeMs: 0,
            },
          });
        }
        return Promise.resolve({ success: true });
      },
    );

    await renderApp();

    await act(async () => {
      listeners[0]?.({
        type: 'PROVIDER_PROGRESS',
        target: 'sidepanel',
        payload: {
          stage: 'asr',
          message: '腾讯实时 ASR 中间结果: partial only',
        },
      });
      await Promise.resolve();
    });

    await act(async () => {
      listeners[0]?.({
        type: 'TRANSCRIPT_READY',
        target: 'sidepanel',
        payload: {
          transcript: {
            chunkId: 'c1',
            sessionId: 'session_transcript_clear',
            text: 'final stable',
            startMs: 0,
            endMs: 100,
            provider: 'tencent-asr',
          },
        },
      });
      await Promise.resolve();
    });

    const logArea = screen.getByTestId('log-area');
    expect(
      within(logArea).queryByText(/腾讯实时 ASR 中间结果/),
    ).not.toBeInTheDocument();
    expect(within(logArea).getByText(/转写: final stable/)).toBeInTheDocument();
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

    const stoppedGraph = {
      sessionId: 'session_stop_flow',
      revision: 1,
      topics: [] as [],
      nodes: [
        {
          id: 'n1',
          type: 'claim' as const,
          text: '停止后可导出',
          timestampMs: 0,
          status: 'confirmed' as const,
        },
      ],
      edges: [],
      viewHints: {
        defaultView: 'timeline' as const,
        scores: {
          timeline: 3,
          causal: 0,
          comparison: 0,
          flow: 0,
          hierarchy: 0,
        },
      },
      updatedAt: Date.now(),
    };
    await act(async () => {
      listeners[0]?.({
        type: 'SESSION_STATE_CHANGED',
        target: 'sidepanel',
        payload: {
          sessionId: 'session_stop_flow',
          state: 'stopped',
          mergedGraph: stoppedGraph,
          currentTimeMs: 30000,
          currentView: 'timeline',
          currentViewPinned: false,
        },
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
              segments: [
                {
                  segmentId: 'segment_1',
                  sessionId: 'session_debug',
                  startMs: 0,
                  endMs: 30000,
                  topic: '调试话题',
                  provider: 'mock-structurer',
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
                  raw: {
                    topic: '调试话题',
                  },
                },
              ],
              traces: [
                {
                  sequence: 1,
                  transcript: {
                    chunkId: 'chunk_1',
                    sessionId: 'session_debug',
                    text: '第一段调试转写',
                    startMs: 0,
                    endMs: 30000,
                    provider: 'mock-asr',
                  },
                  transcriptWindow: [
                    {
                      chunkId: 'chunk_1',
                      sessionId: 'session_debug',
                      text: '第一段调试转写',
                      startMs: 0,
                      endMs: 30000,
                      provider: 'mock-asr',
                    },
                  ],
                  segment: {
                    segmentId: 'segment_1',
                    sessionId: 'session_debug',
                    startMs: 0,
                    endMs: 30000,
                    topic: '调试话题',
                    provider: 'mock-structurer',
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
                  },
                  structurerRun: {
                    sessionId: 'session_debug',
                    sequence: 1,
                    mode: 'bootstrap',
                    transcriptEndMs: 30000,
                    latestTranscriptId: 'chunk_1',
                    latestChunkId: 'chunk_1',
                    windowStartMs: 0,
                    windowEndMs: 30000,
                    windowTranscriptCount: 1,
                    windowChunkCount: 1,
                    windowCharCount: 7,
                    latestTranscriptCharCount: 7,
                    latestChunkCharCount: 7,
                    recentNodeCount: 0,
                    recentEdgeCount: 0,
                    startedAt: 100,
                    completedAt: 200,
                    durationMs: 100,
                    status: 'success',
                    segmentId: 'segment_1',
                    nodeCount: 1,
                    edgeCount: 0,
                    fallbackUsed: false,
                  },
                  mergedGraphAfter: {
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
                    updatedAt: 200,
                  },
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
              structurerRuns: [
                {
                  sessionId: 'session_debug',
                  sequence: 1,
                  mode: 'bootstrap',
                  transcriptEndMs: 30000,
                  latestTranscriptId: 'chunk_1',
                  latestChunkId: 'chunk_1',
                  windowStartMs: 0,
                  windowEndMs: 30000,
                  windowTranscriptCount: 1,
                  windowChunkCount: 1,
                  windowCharCount: 7,
                  latestTranscriptCharCount: 7,
                  latestChunkCharCount: 7,
                  recentNodeCount: 0,
                  recentEdgeCount: 0,
                  startedAt: 100,
                  completedAt: 200,
                  durationMs: 100,
                  status: 'success',
                  segmentId: 'segment_1',
                  nodeCount: 1,
                  edgeCount: 0,
                  fallbackUsed: false,
                },
              ],
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
    expect(within(debugPanel).getByText(/transcript units: 1/)).toBeInTheDocument();
    expect(within(debugPanel).getByText(/structurer segments: 1/)).toBeInTheDocument();
    expect(within(debugPanel).getByText(/transcript traces: 1/)).toBeInTheDocument();
    expect(within(debugPanel).getByText(/structurer runs: 1/)).toBeInTheDocument();
    expect(within(debugPanel).getByText(/第一段调试转写/)).toBeInTheDocument();
    expect(within(debugPanel).getByText(/调试图节点/)).toBeInTheDocument();
  });

  it('调试面板支持导出包含派生视图的 debug JSON', async () => {
    (globalThis as any).chrome.runtime.sendMessage.mockImplementation(
      (message: { type?: string }) => {
        if (message?.type === 'GET_RUNTIME_SNAPSHOT') {
          return Promise.resolve({
            success: true,
            snapshot: {
              sessionId: 'session_debug_export',
              state: 'stopped',
              currentTimeMs: 30000,
              currentView: 'timeline',
              graph: {
                sessionId: 'session_debug_export',
                revision: 1,
                topics: [],
                nodes: [
                  {
                    id: 'n1',
                    type: 'claim',
                    text: '导出调试节点',
                    timestampMs: 0,
                    status: 'confirmed',
                  },
                ],
                edges: [],
                updatedAt: 200,
              },
            },
          });
        }
        if (message?.type === 'GET_DEBUG_SESSION') {
          return Promise.resolve({
            success: true,
            debugData: {
              session: {
                sessionId: 'session_debug_export',
                sourceType: 'tab',
                createdAt: 100,
              },
              transcripts: [
                {
                  chunkId: 'chunk_1',
                  sessionId: 'session_debug_export',
                  text: '导出调试转写',
                  startMs: 0,
                  endMs: 30000,
                  provider: 'mock-asr',
                  tokens: [
                    {
                      text: '导出',
                      startMs: 0,
                      endMs: 1000,
                    },
                  ],
                  raw: {
                    providerPayload: true,
                  },
                },
              ],
              segments: [
                {
                  segmentId: 'segment_1',
                  sessionId: 'session_debug_export',
                  startMs: 0,
                  endMs: 30000,
                  provider: 'mock-structurer',
                  nodes: [
                    {
                      id: 'n1',
                      type: 'claim',
                      text: '导出调试节点',
                      timestampMs: 0,
                      status: 'confirmed',
                    },
                  ],
                  edges: [],
                  raw: {
                    topic: '导出原始响应',
                  },
                },
              ],
              traces: [],
              graph: {
                sessionId: 'session_debug_export',
                revision: 1,
                topics: [],
                nodes: [
                  {
                    id: 'n1',
                    type: 'claim',
                    text: '导出调试节点',
                    timestampMs: 0,
                    status: 'confirmed',
                  },
                ],
                edges: [],
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

    await act(async () => {
      await user.click(await screen.findByTestId('debug-export-button'));
    });

    const slimBlob = createObjectURLSpy.mock.calls.at(-1)?.[0] as Blob;
    const slimJson = await slimBlob.text();

    expect(anchorClickSpy).toHaveBeenCalled();
    expect(slimJson).toContain('"segments"');
    expect(slimJson).toContain('"derivedViews"');
    expect(slimJson).toContain('"timeline"');
    expect(slimJson).toContain('导出调试节点');
    expect(slimJson).not.toContain('"tokens"');
    expect(slimJson).not.toContain('"raw"');
    expect(slimJson).toContain('"tokenCount": 1');
    expect(slimJson).toContain('"hasRaw": true');

    await act(async () => {
      await user.click(await screen.findByTestId('debug-export-full-button'));
    });

    const fullBlob = createObjectURLSpy.mock.calls.at(-1)?.[0] as Blob;
    const fullJson = await fullBlob.text();
    expect(fullJson).toContain('"tokens"');
    expect(fullJson).toContain('"raw"');
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
