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
  setReactFlowInitMode,
  setReactFlowSimulateAsyncMoveOnFit,
  setReactFlowSimulateMoveOnFit,
  triggerDeferredReactFlowInit,
  setupAppTests,
  teardownAppTests,
  clientWidthGetter,
  clientHeightGetter,
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
              currentView: 'comparison',
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
                  defaultView: 'comparison',
                  scores: {
                    timeline: 0,
                    causal: 0,
                    comparison: 3,
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
      expect(screen.getByRole('button', { name: /对比/ })).toHaveStyle({
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

    expect(screen.getByRole('button', { name: /对比/ })).toHaveStyle({
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
    expect(screen.getByText(/连线 \+1/)).toBeInTheDocument();
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
    // 动态提取总阶段数（两阶段导览产生 structure + reading stages）
    const initialStatus = screen.getByTestId('auto-tour-status').textContent ?? '';
    const totalMatch = initialStatus.match(/(\d+)\/(\d+)/);
    expect(totalMatch).not.toBeNull();
    const totalStages = parseInt(totalMatch![2], 10);
    expect(totalStages).toBeGreaterThanOrEqual(2);

    // 推进足够的总时间覆盖所有阶段（每阶段最多 5000ms + 320ms 动画）
    await act(async () => {
      vi.advanceTimersByTime(6000 * totalStages);
    });

    // fitBounds 调用次数等于阶段总数
    expect(reactFlowFitBoundsSpy).toHaveBeenCalledTimes(totalStages);
    const finalBounds = reactFlowFitBoundsSpy.mock.calls.at(-1)?.[0];

    // 导览结束后视口不再变化
    await act(async () => {
      vi.advanceTimersByTime(6000);
    });

    expect(screen.getByTestId('auto-tour-status')).toHaveTextContent('运行中');
    expect(reactFlowFitBoundsSpy.mock.calls.at(-1)?.[0]).toEqual(finalBounds);
  });

  it('导览单元结束后新节点不会排到已完成的旧 batch 后面', async () => {
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
              sessionId: 'session_completed_batch',
              state: 'capturing',
              currentTimeMs: 0,
              currentView: 'causal',
              currentViewPinned: false,
              graph: {
                sessionId: 'session_completed_batch',
                revision: 1,
                topics: [],
                nodes: [
                  { id: 'n1', type: 'claim', text: '锚点', timestampMs: 0, status: 'confirmed' },
                ],
                edges: [],
                viewHints: { defaultView: 'causal', scores: { causal: 3 } },
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
            sessionId: 'session_completed_batch',
            revision: 2,
            topics: [],
            nodes: [
              { id: 'n1', type: 'claim', text: '锚点', timestampMs: 0, status: 'confirmed' },
              { id: 'n2', type: 'reason', text: '第一轮新增', timestampMs: 1000, status: 'confirmed' },
            ],
            edges: [{ id: 'e12', source: 'n1', target: 'n2', type: 'supports' }],
            viewHints: { defaultView: 'causal', scores: { causal: 4 } },
            updatedAt: 200,
          },
        },
      });
      await Promise.resolve();
    });

    expect(reactFlowFitBoundsSpy).toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(12000);
    });

    const callsAfterFirstTour = reactFlowFitBoundsSpy.mock.calls.length;

    await act(async () => {
      listeners[0]?.({
        type: 'MERGED_GRAPH_UPDATED',
        target: 'sidepanel',
        payload: {
          graph: {
            sessionId: 'session_completed_batch',
            revision: 3,
            topics: [],
            nodes: [
              { id: 'n1', type: 'claim', text: '锚点', timestampMs: 0, status: 'confirmed' },
              { id: 'n2', type: 'reason', text: '第一轮新增', timestampMs: 1000, status: 'confirmed' },
              { id: 'n3', type: 'reason', text: '第二轮新增', timestampMs: 2000, status: 'confirmed' },
            ],
            edges: [
              { id: 'e12', source: 'n1', target: 'n2', type: 'supports' },
              { id: 'e23', source: 'n2', target: 'n3', type: 'supports' },
            ],
            viewHints: { defaultView: 'causal', scores: { causal: 5 } },
            updatedAt: 300,
          },
        },
      });
      await Promise.resolve();
    });

    expect(reactFlowFitBoundsSpy.mock.calls.length).toBeGreaterThan(callsAfterFirstTour);

    vi.useRealTimers();
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
    expect(screen.getByTestId('auto-tour-status')).toHaveTextContent(/自动导览 1\/2 \(全览\)/);

    await act(async () => {
      vi.advanceTimersByTime(3500);
    });

    expect(reactFlowFitBoundsSpy).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('auto-tour-status')).toHaveTextContent(/自动导览 2\/2 \(阅读\)/);
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

  it('用户刚手动移动画布后会暂停自动导览并在 7 秒后从下一段恢复', async () => {
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
    // 动态提取暂停时的阶段信息
    const pauseStatus = screen.getByTestId('auto-tour-status').textContent ?? '';
    const pauseMatch = pauseStatus.match(/导览暂停 (\d+)\/(\d+)/);
    expect(pauseMatch).not.toBeNull();
    const pauseTotal = parseInt(pauseMatch![2], 10);
    const pauseCurrent = parseInt(pauseMatch![1], 10);
    expect(pauseCurrent).toBe(2);
    expect(pauseTotal).toBeGreaterThanOrEqual(2);
    // 暂停时 progress 已指向下一段，但 activeAutoTourStage 仍为正在播放的结构段
    expect(screen.getByTestId('auto-tour-status')).toHaveTextContent(
      new RegExp(`导览暂停 ${pauseCurrent}/${pauseTotal} \\(全览\\)`),
    );

    await act(async () => {
      vi.advanceTimersByTime(6999);
    });
    expect(reactFlowFitBoundsSpy).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(reactFlowFitBoundsSpy).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('auto-tour-status')).toHaveTextContent(
      new RegExp(`自动导览 ${pauseCurrent}/${pauseTotal} \\(阅读\\)`),
    );
  });

  it('丢失 moveEnd 时用户交互状态会过期，不会永久阻塞新节点导览', async () => {
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
              sessionId: 'session_lost_move_end',
              state: 'capturing',
              currentTimeMs: 0,
              currentView: 'causal',
              currentViewPinned: false,
              graph: {
                sessionId: 'session_lost_move_end',
                revision: 1,
                topics: [],
                nodes: [
                  { id: 'n1', type: 'claim', text: '锚点', timestampMs: 0, status: 'confirmed' },
                ],
                edges: [],
                viewHints: { defaultView: 'causal', scores: { causal: 3 } },
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

    fireEvent.mouseDown(screen.getByTestId('reactflow-mock'));

    await act(async () => {
      vi.advanceTimersByTime(8000);
    });

    await act(async () => {
      listeners[0]?.({
        type: 'MERGED_GRAPH_UPDATED',
        target: 'sidepanel',
        payload: {
          graph: {
            sessionId: 'session_lost_move_end',
            revision: 2,
            topics: [],
            nodes: [
              { id: 'n1', type: 'claim', text: '锚点', timestampMs: 0, status: 'confirmed' },
              { id: 'n2', type: 'reason', text: '新增节点', timestampMs: 1000, status: 'confirmed' },
            ],
            edges: [{ id: 'e12', source: 'n1', target: 'n2', type: 'supports' }],
            viewHints: { defaultView: 'causal', scores: { causal: 4 } },
            updatedAt: 200,
          },
        },
      });
      await Promise.resolve();
    });

    expect(reactFlowFitBoundsSpy).toHaveBeenCalled();

    vi.useRealTimers();
  });

  it('无锚点且无新增内部边时跳过结构揭示直接阅读', async () => {
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
              sessionId: 'session_skip_structure',
              state: 'capturing',
              currentTimeMs: 0,
              currentView: 'causal',
              currentViewPinned: true,
              graph: {
                sessionId: 'session_skip_structure',
                revision: 1,
                topics: [],
                nodes: [
                  { id: 'n0', type: 'claim', text: '已存在节点', timestampMs: 0, status: 'confirmed' },
                ],
                edges: [],
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
            sessionId: 'session_skip_structure',
            revision: 2,
            topics: [],
            nodes: [
              { id: 'n0', type: 'claim', text: '已存在节点', timestampMs: 0, status: 'confirmed' },
              { id: 'n1', type: 'claim', text: '新话题孤立节点', timestampMs: 1000, status: 'confirmed' },
            ],
            edges: [],
            updatedAt: 200,
          },
        },
      });
      await Promise.resolve();
    });

    expect(reactFlowFitBoundsSpy).toHaveBeenCalled();
    expect(screen.getByTestId('auto-tour-status')).toHaveTextContent(/自动导览 1\/1 \(阅读\)/);
    expect(screen.getByTestId('graph-node-card-n1')).toHaveAttribute('data-display-mode', 'readable');
    expect(screen.getByTestId('graph-node-card-n1')).toHaveAttribute('data-tour-added', 'true');
  });

  it('连续图更新会排队播放而不是合并成一轮', async () => {
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
              sessionId: 'session_queue',
              state: 'capturing',
              currentTimeMs: 30000,
              currentView: 'timeline',
              currentViewPinned: false,
              graph: {
                sessionId: 'session_queue',
                revision: 1,
                topics: [],
                nodes: [
                  { id: 'n0', type: 'claim', text: '锚点节点', timestampMs: 0, status: 'confirmed' },
                ],
                edges: [],
                viewHints: {
                  defaultView: 'timeline',
                  scores: { timeline: 3, causal: 0, comparison: 0, flow: 0, hierarchy: 0 },
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

    const graph1 = {
      sessionId: 'session_queue',
      revision: 2,
      topics: [],
      nodes: [
        { id: 'n0', type: 'claim', text: '锚点节点', timestampMs: 0, status: 'confirmed' },
        { id: 'n1', type: 'reason', text: '第一轮新增一', timestampMs: 1000, status: 'confirmed' },
        { id: 'n2', type: 'reason', text: '第一轮新增二', timestampMs: 2000, status: 'confirmed' },
        { id: 'n3', type: 'reason', text: '第一轮新增三', timestampMs: 3000, status: 'confirmed' },
        { id: 'n4', type: 'reason', text: '第一轮新增四', timestampMs: 4000, status: 'confirmed' },
        { id: 'n5', type: 'reason', text: '第一轮新增五', timestampMs: 5000, status: 'confirmed' },
        { id: 'n6', type: 'reason', text: '第一轮新增六', timestampMs: 6000, status: 'confirmed' },
      ],
      edges: [
        { id: 'e1', source: 'n0', target: 'n1', type: 'supports' },
        { id: 'e2', source: 'n1', target: 'n2', type: 'supports' },
        { id: 'e3', source: 'n2', target: 'n3', type: 'supports' },
        { id: 'e4', source: 'n3', target: 'n4', type: 'supports' },
        { id: 'e5', source: 'n4', target: 'n5', type: 'supports' },
        { id: 'e6', source: 'n5', target: 'n6', type: 'supports' },
      ],
      viewHints: {
        defaultView: 'timeline',
        scores: { timeline: 5, causal: 0, comparison: 0, flow: 0, hierarchy: 0 },
      },
      updatedAt: 200,
    };

    // 发送第一轮更新（6 个新节点，足以触发多阶段导览）
    await act(async () => {
      listeners[0]?.({
        type: 'MERGED_GRAPH_UPDATED',
        target: 'sidepanel',
        payload: { graph: graph1 },
      });
      await Promise.resolve();
    });

    // 第一轮导览应已启动
    expect(reactFlowFitBoundsSpy).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('auto-tour-status')).toHaveTextContent(/自动导览/);

    // 第一轮导览仍在播放时发送第二轮更新
    const graph2 = {
      sessionId: 'session_queue',
      revision: 3,
      topics: [],
      nodes: [
        ...graph1.nodes,
        { id: 'n7', type: 'reason', text: '第二轮新增', timestampMs: 7000, status: 'confirmed' },
      ],
      edges: [
        ...graph1.edges,
        { id: 'e7', source: 'n6', target: 'n7', type: 'supports' },
      ],
      viewHints: {
        defaultView: 'timeline',
        scores: { timeline: 6, causal: 0, comparison: 0, flow: 0, hierarchy: 0 },
      },
      updatedAt: 300,
    };

    await act(async () => {
      listeners[0]?.({
        type: 'MERGED_GRAPH_UPDATED',
        target: 'sidepanel',
        payload: { graph: graph2 },
      });
      await Promise.resolve();
    });

    // 推进足够时间完成第一轮导览的所有阶段并开始第二轮
    await act(async () => {
      vi.advanceTimersByTime(15000);
    });

    // 第二轮导览应该已经开始了（fitBounds 次数增加，说明队列中的第二轮被取出播放）
    expect(reactFlowFitBoundsSpy.mock.calls.length).toBeGreaterThan(1);
  });

  it('连续 3 轮图更新排队后依次独立播放导览', async () => {
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
              sessionId: 'session_3round',
              state: 'capturing',
              currentTimeMs: 30000,
              currentView: 'causal',
              currentViewPinned: false,
              graph: {
                sessionId: 'session_3round',
                revision: 1,
                topics: [],
                nodes: [
                  { id: 'n0', type: 'claim', text: '锚点节点', timestampMs: 0, status: 'confirmed' },
                ],
                edges: [],
                viewHints: { defaultView: 'causal', scores: { causal: 3 } },
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

    // ---- 第一轮更新：添加 n1, n2, n3 ----
    const graph1 = {
      sessionId: 'session_3round',
      revision: 2,
      topics: [],
      nodes: [
        { id: 'n0', type: 'claim', text: '锚点节点', timestampMs: 0, status: 'confirmed' },
        { id: 'n1', type: 'reason', text: '第一轮一', timestampMs: 1000, status: 'confirmed' },
        { id: 'n2', type: 'reason', text: '第一轮二', timestampMs: 2000, status: 'confirmed' },
        { id: 'n3', type: 'reason', text: '第一轮三', timestampMs: 3000, status: 'confirmed' },
      ],
      edges: [
        { id: 'e01', source: 'n0', target: 'n1', type: 'supports' },
        { id: 'e12', source: 'n1', target: 'n2', type: 'supports' },
        { id: 'e23', source: 'n2', target: 'n3', type: 'supports' },
      ],
      viewHints: { defaultView: 'causal', scores: { causal: 5 } },
      updatedAt: 200,
    };

    await act(async () => {
      listeners[0]?.({
        type: 'MERGED_GRAPH_UPDATED',
        target: 'sidepanel',
        payload: { graph: graph1 },
      });
      await Promise.resolve();
    });

    // 第一轮导览已启动
    expect(reactFlowFitBoundsSpy).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('auto-tour-status')).toHaveTextContent(/自动导览/);
    // 第一轮节点应被标记为 tour-added
    expect(screen.getByTestId('graph-node-card-n1')).toHaveAttribute('data-tour-added', 'true');

    // ---- 第二轮更新（第一轮导览仍在播放）：添加 n4, n5 ----
    const graph2 = {
      sessionId: 'session_3round',
      revision: 3,
      topics: [],
      nodes: [
        ...graph1.nodes,
        { id: 'n4', type: 'reason', text: '第二轮一', timestampMs: 4000, status: 'confirmed' },
        { id: 'n5', type: 'reason', text: '第二轮二', timestampMs: 5000, status: 'confirmed' },
      ],
      edges: [
        ...graph1.edges,
        { id: 'e34', source: 'n3', target: 'n4', type: 'supports' },
        { id: 'e45', source: 'n4', target: 'n5', type: 'supports' },
      ],
      viewHints: { defaultView: 'causal', scores: { causal: 6 } },
      updatedAt: 300,
    };

    await act(async () => {
      listeners[0]?.({
        type: 'MERGED_GRAPH_UPDATED',
        target: 'sidepanel',
        payload: { graph: graph2 },
      });
      await Promise.resolve();
    });

    // ---- 第三轮更新（第一轮导览仍在播放）：添加 n6 ----
    const graph3 = {
      sessionId: 'session_3round',
      revision: 4,
      topics: [],
      nodes: [
        ...graph2.nodes,
        { id: 'n6', type: 'reason', text: '第三轮', timestampMs: 6000, status: 'confirmed' },
      ],
      edges: [
        ...graph2.edges,
        { id: 'e56', source: 'n5', target: 'n6', type: 'supports' },
      ],
      viewHints: { defaultView: 'causal', scores: { causal: 7 } },
      updatedAt: 400,
    };

    await act(async () => {
      listeners[0]?.({
        type: 'MERGED_GRAPH_UPDATED',
        target: 'sidepanel',
        payload: { graph: graph3 },
      });
      await Promise.resolve();
    });

    // ---- 推进时间：完成第一轮导览，第二轮应自动开始 ----
    await act(async () => {
      vi.advanceTimersByTime(6000);
    });

    const callsAfterRound1 = reactFlowFitBoundsSpy.mock.calls.length;
    expect(callsAfterRound1).toBeGreaterThan(1);

    // 第二轮节点应被标记为 tour-added
    expect(screen.getByTestId('graph-node-card-n4')).toHaveAttribute('data-tour-added', 'true');
    // 第一轮节点已不再被标记
    expect(screen.getByTestId('graph-node-card-n1')).toHaveAttribute('data-tour-added', 'false');

    // ---- 推进时间：完成第二轮导览，第三轮应自动开始 ----
    await act(async () => {
      vi.advanceTimersByTime(6000);
    });

    const callsAfterRound2 = reactFlowFitBoundsSpy.mock.calls.length;
    expect(callsAfterRound2).toBeGreaterThan(callsAfterRound1);

    // 第三轮节点应被标记为 tour-added
    expect(screen.getByTestId('graph-node-card-n6')).toHaveAttribute('data-tour-added', 'true');
    // 第二轮节点已不再被标记
    expect(screen.getByTestId('graph-node-card-n4')).toHaveAttribute('data-tour-added', 'false');

    vi.useRealTimers();
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
    expect(messageTypes).toEqual(['GET_GRAPH_DISPLAY_SETTINGS', 'GET_RUNTIME_SNAPSHOT']);
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
    expect(messageTypes).toEqual(['GET_GRAPH_DISPLAY_SETTINGS', 'GET_RUNTIME_SNAPSHOT']);
  });

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

  it('纯边更新不会清除紧邻的新增节点 seed，自动导览仍会触发', async () => {
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
              sessionId: 'session_edge_clobber',
              state: 'capturing',
              currentTimeMs: 0,
              currentView: 'timeline',
              currentViewPinned: false,
              graph: {
                sessionId: 'session_edge_clobber',
                revision: 1,
                topics: [],
                nodes: [
                  { id: 'n1', type: 'claim', text: '锚点', timestampMs: 0, status: 'confirmed' },
                ],
                edges: [],
                viewHints: {
                  defaultView: 'timeline',
                  scores: { timeline: 3, causal: 0, comparison: 0, flow: 0, hierarchy: 0 },
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

    // 在同一个 act 内依次发送两条消息，模拟 service worker 快速连续推送：
    // 消息 A：新增节点 n2（无新边）
    // 消息 B：仅新增边（无新节点）
    // 修复前：消息 B 的 setAutoTourSeed(null) 会清除消息 A 设置的 seed → 导览丢失
    // 修复后：消息 B 不调用 setAutoTourSeed → seed 保留 → 导览正常触发
    await act(async () => {
      listeners[0]({
        type: 'MERGED_GRAPH_UPDATED',
        target: 'sidepanel',
        payload: {
          graph: {
            sessionId: 'session_edge_clobber',
            revision: 2,
            topics: [],
            nodes: [
              { id: 'n1', type: 'claim', text: '锚点', timestampMs: 0, status: 'confirmed' },
              { id: 'n2', type: 'reason', text: '新增原因', timestampMs: 1000, status: 'confirmed' },
            ],
            edges: [],
            viewHints: {
              defaultView: 'timeline',
              scores: { timeline: 4, causal: 0, comparison: 0, flow: 0, hierarchy: 0 },
            },
            updatedAt: 200,
          },
        },
      });
      // 紧邻：纯边更新，addedNodeIds 为空
      listeners[0]({
        type: 'MERGED_GRAPH_UPDATED',
        target: 'sidepanel',
        payload: {
          graph: {
            sessionId: 'session_edge_clobber',
            revision: 3,
            topics: [],
            nodes: [
              { id: 'n1', type: 'claim', text: '锚点', timestampMs: 0, status: 'confirmed' },
              { id: 'n2', type: 'reason', text: '新增原因', timestampMs: 1000, status: 'confirmed' },
            ],
            edges: [
              { id: 'e1', source: 'n1', target: 'n2', type: 'supports' },
            ],
            viewHints: {
              defaultView: 'timeline',
              scores: { timeline: 4, causal: 0, comparison: 0, flow: 0, hierarchy: 0 },
            },
            updatedAt: 300,
          },
        },
      });
      await Promise.resolve();
    });

    // seed 未被清除 → 导览正常启动 → fitBounds 被调用
    expect(reactFlowFitBoundsSpy).toHaveBeenCalled();
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

  it('ReactFlow 晚于 graph update 完成 init 后仍会触发自动导览', async () => {
    setReactFlowInitMode('deferred');
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
              sessionId: 'session_deferred_init',
              state: 'capturing',
              currentTimeMs: 0,
              currentView: 'causal',
              currentViewPinned: false,
              graph: {
                sessionId: 'session_deferred_init',
                revision: 1,
                topics: [],
                nodes: [
                  { id: 'n1', type: 'claim', text: '锚点', timestampMs: 0, status: 'confirmed' },
                ],
                edges: [],
                viewHints: { defaultView: 'causal', scores: { causal: 2 } },
                updatedAt: 100,
              },
            },
          });
        }
        return Promise.resolve({ success: true });
      },
    );

    await renderApp();
    expect(reactFlowFitViewSpy).not.toHaveBeenCalled();

    await act(async () => {
      listeners[0]?.({
        type: 'MERGED_GRAPH_UPDATED',
        target: 'sidepanel',
        payload: {
          graph: {
            sessionId: 'session_deferred_init',
            revision: 2,
            topics: [],
            nodes: [
              { id: 'n1', type: 'claim', text: '锚点', timestampMs: 0, status: 'confirmed' },
              { id: 'n2', type: 'reason', text: '新增节点', timestampMs: 1000, status: 'confirmed' },
            ],
            edges: [{ id: 'e1', source: 'n1', target: 'n2', type: 'supports' }],
            viewHints: { defaultView: 'causal', scores: { causal: 3 } },
            updatedAt: 200,
          },
        },
      });
      await Promise.resolve();
    });

    expect(reactFlowFitBoundsSpy).not.toHaveBeenCalled();

    await act(async () => {
      triggerDeferredReactFlowInit();
      await Promise.resolve();
    });

    expect(reactFlowFitViewSpy).toHaveBeenCalled();
    expect(reactFlowFitBoundsSpy).toHaveBeenCalled();
  });

  it('容器尺寸为 0 时延后 init 会在尺寸恢复后触发自动导览', async () => {
    setReactFlowInitMode('deferred');
    clientWidthGetter.mockReturnValue(0);
    clientHeightGetter.mockReturnValue(0);

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
              sessionId: 'session_zero_size',
              state: 'capturing',
              currentTimeMs: 0,
              currentView: 'causal',
              currentViewPinned: false,
              graph: {
                sessionId: 'session_zero_size',
                revision: 1,
                topics: [],
                nodes: [
                  { id: 'n1', type: 'claim', text: '锚点', timestampMs: 0, status: 'confirmed' },
                ],
                edges: [],
                viewHints: { defaultView: 'causal', scores: { causal: 2 } },
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
            sessionId: 'session_zero_size',
            revision: 2,
            topics: [],
            nodes: [
              { id: 'n1', type: 'claim', text: '锚点', timestampMs: 0, status: 'confirmed' },
              { id: 'n2', type: 'reason', text: '新增节点', timestampMs: 1000, status: 'confirmed' },
            ],
            edges: [{ id: 'e1', source: 'n1', target: 'n2', type: 'supports' }],
            viewHints: { defaultView: 'causal', scores: { causal: 3 } },
            updatedAt: 200,
          },
        },
      });
      await Promise.resolve();
    });

    expect(reactFlowFitBoundsSpy).not.toHaveBeenCalled();

    clientWidthGetter.mockReturnValue(960);
    clientHeightGetter.mockReturnValue(720);

    await act(async () => {
      triggerDeferredReactFlowInit();
      await Promise.resolve();
    });

    expect(reactFlowFitViewSpy).toHaveBeenCalled();
    expect(reactFlowFitBoundsSpy).toHaveBeenCalled();
  });

  it('导览结束后会消费排队 seed 中未能及时启动的后续新增节点', async () => {
    vi.useFakeTimers();
    let blockTourLayout = false;
    clientWidthGetter.mockImplementation(function mockClientWidth(this: HTMLElement) {
      if (blockTourLayout) {
        return 0;
      }
      return 960;
    });
    clientHeightGetter.mockImplementation(function mockClientHeight(this: HTMLElement) {
      if (blockTourLayout) {
        return 0;
      }
      return 720;
    });

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
              sessionId: 'session_drain_seed',
              state: 'capturing',
              currentTimeMs: 0,
              currentView: 'causal',
              currentViewPinned: false,
              graph: {
                sessionId: 'session_drain_seed',
                revision: 1,
                topics: [],
                nodes: [
                  { id: 'n1', type: 'claim', text: '锚点', timestampMs: 0, status: 'confirmed' },
                ],
                edges: [],
                viewHints: { defaultView: 'causal', scores: { causal: 2 } },
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
            sessionId: 'session_drain_seed',
            revision: 2,
            topics: [],
            nodes: [
              { id: 'n1', type: 'claim', text: '锚点', timestampMs: 0, status: 'confirmed' },
              { id: 'n2', type: 'reason', text: '第一轮新增', timestampMs: 1000, status: 'confirmed' },
            ],
            edges: [{ id: 'e12', source: 'n1', target: 'n2', type: 'supports' }],
            viewHints: { defaultView: 'causal', scores: { causal: 3 } },
            updatedAt: 200,
          },
        },
      });
      await Promise.resolve();
    });

    const fitBoundsAfterFirstUpdate = reactFlowFitBoundsSpy.mock.calls.length;
    expect(fitBoundsAfterFirstUpdate).toBeGreaterThan(0);

    blockTourLayout = true;
    await act(async () => {
      listeners[0]?.({
        type: 'MERGED_GRAPH_UPDATED',
        target: 'sidepanel',
        payload: {
          graph: {
            sessionId: 'session_drain_seed',
            revision: 3,
            topics: [],
            nodes: [
              { id: 'n1', type: 'claim', text: '锚点', timestampMs: 0, status: 'confirmed' },
              { id: 'n2', type: 'reason', text: '第一轮新增', timestampMs: 1000, status: 'confirmed' },
              { id: 'n3', type: 'reason', text: '第二轮新增', timestampMs: 2000, status: 'confirmed' },
            ],
            edges: [
              { id: 'e12', source: 'n1', target: 'n2', type: 'supports' },
              { id: 'e23', source: 'n2', target: 'n3', type: 'supports' },
            ],
            viewHints: { defaultView: 'causal', scores: { causal: 4 } },
            updatedAt: 300,
          },
        },
      });
      await Promise.resolve();
    });
    blockTourLayout = false;

    const fitBoundsAfterBlockedSecondUpdate = reactFlowFitBoundsSpy.mock.calls.length;
    expect(fitBoundsAfterBlockedSecondUpdate).toBe(fitBoundsAfterFirstUpdate);

    await act(async () => {
      vi.advanceTimersByTime(8000);
    });

    expect(reactFlowFitBoundsSpy.mock.calls.length).toBeGreaterThan(fitBoundsAfterBlockedSecondUpdate);

    vi.useRealTimers();
  });

  it('fitView/fitBounds 触发的 programmatic viewport move 不会阻塞新增节点后的自动导览', async () => {
    setReactFlowSimulateMoveOnFit(true);
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
              sessionId: 'session_programmatic_move',
              state: 'capturing',
              currentTimeMs: 30000,
              currentView: 'timeline',
              currentViewPinned: false,
              graph: {
                sessionId: 'session_programmatic_move',
                revision: 1,
                topics: [],
                nodes: [
                  { id: 'n1', type: 'claim', text: '锚点', timestampMs: 0, status: 'confirmed' },
                  { id: 'n2', type: 'claim', text: '节点二', timestampMs: 30000, status: 'confirmed' },
                ],
                edges: [],
                viewHints: {
                  defaultView: 'timeline',
                  scores: { timeline: 3, causal: 0, comparison: 0, flow: 0, hierarchy: 0 },
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
            sessionId: 'session_programmatic_move',
            revision: 2,
            topics: [],
            nodes: [
              { id: 'n1', type: 'claim', text: '锚点', timestampMs: 0, status: 'confirmed' },
              { id: 'n2', type: 'claim', text: '节点二', timestampMs: 30000, status: 'confirmed' },
              { id: 'n3', type: 'reason', text: '新增原因', timestampMs: 60000, status: 'confirmed' },
            ],
            edges: [
              { id: 'e1', source: 'n2', target: 'n3', type: 'supports' },
            ],
            viewHints: {
              defaultView: 'timeline',
              scores: { timeline: 4, causal: 0, comparison: 0, flow: 0, hierarchy: 0 },
            },
            updatedAt: 200,
          },
        },
      });
      await Promise.resolve();
    });

    expect(reactFlowFitBoundsSpy).toHaveBeenCalled();
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

  it('异步 programmatic viewport move 不会把多段自动导览误暂停', async () => {
    vi.useFakeTimers();
    setReactFlowSimulateAsyncMoveOnFit(true);
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
              sessionId: 'session_async_programmatic_move',
              state: 'capturing',
              currentTimeMs: 0,
              currentView: 'timeline',
              currentViewPinned: false,
              graph: {
                sessionId: 'session_async_programmatic_move',
                revision: 1,
                topics: [],
                nodes: [
                  { id: 'n0', type: 'claim', text: '锚点节点', timestampMs: 0, status: 'confirmed' },
                ],
                edges: [],
                viewHints: {
                  defaultView: 'timeline',
                  scores: { timeline: 3, causal: 0, comparison: 0, flow: 0, hierarchy: 0 },
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

    const newNodes = Array.from({ length: 10 }, (_, index) => ({
      id: `n${index + 1}`,
      type: 'reason',
      text: `新增节点 ${index + 1}`,
      timestampMs: (index + 1) * 30000,
      status: 'confirmed',
    }));
    const newEdges = newNodes.map((node, index) => ({
      id: `e${index}`,
      source: index === 0 ? 'n0' : `n${index}`,
      target: node.id,
      type: 'supports',
    }));

    await act(async () => {
      listeners[0]?.({
        type: 'MERGED_GRAPH_UPDATED',
        target: 'sidepanel',
        payload: {
          graph: {
            sessionId: 'session_async_programmatic_move',
            revision: 2,
            topics: [],
            nodes: [
              { id: 'n0', type: 'claim', text: '锚点节点', timestampMs: 0, status: 'confirmed' },
              ...newNodes,
            ],
            edges: newEdges,
            viewHints: {
              defaultView: 'timeline',
              scores: { timeline: 6, causal: 0, comparison: 0, flow: 0, hierarchy: 0 },
            },
            updatedAt: 200,
          },
        },
      });
      await Promise.resolve();
    });

    expect(reactFlowFitBoundsSpy).toHaveBeenCalledTimes(1);
    const initialStatus = screen.getByTestId('auto-tour-status').textContent ?? '';
    const totalMatch = initialStatus.match(/自动导览 1\/(\d+)/);
    expect(totalMatch).not.toBeNull();
    expect(Number(totalMatch![1])).toBeGreaterThan(1);

    await act(async () => {
      vi.advanceTimersByTime(0);
    });

    expect(screen.getByTestId('auto-tour-status')).not.toHaveTextContent(/导览暂停/);

    await act(async () => {
      vi.advanceTimersByTime(6000);
    });

    expect(reactFlowFitBoundsSpy.mock.calls.length).toBeGreaterThan(1);

    vi.useRealTimers();
  });

  it('会话首个节点到达后 layout cache useEffect 不会清除 seed，自动导览立即触发', async () => {
    setReactFlowSimulateMoveOnFit(true);
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
              sessionId: 'session_first_node',
              state: 'structuring',
              currentTimeMs: 0,
              currentView: 'timeline',
              currentViewPinned: false,
              graph: {
                sessionId: 'session_first_node',
                revision: 0,
                topics: [],
                nodes: [],
                edges: [],
                viewHints: {
                  defaultView: 'timeline',
                  scores: { timeline: 0, causal: 0, comparison: 0, flow: 0, hierarchy: 0 },
                },
                updatedAt: 0,
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
            sessionId: 'session_first_node',
            revision: 1,
            topics: [],
            nodes: [
              { id: 'n1', type: 'claim', text: '首个节点', timestampMs: 0, status: 'confirmed' },
              { id: 'n2', type: 'reason', text: '新增原因', timestampMs: 1000, status: 'confirmed' },
            ],
            edges: [
              { id: 'e1', source: 'n1', target: 'n2', type: 'supports' },
            ],
            viewHints: {
              defaultView: 'timeline',
              scores: { timeline: 3, causal: 0, comparison: 0, flow: 0, hierarchy: 0 },
            },
            updatedAt: 100,
          },
        },
      });
      await Promise.resolve();
    });

    expect(reactFlowFitBoundsSpy).toHaveBeenCalled();
  });
});
