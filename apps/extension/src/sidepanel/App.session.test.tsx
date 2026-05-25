import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { act } from 'react';
import {
  renderApp,
  setupAppTests,
  teardownAppTests,
  anchorClickSpy,
  clickOverflowMenuItem,
  openOverflowMenu,
} from './__test-helpers__/app-test-helpers';

describe('App - 会话与导出', () => {
  beforeEach(() => {
    setupAppTests();
  });

  afterEach(() => {
    teardownAppTests();
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
    await clickOverflowMenuItem(user, 'overflow-menu-export-json');

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
    await clickOverflowMenuItem(user, 'overflow-menu-export-json');
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

    await openOverflowMenu();
    expect(screen.getByTestId('overflow-menu-export-json')).toBeDisabled();

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

    await openOverflowMenu();
    expect(screen.getByTestId('overflow-menu-export-json')).not.toBeDisabled();
    await act(async () => {
      await clickOverflowMenuItem(user, 'overflow-menu-export-json');
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
    const user = userEvent.setup();
    await openOverflowMenu();

    expect(screen.getByTestId('overflow-menu-export-json')).toBeDisabled();
    expect(screen.getByTestId('overflow-menu-export-markdown')).toBeDisabled();
    expect(screen.getByTestId('overflow-menu-export-mermaid')).toBeDisabled();
  });
});
