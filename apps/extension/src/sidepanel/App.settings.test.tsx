import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { act } from 'react';
import {
  renderApp,
  setupAppTests,
  teardownAppTests,
} from './__test-helpers__/app-test-helpers';

// ── Tab 切换辅助函数 ──
// 新版设置面板使用竖排 Tab 导航（语音识别 / 结构化 / 显示）
// 默认激活「语音识别」Tab，查询其他 Tab 内容前需先切换
async function switchToTab(tabName: string) {
  const tab = screen.getByRole('button', { name: tabName });
  fireEvent.click(tab);
}

describe('App - 设置面板', () => {
  beforeEach(() => {
    setupAppTests();
  });

  afterEach(() => {
    teardownAppTests();
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
    // ASR Tab 是默认激活的，ASR 字段可以直接查询
    expect(
      within(settingsPanel).getAllByDisplayValue('https://api.openai.com/v1').length,
    ).toBeGreaterThanOrEqual(1);
    expect(
      within(settingsPanel).getByDisplayValue('gpt-4o-mini-transcribe'),
    ).toBeInTheDocument();
    // 「智谱 GLM」在 Structurer Tab 下，需要先切换
    await switchToTab('结构化');
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
      (message: { type?: string; payload?: Record<string, unknown> }) => {
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
      (message: { type?: string; payload?: Record<string, unknown> }) => {
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

    // 切换到「结构化」Tab 来操作 Structurer 字段
    await switchToTab('结构化');

    const providerTypeSelect = within(settingsPanel).getByLabelText(/Structurer Provider Type/i);
    const endpointInput = within(settingsPanel).getByLabelText('Structurer Endpoint');
    const modelInput = within(settingsPanel).getByLabelText('Structurer Model');

    await act(async () => {
      await user.selectOptions(providerTypeSelect, 'zhipu');
    });

    expect(endpointInput).toHaveValue('https://open.bigmodel.cn/api/paas/v4');
    expect(modelInput).toHaveValue('glm-4.7-flash');
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

    // 切换到「结构化」Tab 来操作 Structurer 字段
    await switchToTab('结构化');

    const providerTypeSelect = within(settingsPanel).getByLabelText(/Structurer Provider Type/i);
    const endpointInput = within(settingsPanel).getByLabelText('Structurer Endpoint');
    const modelInput = within(settingsPanel).getByLabelText('Structurer Model');

    await act(async () => {
      await user.selectOptions(providerTypeSelect, 'baidu');
    });

    expect(endpointInput).toHaveValue('https://qianfan.baidubce.com/v2');
    expect(modelInput).toHaveValue('ernie-speed-8k');
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

    // 切换到「结构化」Tab 来操作 Structurer 字段
    await switchToTab('结构化');

    const providerTypeSelect = within(settingsPanel).getByLabelText(/Structurer Provider Type/i);
    const endpointInput = within(settingsPanel).getByLabelText('Structurer Endpoint');
    const modelInput = within(settingsPanel).getByLabelText('Structurer Model');

    await act(async () => {
      await user.selectOptions(providerTypeSelect, 'aliyun');
    });

    expect(endpointInput).toHaveValue('https://dashscope.aliyuncs.com/compatible-mode/v1');
    expect(modelInput).toHaveValue('qwen-plus');
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

    // 切换到「结构化」Tab 来操作 Structurer 字段
    await switchToTab('结构化');

    const providerTypeSelect = within(settingsPanel).getByLabelText(/Structurer Provider Type/i);

    await act(async () => {
      await user.selectOptions(providerTypeSelect, 'zhipu-coding-plan');
    });

    const endpointInput = within(settingsPanel).getByLabelText('Structurer Endpoint');
    const modelInput = within(settingsPanel).getByLabelText('Structurer Model');

    expect(endpointInput).toHaveValue('https://open.bigmodel.cn/api/coding/paas/v4');
    expect(modelInput).toHaveValue('glm-4.7-flash');
  });

  it('保存腾讯设置时空的 secret 字段会以 undefined 发送，避免覆盖本地已存密钥', async () => {
    (globalThis as any).chrome.runtime.sendMessage.mockImplementation(
      (message: { type?: string; payload?: Record<string, unknown> }) => {
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
    // ASR Tab 默认激活，直接使用 ASR Provider Type
    const providerTypeSelect = within(settingsPanel).getByLabelText('ASR Provider Type');

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

  it('Local ASR Bridge 设置会保存 endpoint、protocol 和 auth token，并显示健康提示', async () => {
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

    await act(async () => {
      await user.selectOptions(within(settingsPanel).getAllByLabelText(/Provider Type/i)[0], 'external');
      await user.clear(within(settingsPanel).getByLabelText('ASR Endpoint'));
      await user.type(within(settingsPanel).getByLabelText('ASR Endpoint'), 'ws://127.0.0.1:15377/ws');
      await user.clear(within(settingsPanel).getByLabelText('ASR Model'));
      await user.type(within(settingsPanel).getByLabelText('ASR Model'), 'mock-streaming-asr');
      await user.clear(within(settingsPanel).getByLabelText('Local Bridge Protocol'));
      await user.type(within(settingsPanel).getByLabelText('Local Bridge Protocol'), 'lg-asr-ws-v1');
      await user.type(within(settingsPanel).getByLabelText('Local Bridge Auth Token'), 'bridge-token');
      await user.click(within(settingsPanel).getByRole('button', { name: /保存设置/i }));
    });

    expect(within(settingsPanel).getByTestId('local-bridge-health')).toHaveTextContent('Bridge 状态: idle');
    expect((globalThis as any).chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'SAVE_PROVIDER_SETTINGS',
        payload: {
          config: expect.objectContaining({
            asr: expect.objectContaining({
              type: 'external',
              transport: 'ws',
              endpoint: 'ws://127.0.0.1:15377/ws',
              model: 'mock-streaming-asr',
              bridgeProtocol: 'lg-asr-ws-v1',
              bridgeAuthToken: 'bridge-token',
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
});
