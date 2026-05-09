import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { act } from 'react';
import {
  renderApp,
  reactFlowFitViewSpy,
  reactFlowFitBoundsSpy,
  reactFlowGetViewportSpy,
  reactFlowViewport,
  setupAppTests,
  teardownAppTests,
} from './__test-helpers__/app-test-helpers';

describe('App - 图谱更新', () => {
  beforeEach(() => {
    setupAppTests();
  });

  afterEach(() => {
    teardownAppTests();
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
    expect(screen.getAllByText('已恢复的节点')).toHaveLength(2);
    expect(screen.getByTestId('reactflow-mock')).toHaveAttribute('data-fit-view-prop', 'false');
    expect(reactFlowFitViewSpy).toHaveBeenCalled();
  });

  it('节点会渲染四向 source/target handles', async () => {
    (globalThis as any).chrome.runtime.sendMessage.mockImplementation(
      (message: { type?: string }) => {
        if (message?.type === 'GET_RUNTIME_SNAPSHOT') {
          return Promise.resolve({
            success: true,
            snapshot: {
              sessionId: 'session_handles',
              state: 'capturing',
              currentTimeMs: 0,
              currentView: 'causal',
              currentViewPinned: true,
              graph: {
                sessionId: 'session_handles',
                revision: 1,
                topics: [],
                nodes: [
                  {
                    id: 'n1',
                    type: 'claim',
                    text: '句柄节点',
                    timestampMs: 0,
                    status: 'confirmed',
                  },
                ],
                edges: [],
                updatedAt: Date.now(),
              },
            },
          });
        }
        return Promise.resolve({ success: true });
      },
    );

    await renderApp();

    expect(screen.getByTestId('graph-handle-source-top')).toHaveAttribute('data-handle-id', 'source-top');
    expect(screen.getByTestId('graph-handle-source-bottom')).toHaveAttribute('data-handle-id', 'source-bottom');
    expect(screen.getByTestId('graph-handle-source-left')).toHaveAttribute('data-handle-id', 'source-left');
    expect(screen.getByTestId('graph-handle-source-right')).toHaveAttribute('data-handle-id', 'source-right');
    expect(screen.getByTestId('graph-handle-target-top')).toHaveAttribute('data-handle-id', 'target-top');
    expect(screen.getByTestId('graph-handle-target-bottom')).toHaveAttribute('data-handle-id', 'target-bottom');
    expect(screen.getByTestId('graph-handle-target-left')).toHaveAttribute('data-handle-id', 'target-left');
    expect(screen.getByTestId('graph-handle-target-right')).toHaveAttribute('data-handle-id', 'target-right');
  });

  it('默认视图的边会显式带几何锚点 handles', async () => {
    (globalThis as any).chrome.runtime.sendMessage.mockImplementation(
      (message: { type?: string }) => {
        if (message?.type === 'GET_RUNTIME_SNAPSHOT') {
          return Promise.resolve({
            success: true,
            snapshot: {
              sessionId: 'session_edges',
              state: 'capturing',
              currentTimeMs: 0,
              currentView: 'causal',
              currentViewPinned: true,
              graph: {
                sessionId: 'session_edges',
                revision: 1,
                topics: [],
                nodes: [
                  {
                    id: 'n1',
                    type: 'claim',
                    text: '上方节点',
                    timestampMs: 0,
                    status: 'confirmed',
                  },
                  {
                    id: 'n2',
                    type: 'claim',
                    text: '下方节点',
                    timestampMs: 1000,
                    status: 'confirmed',
                  },
                ],
                edges: [{ id: 'e1', source: 'n1', target: 'n2', type: 'supports' }],
                updatedAt: Date.now(),
              },
            },
          });
        }
        return Promise.resolve({ success: true });
      },
    );

    await renderApp();

    const edge = screen.getByTestId('reactflow-edge');
    expect(edge).toHaveAttribute('data-edge-id', 'e1');
    expect(edge).toHaveAttribute('data-edge-type', 'default');
    expect(edge).toHaveAttribute('data-edge-source-handle', 'source-bottom');
    expect(edge).toHaveAttribute('data-edge-target-handle', 'target-top');
  });

  it('同一 session 的图更新不会自动切换当前视图', async () => {
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
              sessionId: 'session_locked_view',
              state: 'capturing',
              currentTimeMs: 30000,
              currentView: 'timeline',
              currentViewPinned: false,
              graph: {
                sessionId: 'session_locked_view',
                revision: 1,
                topics: [],
                nodes: [
                  {
                    id: 'n1',
                    type: 'claim',
                    text: '旧节点',
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
                updatedAt: 100,
              },
            },
          });
        }
        return Promise.resolve({ success: true });
      },
    );

    await renderApp();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /时间线/ })).toHaveStyle({
        backgroundColor: '#eff6ff',
      }),
    );

    await act(async () => {
      listeners[0]?.({
        type: 'MERGED_GRAPH_UPDATED',
        target: 'sidepanel',
        payload: {
          graph: {
            sessionId: 'session_locked_view',
            revision: 2,
            topics: [],
            nodes: [
              {
                id: 'n1',
                type: 'claim',
                text: '旧节点',
                timestampMs: 0,
                status: 'confirmed',
              },
              {
                id: 'n2',
                type: 'reason',
                text: '新增原因',
                timestampMs: 40000,
                status: 'confirmed',
              },
            ],
            edges: [
              {
                id: 'e1',
                source: 'n1',
                target: 'n2',
                type: 'example_of',
              },
            ],
            viewHints: {
              defaultView: 'hierarchy',
              scores: {
                timeline: 0,
                causal: 0,
                comparison: 0,
                flow: 0,
                hierarchy: 5,
              },
            },
            updatedAt: 200,
          },
        },
      });
      await Promise.resolve();
    });

    expect(screen.getByRole('button', { name: /时间线/ })).toHaveStyle({
      backgroundColor: '#eff6ff',
    });
    expect(screen.getByRole('button', { name: /层级/ })).not.toHaveStyle({
      backgroundColor: '#eff6ff',
    });
  });

  it('纯新增边更新时会保留已有节点坐标且不再次 fitView', async () => {
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
              sessionId: 'session_stable_layout',
              state: 'capturing',
              currentTimeMs: 30000,
              currentView: 'timeline',
              currentViewPinned: false,
              graph: {
                sessionId: 'session_stable_layout',
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
                  {
                    id: 'n2',
                    type: 'claim',
                    text: '节点二',
                    timestampMs: 30000,
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
                updatedAt: 100,
              },
            },
          });
        }
        return Promise.resolve({ success: true });
      },
    );

    await renderApp();

    const firstPosition = screen.getByRole('button', { name: '节点一' }).dataset.nodePosition;
    const secondPosition = screen.getByRole('button', { name: '节点二' }).dataset.nodePosition;
    const initialFitViewCalls = reactFlowFitViewSpy.mock.calls.length;
    expect(initialFitViewCalls).toBeGreaterThan(0);

    await act(async () => {
      listeners[0]?.({
        type: 'MERGED_GRAPH_UPDATED',
        target: 'sidepanel',
        payload: {
          graph: {
            sessionId: 'session_stable_layout',
            revision: 2,
            topics: [],
            nodes: [
              {
                id: 'n1',
                type: 'claim',
                text: '节点一',
                timestampMs: 0,
                status: 'confirmed',
              },
              {
                id: 'n2',
                type: 'claim',
                text: '节点二',
                timestampMs: 30000,
                status: 'confirmed',
              },
            ],
            edges: [
              {
                id: 'e1',
                source: 'n1',
                target: 'n2',
                type: 'supports',
              },
            ],
            viewHints: {
              defaultView: 'causal',
              scores: {
                timeline: 0,
                causal: 2,
                comparison: 0,
                flow: 0,
                hierarchy: 0,
              },
            },
            updatedAt: 200,
          },
        },
      });
      await Promise.resolve();
    });

    expect(screen.getByRole('button', { name: '节点一' }).dataset.nodePosition).toBe(firstPosition);
    expect(screen.getByRole('button', { name: '节点二' }).dataset.nodePosition).toBe(secondPosition);
    expect(reactFlowFitViewSpy).toHaveBeenCalledTimes(initialFitViewCalls);
    expect(reactFlowFitBoundsSpy).not.toHaveBeenCalled();
    expect(screen.getByText(/图更新: 仅新增连线 \+1/)).toBeInTheDocument();
  });

  it('新增节点更新时会使用动画 fitBounds 跟随新区域', async () => {
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
              sessionId: 'session_follow_view',
              state: 'capturing',
              currentTimeMs: 30000,
              currentView: 'timeline',
              currentViewPinned: false,
              graph: {
                sessionId: 'session_follow_view',
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
                  {
                    id: 'n2',
                    type: 'claim',
                    text: '节点二',
                    timestampMs: 30000,
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
                updatedAt: 100,
              },
            },
          });
        }
        return Promise.resolve({ success: true });
      },
    );

    await renderApp();
    expect(reactFlowFitViewSpy).toHaveBeenCalled();

    await act(async () => {
      listeners[0]?.({
        type: 'MERGED_GRAPH_UPDATED',
        target: 'sidepanel',
        payload: {
          graph: {
            sessionId: 'session_follow_view',
            revision: 2,
            topics: [],
            nodes: [
              {
                id: 'n1',
                type: 'claim',
                text: '节点一',
                timestampMs: 0,
                status: 'confirmed',
              },
              {
                id: 'n2',
                type: 'claim',
                text: '节点二',
                timestampMs: 30000,
                status: 'confirmed',
              },
              {
                id: 'n3',
                type: 'reason',
                text: '新增原因',
                timestampMs: 60000,
                status: 'confirmed',
              },
            ],
            edges: [
              {
                id: 'e1',
                source: 'n2',
                target: 'n3',
                type: 'supports',
              },
            ],
            viewHints: {
              defaultView: 'timeline',
              scores: {
                timeline: 4,
                causal: 0,
                comparison: 0,
                flow: 0,
                hierarchy: 0,
              },
            },
            updatedAt: 200,
          },
        },
      });
      await Promise.resolve();
    });

    expect(reactFlowFitBoundsSpy).toHaveBeenCalledTimes(1);
    expect(reactFlowFitBoundsSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        width: expect.any(Number),
        height: expect.any(Number),
      }),
      expect.objectContaining({
        duration: 320,
        padding: 0,
      }),
    );
  });

  it('长条状新增节点会拆成多段自动导览并最终停在最后一段', async () => {
    vi.useFakeTimers();
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
              sessionId: 'session_tour_long',
              state: 'capturing',
              currentTimeMs: 30000,
              currentView: 'timeline',
              currentViewPinned: false,
              graph: {
                sessionId: 'session_tour_long',
                revision: 1,
                topics: [],
                nodes: [
                  {
                    id: 'n1',
                    type: 'claim',
                    text: '锚点节点',
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
                updatedAt: 100,
              },
            },
          });
        }
        return Promise.resolve({ success: true });
      },
    );

    await renderApp();
    reactFlowFitBoundsSpy.mockClear();

    await act(async () => {
      listeners[0]?.({
        type: 'MERGED_GRAPH_UPDATED',
        target: 'sidepanel',
        payload: {
          graph: {
            sessionId: 'session_tour_long',
            revision: 2,
            topics: [],
            nodes: [
              { id: 'n1', type: 'claim', text: '锚点节点', timestampMs: 0, status: 'confirmed' },
              { id: 'n2', type: 'reason', text: '新增节点二', timestampMs: 1000, status: 'confirmed' },
              { id: 'n3', type: 'reason', text: '新增节点三', timestampMs: 2000, status: 'confirmed' },
              { id: 'n4', type: 'reason', text: '新增节点四', timestampMs: 3000, status: 'confirmed' },
              { id: 'n5', type: 'reason', text: '新增节点五', timestampMs: 4000, status: 'confirmed' },
              { id: 'n6', type: 'reason', text: '新增节点六', timestampMs: 5000, status: 'confirmed' },
              { id: 'n7', type: 'reason', text: '新增节点七', timestampMs: 6000, status: 'confirmed' },
            ],
            edges: [
              { id: 'e1', source: 'n1', target: 'n2', type: 'supports' },
              { id: 'e2', source: 'n2', target: 'n3', type: 'supports' },
              { id: 'e3', source: 'n3', target: 'n4', type: 'supports' },
              { id: 'e4', source: 'n4', target: 'n5', type: 'supports' },
              { id: 'e5', source: 'n5', target: 'n6', type: 'supports' },
              { id: 'e6', source: 'n6', target: 'n7', type: 'supports' },
            ],
            viewHints: {
              defaultView: 'timeline',
              scores: {
                timeline: 5,
                causal: 0,
                comparison: 0,
                flow: 0,
                hierarchy: 0,
              },
            },
            updatedAt: 200,
          },
        },
      });
      await Promise.resolve();
    });

    expect(reactFlowFitBoundsSpy).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('auto-tour-status')).toHaveTextContent(/自动导览 1\/2/);

    await act(async () => {
      vi.advanceTimersByTime(4000);
    });

    expect(reactFlowFitBoundsSpy).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('auto-tour-status')).toHaveTextContent(/自动导览 2\/2/);
    const finalBounds = reactFlowFitBoundsSpy.mock.calls.at(-1)?.[0];

    await act(async () => {
      vi.advanceTimersByTime(6000);
    });

    expect(screen.getByTestId('auto-tour-status')).toHaveTextContent('运行中');
    expect(reactFlowFitBoundsSpy.mock.calls.at(-1)?.[0]).toEqual(finalBounds);
  });

  it('当前视图已经较近时会因相对缩放阈值提前分段', async () => {
    vi.useFakeTimers();
    const listeners: Array<(message: { type?: string; target?: string; payload?: Record<string, unknown> }) => void> = [];
    reactFlowViewport.x = 0; reactFlowViewport.y = 0; reactFlowViewport.zoom = 1.1;
    reactFlowGetViewportSpy.mockImplementation(() => reactFlowViewport);
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
              sessionId: 'session_relative_split',
              state: 'capturing',
              currentTimeMs: 30000,
              currentView: 'timeline',
              currentViewPinned: false,
              graph: {
                sessionId: 'session_relative_split',
                revision: 1,
                topics: [],
                nodes: [
                  {
                    id: 'n1',
                    type: 'claim',
                    text: '锚点节点',
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
                updatedAt: 100,
              },
            },
          });
        }
        return Promise.resolve({ success: true });
      },
    );

    await renderApp();
    reactFlowFitBoundsSpy.mockClear();

    await act(async () => {
      listeners[0]?.({
        type: 'MERGED_GRAPH_UPDATED',
        target: 'sidepanel',
        payload: {
          graph: {
            sessionId: 'session_relative_split',
            revision: 2,
            topics: [],
            nodes: [
              { id: 'n1', type: 'claim', text: '锚点节点', timestampMs: 0, status: 'confirmed' },
              { id: 'n2', type: 'reason', text: '新增节点二', timestampMs: 1000, status: 'confirmed' },
              { id: 'n3', type: 'reason', text: '新增节点三', timestampMs: 2000, status: 'confirmed' },
              { id: 'n4', type: 'reason', text: '新增节点四', timestampMs: 3000, status: 'confirmed' },
              { id: 'n5', type: 'reason', text: '新增节点五', timestampMs: 4000, status: 'confirmed' },
            ],
            edges: [
              { id: 'e1', source: 'n1', target: 'n2', type: 'supports' },
              { id: 'e2', source: 'n2', target: 'n3', type: 'supports' },
              { id: 'e3', source: 'n3', target: 'n4', type: 'supports' },
              { id: 'e4', source: 'n4', target: 'n5', type: 'supports' },
            ],
            viewHints: {
              defaultView: 'timeline',
              scores: {
                timeline: 4,
                causal: 0,
                comparison: 0,
                flow: 0,
                hierarchy: 0,
              },
            },
            updatedAt: 200,
          },
        },
      });
      await Promise.resolve();
    });

    expect(reactFlowFitBoundsSpy).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('auto-tour-status')).toHaveTextContent(/自动导览 1\/2/);

    await act(async () => {
      vi.advanceTimersByTime(3500);
    });

    expect(reactFlowFitBoundsSpy).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('auto-tour-status')).toHaveTextContent(/自动导览 2\/2/);
  });

  it('新增节点即使已在当前视口内也会聚焦跟随并放大到目标区域', async () => {
    const listeners: Array<(message: { type?: string; target?: string; payload?: Record<string, unknown> }) => void> = [];
    reactFlowViewport.x = 300; reactFlowViewport.y = 210; reactFlowViewport.zoom = 0.3;
    reactFlowGetViewportSpy.mockImplementation(() => reactFlowViewport);
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
              sessionId: 'session_visible_view',
              state: 'capturing',
              currentTimeMs: 30000,
              currentView: 'timeline',
              currentViewPinned: false,
              graph: {
                sessionId: 'session_visible_view',
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
                    timeline: 3,
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
        return Promise.resolve({ success: true });
      },
    );

    await renderApp();
    reactFlowFitBoundsSpy.mockClear();

    await act(async () => {
      listeners[0]?.({
        type: 'MERGED_GRAPH_UPDATED',
        target: 'sidepanel',
        payload: {
          graph: {
            sessionId: 'session_visible_view',
            revision: 2,
            topics: [],
            nodes: [
              {
                id: 'n1',
                type: 'claim',
                text: '节点一',
                timestampMs: 0,
                status: 'confirmed',
              },
              {
                id: 'n2',
                type: 'reason',
                text: '仍在视口里的新增原因',
                timestampMs: 1000,
                status: 'confirmed',
              },
            ],
            edges: [
              {
                id: 'e1',
                source: 'n1',
                target: 'n2',
                type: 'supports',
              },
            ],
            viewHints: {
              defaultView: 'timeline',
              scores: {
                timeline: 4,
                causal: 0,
                comparison: 0,
                flow: 0,
                hierarchy: 0,
              },
            },
            updatedAt: 200,
          },
        },
      });
      await Promise.resolve();
    });

    expect(reactFlowFitBoundsSpy).toHaveBeenCalledTimes(1);
    expect(reactFlowFitBoundsSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        width: expect.any(Number),
        height: expect.any(Number),
      }),
      expect.objectContaining({
        duration: 320,
        padding: 0,
      }),
    );
    const targetBounds = reactFlowFitBoundsSpy.mock.calls[0]?.[0];
    expect(targetBounds.width).toBeLessThanOrEqual(960 / 0.9 + 0.001);
    expect(targetBounds.height).toBeLessThanOrEqual(720 / 0.9 + 0.001);
  });

  it('用户刚手动移动画布后会暂停自动导览并在 3 秒后从下一段恢复', async () => {
    vi.useFakeTimers();
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
              sessionId: 'session_user_control',
              state: 'capturing',
              currentTimeMs: 30000,
              currentView: 'timeline',
              currentViewPinned: false,
              graph: {
                sessionId: 'session_user_control',
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
                    timeline: 3,
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
        return Promise.resolve({ success: true });
      },
    );

    await renderApp();

    await act(async () => {
      listeners[0]?.({
        type: 'MERGED_GRAPH_UPDATED',
        target: 'sidepanel',
        payload: {
          graph: {
            sessionId: 'session_user_control',
            revision: 2,
            topics: [],
            nodes: [
              { id: 'n1', type: 'claim', text: '节点一', timestampMs: 0, status: 'confirmed' },
              { id: 'n2', type: 'reason', text: '新增原因一', timestampMs: 1000, status: 'confirmed' },
              { id: 'n3', type: 'reason', text: '新增原因二', timestampMs: 2000, status: 'confirmed' },
              { id: 'n4', type: 'reason', text: '新增原因三', timestampMs: 3000, status: 'confirmed' },
              { id: 'n5', type: 'reason', text: '新增原因四', timestampMs: 4000, status: 'confirmed' },
              { id: 'n6', type: 'reason', text: '新增原因五', timestampMs: 5000, status: 'confirmed' },
              { id: 'n7', type: 'reason', text: '新增原因六', timestampMs: 6000, status: 'confirmed' },
            ],
            edges: [
              { id: 'e1', source: 'n1', target: 'n2', type: 'supports' },
              { id: 'e2', source: 'n2', target: 'n3', type: 'supports' },
              { id: 'e3', source: 'n3', target: 'n4', type: 'supports' },
              { id: 'e4', source: 'n4', target: 'n5', type: 'supports' },
              { id: 'e5', source: 'n5', target: 'n6', type: 'supports' },
              { id: 'e6', source: 'n6', target: 'n7', type: 'supports' },
            ],
            viewHints: {
              defaultView: 'timeline',
              scores: {
                timeline: 4,
                causal: 0,
                comparison: 0,
                flow: 0,
                hierarchy: 0,
              },
            },
            updatedAt: 200,
          },
        },
      });
      await Promise.resolve();
    });

    expect(reactFlowFitBoundsSpy).toHaveBeenCalledTimes(1);
    fireEvent.mouseDown(screen.getByTestId('reactflow-mock'));
    fireEvent.mouseUp(screen.getByTestId('reactflow-mock'));
    expect(screen.getByTestId('auto-tour-status')).toHaveTextContent(/导览暂停 2\/2/);

    await act(async () => {
      vi.advanceTimersByTime(2999);
    });
    expect(reactFlowFitBoundsSpy).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(reactFlowFitBoundsSpy).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('auto-tour-status')).toHaveTextContent(/自动导览 2\/2/);
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
});
