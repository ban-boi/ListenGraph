import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { act } from 'react';
import {
  renderApp,
  setupAppTests,
  teardownAppTests,
} from './__test-helpers__/app-test-helpers';

describe('App - 日志与状态卡', () => {
  beforeEach(() => {
    setupAppTests();
  });

  afterEach(() => {
    teardownAppTests();
  });

  it('收到 provider progress 后会把腾讯调试进度写入日志', async () => {
    const listeners: Array<(message: { type?: string; target?: string; payload?: Record<string, unknown> }) => void> = [];
    (globalThis as any).chrome.runtime.onMessage.addListener.mockImplementation(
      (listener: (message: { type?: string; target?: string; payload?: Record<string, unknown> }) => void) => {
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

    expect(screen.getByText(/腾讯 ASR 任务已创建，TaskId=9527/)).toBeInTheDocument();
  });

  it('会把 structurer started / finished 写入事件流', async () => {
    const listeners: Array<(message: { type?: string; target?: string; payload?: Record<string, unknown> }) => void> = [];
    (globalThis as any).chrome.runtime.onMessage.addListener.mockImplementation(
      (listener: (message: { type?: string; target?: string; payload?: Record<string, unknown> }) => void) => {
        listeners.push(listener);
      },
    );
    (globalThis as any).chrome.runtime.sendMessage.mockImplementation(
      (message: { type?: string }) => {
        if (message?.type === 'GET_RUNTIME_SNAPSHOT') {
          return Promise.resolve({
            success: true,
            snapshot: {
              sessionId: 'session_structurer_events',
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
          stage: 'structurer',
          message: 'Structurer started | incremental | window=3 | latest=42字',
        },
      });
      await Promise.resolve();
    });

    await act(async () => {
      listeners[0]?.({
        type: 'PROVIDER_PROGRESS',
        target: 'sidepanel',
        payload: {
          stage: 'structurer',
          message: 'Structurer finished | 4200ms | nodes=2 | edges=1',
        },
      });
      await Promise.resolve();
    });

    const logArea = screen.getByTestId('log-area');
    expect(within(logArea).getByText(/Structurer started/)).toBeInTheDocument();
    expect(within(logArea).getByText(/Structurer finished/)).toBeInTheDocument();
  });

  it('连续腾讯实时中间结果在日志区仅保留一行（覆盖更新）', async () => {
    const listeners: Array<(message: { type?: string; target?: string; payload?: Record<string, unknown> }) => void> = [];
    (globalThis as any).chrome.runtime.onMessage.addListener.mockImplementation(
      (listener: (message: { type?: string; target?: string; payload?: Record<string, unknown> }) => void) => {
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
          asrSliceType: 1,
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
          asrSliceType: 1,
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
    const listeners: Array<(message: { type?: string; target?: string; payload?: Record<string, unknown> }) => void> = [];
    (globalThis as any).chrome.runtime.onMessage.addListener.mockImplementation(
      (listener: (message: { type?: string; target?: string; payload?: Record<string, unknown> }) => void) => {
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
    const listeners: Array<(message: { type?: string; target?: string; payload?: Record<string, unknown> }) => void> = [];
    (globalThis as any).chrome.runtime.onMessage.addListener.mockImplementation(
      (listener: (message: { type?: string; target?: string; payload?: Record<string, unknown> }) => void) => {
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
          asrSliceType: 1,
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

  // Task 4 (PipelineModule 去 status)：delayed/processing/congested 文案
  // 原本挂在 status span 上，现已由 SignalDot + 波形双通道表达。
  // 精确的 detail 文案断言留到 Task 6（composer 重写）后再恢复。
  it.skip('structuring 超过阈值时会在状态卡显示 delayed', async () => {
    (globalThis as any).chrome.runtime.sendMessage.mockImplementation(
      (message: { type?: string }) => {
        if (message?.type === 'GET_RUNTIME_SNAPSHOT') {
          return Promise.resolve({
            success: true,
            snapshot: {
              sessionId: 'session_delayed',
              state: 'structuring',
              graph: null,
              currentTimeMs: 30000,
              structuringSince: Date.now() - 9000,
            },
          });
        }
        return Promise.resolve({ success: true });
      },
    );

    await renderApp();

    expect(within(screen.getByTestId('status-card-structurer')).getByText(/delayed/i)).toBeInTheDocument();
  });

  // Task 4：见上，processing/target/backlog 文案断言留到 Task 6 恢复。
  it.skip('structurer 状态卡会展示当前目标 transcript 与 backlog', async () => {
    (globalThis as any).chrome.runtime.sendMessage.mockImplementation(
      (message: { type?: string }) => {
        if (message?.type === 'GET_RUNTIME_SNAPSHOT') {
          return Promise.resolve({
            success: true,
            snapshot: {
              sessionId: 'session_backlog',
              state: 'structuring',
              graph: null,
              currentTimeMs: 30000,
              structuringSince: Date.now() - 3000,
              pendingTranscriptCount: 2,
              pendingWorkCount: 3,
              currentStructurerTarget: {
                transcriptId: 'chunk_42',
                transcriptEndMs: 45000,
                transcriptCharCount: 67,
                transcriptPreview: '这是当前正在处理的一句很关键的话',
              },
            },
          });
        }
        return Promise.resolve({ success: true });
      },
    );

    await renderApp();

    const card = screen.getByTestId('status-card-structurer');
    expect(within(card).getByText(/processing/i)).toBeInTheDocument();
    expect(within(card).getByText(/target 0:45 \/ 67字/i)).toBeInTheDocument();
    expect(within(card).getByText(/backlog 2/i)).toBeInTheDocument();
    expect(within(card).getByText(/这是当前正在处理的一句很关键的话/i)).toBeInTheDocument();
  });

  // Task 4：见上，congested/backlog 文案断言留到 Task 6 恢复。
  it.skip('backlog 过大时 structurer 状态卡会显示 congested', async () => {
    (globalThis as any).chrome.runtime.sendMessage.mockImplementation(
      (message: { type?: string }) => {
        if (message?.type === 'GET_RUNTIME_SNAPSHOT') {
          return Promise.resolve({
            success: true,
            snapshot: {
              sessionId: 'session_congested',
              state: 'structuring',
              graph: null,
              currentTimeMs: 30000,
              structuringSince: Date.now() - 5000,
              pendingTranscriptCount: 4,
              pendingWorkCount: 5,
              currentStructurerTarget: {
                transcriptId: 'chunk_77',
                transcriptEndMs: 60000,
                transcriptCharCount: 88,
                transcriptPreview: '这是一条被拥塞压住的 transcript 摘要',
              },
            },
          });
        }
        return Promise.resolve({ success: true });
      },
    );

    await renderApp();

    const card = screen.getByTestId('status-card-structurer');
    expect(within(card).getByText(/congested/i)).toBeInTheDocument();
    expect(within(card).getByText(/backlog 4/i)).toBeInTheDocument();
  });

  it('重复的 queue 事件会被折叠计数', async () => {
    const listeners: Array<(message: { type?: string; target?: string; payload?: Record<string, unknown> }) => void> = [];
    (globalThis as any).chrome.runtime.onMessage.addListener.mockImplementation(
      (listener: (message: { type?: string; target?: string; payload?: Record<string, unknown> }) => void) => {
        listeners.push(listener);
      },
    );
    (globalThis as any).chrome.runtime.sendMessage.mockImplementation(
      (message: { type?: string }) => {
        if (message?.type === 'GET_RUNTIME_SNAPSHOT') {
          return Promise.resolve({
            success: true,
            snapshot: {
              sessionId: 'session_agg',
              state: 'structuring',
              graph: null,
              currentTimeMs: 30000,
              structuringSince: Date.now() - 2000,
              pendingTranscriptCount: 0,
              pendingWorkCount: 1,
              currentStructurerTarget: {
                transcriptId: 'chunk_a',
                transcriptEndMs: 30000,
                transcriptCharCount: 20,
                transcriptPreview: '预览',
              },
            },
          });
        }
        return Promise.resolve({ success: true });
      },
    );

    await renderApp();

    await act(async () => {
      listeners[0]?.({
        type: 'SESSION_STATE_CHANGED',
        target: 'sidepanel',
        payload: {
          sessionId: 'session_agg',
          state: 'structuring',
          pendingTranscriptCount: 1,
          pendingWorkCount: 2,
          stopDrainPendingCount: 0,
          currentStructurerTarget: {
            transcriptId: 'chunk_a',
            transcriptEndMs: 30000,
            transcriptCharCount: 20,
            transcriptPreview: '预览',
          },
        },
      });
      await Promise.resolve();
    });

    await act(async () => {
      listeners[0]?.({
        type: 'SESSION_STATE_CHANGED',
        target: 'sidepanel',
        payload: {
          sessionId: 'session_agg',
          state: 'structuring',
          pendingTranscriptCount: 2,
          pendingWorkCount: 3,
          stopDrainPendingCount: 0,
          currentStructurerTarget: {
            transcriptId: 'chunk_a',
            transcriptEndMs: 30000,
            transcriptCharCount: 20,
            transcriptPreview: '预览',
          },
        },
      });
      await Promise.resolve();
    });

    const logArea = screen.getByTestId('log-area');
    expect(within(logArea).getByText(/Transcript queued behind current structurer/)).toBeInTheDocument();
    expect(within(logArea).getByText(/x2/)).toBeInTheDocument();
  });
});
