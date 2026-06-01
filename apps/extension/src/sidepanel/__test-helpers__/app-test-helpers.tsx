import { vi, type MockInstance } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';
import { act, useEffect, type ReactNode } from 'react';

// —— ReactFlow mock spies ——
export const reactFlowFitViewSpy = vi.fn();
export const reactFlowFitBoundsSpy = vi.fn();
export const reactFlowGetViewportSpy = vi.fn();
export let reactFlowViewport = { x: 0, y: 0, zoom: 1 };
/** immediate：mount 后立刻 onInit；deferred：等 triggerDeferredReactFlowInit() */
let reactFlowInitModeState: 'immediate' | 'deferred' = 'immediate';
/** 为 true 时 fitView/fitBounds 会同步触发 onMoveStart/onMoveEnd，模拟真实 React Flow */
let reactFlowSimulateMoveOnFitState = false;
let reactFlowSimulateAsyncMoveOnFitState = false;
let capturedOnMoveStart: ((event?: unknown) => void) | null = null;
let capturedOnMoveEnd: ((event?: unknown) => void) | null = null;

export function setReactFlowInitMode(mode: 'immediate' | 'deferred') {
  reactFlowInitModeState = mode;
}
export function setReactFlowSimulateMoveOnFit(enabled: boolean) {
  reactFlowSimulateMoveOnFitState = enabled;
}
export function setReactFlowSimulateAsyncMoveOnFit(enabled: boolean) {
  reactFlowSimulateAsyncMoveOnFitState = enabled;
}
export function getReactFlowInitMode() {
  return reactFlowInitModeState;
}
let deferredReactFlowOnInit:
  | ((instance: {
      fitView: typeof reactFlowFitViewSpy;
      fitBounds: typeof reactFlowFitBoundsSpy;
      getViewport: typeof reactFlowGetViewportSpy;
    }) => void)
  | null = null;

export function triggerDeferredReactFlowInit() {
  // deferred 模式下 mock ReactFlow 不会自动 onInit，须手动调用。
  // GraphArea 在 idle 空图时渲染 EmptyState；首次有节点或 remount 后需再次 trigger。
  if (!deferredReactFlowOnInit) {
    return;
  }
  deferredReactFlowOnInit({
    fitView: reactFlowFitViewSpy,
    fitBounds: reactFlowFitBoundsSpy,
    getViewport: reactFlowGetViewportSpy,
  });
  deferredReactFlowOnInit = null;
}

function fireSimulatedViewportMove() {
  if (reactFlowSimulateAsyncMoveOnFitState) {
    window.setTimeout(() => {
      capturedOnMoveStart?.();
      capturedOnMoveEnd?.();
    }, 0);
    return;
  }
  if (!reactFlowSimulateMoveOnFitState) {
    return;
  }
  capturedOnMoveStart?.();
  capturedOnMoveEnd?.();
}

/**
 * 创建 reactflow mock 模块对象。
 * 导出此函数以便测试文件在自己的 vi.mock() 中复用，
 * 确保跨 monorepo 包（如 @listen-graphic/ui）的 mock 一致性。
 *
 * deferred 模式：`onInit` 仅注册到 `triggerDeferredReactFlowInit()`，不会随 mount 自动触发。
 * 配合 GraphArea 的 EmptyState 条件挂载，fixture 序列等测试须在 ReactFlow 每次 mount 后手动 trigger。
 */
