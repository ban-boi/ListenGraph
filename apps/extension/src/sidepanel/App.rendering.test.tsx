import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { act } from 'react';
import {
  renderApp,
  setupAppTests,
  teardownAppTests,
  openOverflowMenu,
} from './__test-helpers__/app-test-helpers';

describe('App - 渲染', () => {
  beforeEach(() => {
    setupAppTests();
  });

  afterEach(() => {
    teardownAppTests();
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
    expect(logArea.textContent).toMatch(/点击"开始"启动会话|标签页 ID: 1/);
  });

  it('应该渲染运行时状态卡', async () => {
    await renderApp();

    expect(screen.getByTestId('runtime-status-cards')).toBeInTheDocument();
    expect(screen.getByTestId('status-card-asr')).toBeInTheDocument();
    expect(screen.getByTestId('status-card-structurer')).toBeInTheDocument();
    expect(screen.getByTestId('status-card-graph')).toBeInTheDocument();
    expect(screen.queryByTestId('graph-view-summary')).not.toBeInTheDocument();
  });

  it('拖动日志分割条时会调整日志面板高度', async () => {
    await renderApp();

    const logArea = screen.getByTestId('log-area');
    const resizer = screen.getByTestId('resize-handle');

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
    expect(screen.getByText('对比')).toBeInTheDocument();
    expect(screen.getByText('层级')).toBeInTheDocument();
  });

  it('应该渲染底部状态栏', async () => {
    await renderApp();

    expect(screen.getByText(/会话:/)).toBeInTheDocument();
    expect(screen.getByText(/当前时间:/)).toBeInTheDocument();
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
    await openOverflowMenu();

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

    const banner = screen.getByTestId('error-banner');
    expect(banner).toBeInTheDocument();
    expect(within(banner).getByText(/最近错误/)).toBeInTheDocument();
    expect(within(banner).getByText(/ASR \/ CONFIG_ERROR/)).toBeInTheDocument();
    expect(within(banner).getByText(/secretId and secretKey/)).toBeInTheDocument();
  });

  it('收到错误后会显示最近错误提示，后续成功消息会清除', async () => {
    let runtimeMessageListener: ((message: { type?: string; target?: string; payload?: Record<string, unknown> }) => void) | undefined;
    (globalThis as any).chrome.runtime.onMessage.addListener.mockImplementation((listener: (message: { type?: string; target?: string; payload?: Record<string, unknown> }) => void) => {
      runtimeMessageListener = listener;
    });

    await renderApp();
    expect(screen.queryByTestId('error-banner')).not.toBeInTheDocument();

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

    const banner = screen.getByTestId('error-banner');
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

    expect(screen.queryByTestId('error-banner')).not.toBeInTheDocument();
  });
});