export function createReactFlowMock() {
  return {
    ReactFlow: ({
      children,
      nodes = [],
      edges = [],
      nodeTypes = {},
      fitView,
      onInit,
      onNodeClick,
      onMoveStart,
      onMoveEnd,
    }: {
      children?: ReactNode;
      nodes?: Array<{
        id: string;
        type?: string;
        position?: { x: number; y: number };
        data?: { label?: string; timestampMs?: number; displayMode?: string; isTourAnchor?: boolean; isTourAdded?: boolean };
      }>;
      edges?: Array<{
        id: string;
        source?: string;
        target?: string;
        sourceHandle?: string;
        targetHandle?: string;
        type?: string;
      }>;
      nodeTypes?: Record<string, (props: Record<string, unknown>) => ReactNode>;
      fitView?: boolean;
      onInit?: (instance: {
        fitView: typeof reactFlowFitViewSpy;
        fitBounds: typeof reactFlowFitBoundsSpy;
        getViewport: typeof reactFlowGetViewportSpy;
      }) => void;
      onNodeClick?: (_event: React.MouseEvent, node: { id: string; type?: string; position?: { x: number; y: number }; data?: Record<string, unknown> }) => void;
      onMoveStart?: (event?: unknown) => void;
      onMoveEnd?: (event?: unknown) => void;
    }) => {
      capturedOnMoveStart = onMoveStart ?? null;
      capturedOnMoveEnd = onMoveEnd ?? null;

      useEffect(() => {
        const instance = {
          fitView: reactFlowFitViewSpy,
          fitBounds: reactFlowFitBoundsSpy,
          getViewport: reactFlowGetViewportSpy,
        };
        if (reactFlowInitModeState === 'immediate') {
          onInit?.(instance);
          return;
        }
        deferredReactFlowOnInit = onInit ?? null;
      }, [onInit]);

      return (
        <div
          data-testid="reactflow-mock"
          data-fit-view-prop={fitView ? 'true' : 'false'}
          onMouseDown={(event) => onMoveStart?.(event)}
          onMouseUp={(event) => onMoveEnd?.(event)}
          onWheel={(event) => {
            onMoveStart?.(event);
            onMoveEnd?.(event);
          }}
        >
          {nodes.map((node) => (
            <div key={node.id}>
              <button
                type="button"
                data-node-id={node.id}
                data-node-position={`${node.position?.x ?? 0},${node.position?.y ?? 0}`}
                data-node-display-mode={node.data?.displayMode ?? ''}
                data-node-tour-anchor={node.data?.isTourAnchor ? 'true' : 'false'}
                data-node-tour-added={node.data?.isTourAdded ? 'true' : 'false'}
                onClick={(event) => onNodeClick?.(event as unknown as React.MouseEvent, node)}
              >
                {node.data?.label}
              </button>
              {node.type && nodeTypes[node.type]
                ? nodeTypes[node.type]({ data: node.data, selected: false, xPos: 0, yPos: 0, id: node.id })
                : null}
            </div>
          ))}
          {edges.map((edge) => (
            <div
              key={edge.id}
              data-testid="reactflow-edge"
              data-edge-id={edge.id}
              data-edge-source={edge.source ?? ''}
              data-edge-target={edge.target ?? ''}
              data-edge-source-handle={edge.sourceHandle ?? ''}
              data-edge-target-handle={edge.targetHandle ?? ''}
              data-edge-type={edge.type ?? ''}
            />
          ))}
          {children}
        </div>
      );
    },
    Background: () => <div data-testid="reactflow-background" />,
    Controls: () => <div data-testid="reactflow-controls" />,
    Handle: ({ id, type, position, 'data-testid': dataTestId }: { id?: string; type?: string; position?: unknown; 'data-testid'?: string }) => (
      <div
        data-testid={dataTestId ?? 'reactflow-handle'}
        data-handle-id={id ?? ''}
        data-handle-type={type ?? ''}
        data-handle-position={position ?? ''}
      />
    ),
    getViewportForBounds: (
      bounds: { x: number; y: number; width: number; height: number },
      width: number,
      height: number,
      minZoom: number,
      maxZoom: number,
      padding = 0,
    ) => {
      const paddedWidth = bounds.width * (1 + padding * 2);
      const paddedHeight = bounds.height * (1 + padding * 2);
      const zoom = Math.max(minZoom, Math.min(maxZoom, Math.min(width / paddedWidth, height / paddedHeight)));
      return {
        x: width / 2 - (bounds.x + bounds.width / 2) * zoom,
        y: height / 2 - (bounds.y + bounds.height / 2) * zoom,
        zoom,
      };
    },
    Position: {
      Top: 'top',
      Bottom: 'bottom',
      Left: 'left',
      Right: 'right',
    },
  };
}

vi.mock('reactflow', () => createReactFlowMock());

import App from '../App';

export async function renderApp() {
  render(<App />);
  await act(async () => {
    await Promise.resolve();
  });
}

// —— Spy tracking (accessible by test files) ——
export let consoleErrorSpy: MockInstance;
export let consoleWarnSpy: MockInstance;
export let stderrWriteSpy: MockInstance;
export let originalConsoleError: typeof console.error;
export let originalConsoleWarn: typeof console.warn;
export let originalStderrWrite: typeof process.stderr.write;
export let createObjectURLSpy: MockInstance;
export let revokeObjectURLSpy: MockInstance;
export let anchorClickSpy: MockInstance;
export let clientWidthGetter: MockInstance;
export let clientHeightGetter: MockInstance;

export function setupAppTests() {
  vi.clearAllMocks();
  setReactFlowInitMode('immediate');
  setReactFlowSimulateMoveOnFit(false);
  setReactFlowSimulateAsyncMoveOnFit(false);
  capturedOnMoveStart = null;
  capturedOnMoveEnd = null;
  deferredReactFlowOnInit = null;
  reactFlowFitViewSpy.mockReset();
  reactFlowFitBoundsSpy.mockReset();
  reactFlowGetViewportSpy.mockReset();
  reactFlowViewport = { x: 0, y: 0, zoom: 1 };
  reactFlowGetViewportSpy.mockImplementation(() => reactFlowViewport);
  reactFlowFitViewSpy.mockImplementation(() => {
    fireSimulatedViewportMove();
  });
  reactFlowFitBoundsSpy.mockImplementation((bounds: { x: number; y: number; width: number; height: number }) => {
    fireSimulatedViewportMove();
    reactFlowViewport = {
      x: -bounds.x,
      y: -bounds.y,
      zoom: reactFlowViewport.zoom,
    };
  });
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
      if (message?.type === 'GET_GRAPH_DISPLAY_SETTINGS') {
        return Promise.resolve({
          success: true,
          graphDisplaySettings: {
            autoFitMinReadableFontPx: 12,
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
  clientWidthGetter = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(960);
  clientHeightGetter = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(720);
}

export async function openOverflowMenu() {
  if (screen.queryByTestId('overflow-menu-export-json')) {
    return;
  }
  await act(async () => {
    fireEvent.click(screen.getByTestId('dropdown-menu-toggle'));
  });
  screen.getByTestId('overflow-menu-export-json');
}

export async function clickOverflowMenuItem(user: UserEvent, testId: string) {
  await openOverflowMenu();
  await act(async () => {
    fireEvent.click(screen.getByTestId(testId));
  });
}

export function teardownAppTests() {
  vi.useRealTimers();
  consoleErrorSpy.mockRestore();
  consoleWarnSpy.mockRestore();
  stderrWriteSpy.mockRestore();
  createObjectURLSpy.mockRestore();
  revokeObjectURLSpy.mockRestore();
  anchorClickSpy.mockRestore();
  clientWidthGetter.mockRestore();
  clientHeightGetter.mockRestore();
}
