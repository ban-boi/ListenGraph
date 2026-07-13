import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { act } from 'react';
import {
  renderApp,
  setupAppTests,
  teardownAppTests,
  createObjectURLSpy,
  anchorClickSpy,
  clickOverflowMenuItem,
} from './__test-helpers__/app-test-helpers';

describe('App - 调试与回放', () => {
  beforeEach(() => {
    setupAppTests();
  });

  afterEach(() => {
    teardownAppTests();
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
    await clickOverflowMenuItem(user, 'overflow-menu-debug');

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
    // 摘要 JSON 只包含计数，不包含完整文本内容
    expect(within(debugPanel).getByTestId('debug-json')).toBeInTheDocument();
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
              traces: [
                {
                  sequence: 1,
                  transcript: {
                    chunkId: 'chunk_1',
                    sessionId: 'session_debug_export',
                    text: '导出调试转写',
                    startMs: 0,
                    endMs: 30000,
                    provider: 'mock-asr',
                  },
                  transcriptWindow: [],
                  segment: null,
                  structurerRun: null,
                  assemblerRun: {
                    sessionId: 'session_debug_export',
                    sequence: 1,
                    transcriptEndMs: 30000,
                    latestTranscriptId: 'chunk_1',
                    decision: 'commit',
                    reason: 'commit_rule',
                    waitMs: 0,
                    bufferTranscriptCount: 1,
                    effectiveCharCount: 6,
                    createdAt: 200,
                  },
                  mergedGraphAfter: null,
                },
              ],
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
              assemblerRuns: [
                {
                  sessionId: 'session_debug_export',
                  sequence: 1,
                  transcriptEndMs: 30000,
                  latestTranscriptId: 'chunk_1',
                  decision: 'commit',
                  reason: 'commit_rule',
                  waitMs: 0,
                  bufferTranscriptCount: 1,
                  effectiveCharCount: 6,
                  createdAt: 200,
                },
              ],
              structureUnits: [
                {
                  unitId: 'unit_1',
                  sessionId: 'session_debug_export',
                  startMs: 0,
                  endMs: 30000,
                  text: '导出调试转写',
                  sourceChunkIds: ['chunk_1'],
                  reason: 'commit_rule',
                  createdAt: 200,
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

    await clickOverflowMenuItem(user, 'overflow-menu-debug');

    await act(async () => {
      await user.click(await screen.findByTestId('debug-export-button'));
    });

    const slimBlob = createObjectURLSpy.mock.calls.at(-1)?.[0] as Blob;
    const slimJson = await slimBlob.text();

    expect(anchorClickSpy).toHaveBeenCalled();
    expect(slimJson).toContain('"schemaVersion": 2');
    expect(slimJson).toContain('"meta"');
    expect(slimJson).toContain('"session"');
    expect(slimJson).toContain('"runtime"');
    expect(slimJson).toContain('"data"');
    expect(slimJson).toContain('"ui"');
    expect(slimJson).toContain('"segments"');
    expect(slimJson).toContain('"assemblerRuns"');
    expect(slimJson).toContain('"structureUnits"');
    expect(slimJson).toContain('"assemblerRun"');
    expect(slimJson).toContain('"derivedViews"');
    expect(slimJson).toContain('"layoutDiagnostics"');
    expect(slimJson).toContain('"reusedPositions"');
    expect(slimJson).toContain('"timeline"');
    expect(slimJson).toContain('导出调试节点');
    expect(slimJson).not.toContain('"tokens"');
    expect(slimJson).not.toContain('"raw"');
    expect(slimJson).toContain('"tokenCount": 1');
    expect(slimJson).toContain('"hasRaw": true');
    expect(slimJson).not.toContain('"debugData"');
    expect(slimJson).not.toContain('"exportMode"');
    expect(slimJson).not.toContain('"workerBuildLabel"');
    expect(slimJson).not.toContain('"logCount"');

    await act(async () => {
      await user.click(await screen.findByTestId('debug-export-full-button'));
    });

    const fullBlob = createObjectURLSpy.mock.calls.at(-1)?.[0] as Blob;
    const fullJson = await fullBlob.text();
    expect(fullJson).toContain('"tokens"');
    expect(fullJson).toContain('"raw"');
  });

  it('停止后 runtime snapshot 只有 graph sessionId 时仍可导出会话图', async () => {
    (globalThis as any).chrome.runtime.sendMessage.mockImplementation(
      (message: { type?: string; payload?: { sessionId?: string } }) => {
        if (message?.type === 'GET_RUNTIME_SNAPSHOT') {
          return Promise.resolve({
            success: true,
            snapshot: {
              sessionId: null,
              state: 'stopped',
              currentTimeMs: 30000,
              currentView: 'timeline',
              currentViewPinned: false,
              graph: {
                sessionId: 'session_graph_only',
                revision: 1,
                topics: [],
                nodes: [
                  {
                    id: 'n1',
                    type: 'claim',
                    text: '停止后仍可导出',
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
        if (message?.type === 'EXPORT_SESSION') {
          return Promise.resolve({
            success: true,
            exportData: {
              filename: `${message.payload?.sessionId}.json`,
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

    await clickOverflowMenuItem(user, 'overflow-menu-export-json');

    expect((globalThis as any).chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'EXPORT_SESSION',
        payload: { sessionId: 'session_graph_only', format: 'json' },
      }),
    );
    expect(anchorClickSpy).toHaveBeenCalled();
  });

  it('确认导出 Graph Corpus 后会下载 JSON 文件', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    (globalThis as any).chrome.runtime.sendMessage.mockImplementation(
      (message: { type?: string }) => {
        if (message?.type === 'GET_RUNTIME_SNAPSHOT') {
          return Promise.resolve({
            success: true,
            snapshot: {
              sessionId: null,
              state: 'stopped',
              currentTimeMs: 30000,
              currentView: 'timeline',
              currentViewPinned: false,
              graph: {
                sessionId: 'session_graph_only',
                revision: 1,
                topics: [],
                nodes: [
                  {
                    id: 'n1',
                    type: 'claim',
                    text: '停止后仍可导出',
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
        if (message?.type === 'EXPORT_ALL_GRAPHS') {
          return Promise.resolve({
            success: true,
            exportData: {
              filename: 'graph-corpus-2026-07-13.json',
              mimeType: 'application/json',
              content: JSON.stringify([
                {
                  sessionId: 's1',
                  revision: 1,
                  topics: [],
                  nodes: [{ id: 'n1', type: 'claim', text: '测试', timestampMs: 0, status: 'confirmed' }],
                  edges: [],
                  updatedAt: 100,
                },
              ]),
            },
          });
        }
        return Promise.resolve({ success: true });
      },
    );

    const user = userEvent.setup();
    await renderApp();

    await clickOverflowMenuItem(user, 'overflow-menu-export-all-graphs');

    expect((globalThis as any).chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'EXPORT_ALL_GRAPHS',
        payload: {},
      }),
    );
    expect(anchorClickSpy).toHaveBeenCalled();
  });

  it('取消 Graph Corpus 确认时不会触发下载', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    (globalThis as any).chrome.runtime.sendMessage.mockImplementation(
      (message: { type?: string }) => {
        if (message?.type === 'GET_RUNTIME_SNAPSHOT') {
          return Promise.resolve({
            success: true,
            snapshot: {
              sessionId: null,
              state: 'stopped',
              currentTimeMs: 30000,
              currentView: 'timeline',
              currentViewPinned: false,
              graph: {
                sessionId: 'session_graph_only',
                revision: 1,
                topics: [],
                nodes: [
                  {
                    id: 'n1',
                    type: 'claim',
                    text: '停止后仍可导出',
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
        if (message?.type === 'EXPORT_ALL_GRAPHS') {
          return Promise.resolve({
            success: true,
            exportData: {
              filename: 'graph-corpus-2026-07-13.json',
              mimeType: 'application/json',
              content: JSON.stringify([
                {
                  sessionId: 's1',
                  revision: 1,
                  topics: [],
                  nodes: [{ id: 'n1', type: 'claim', text: '测试', timestampMs: 0, status: 'confirmed' }],
                  edges: [],
                  updatedAt: 100,
                },
              ]),
            },
          });
        }
        return Promise.resolve({ success: true });
      },
    );

    const user = userEvent.setup();
    await renderApp();

    await clickOverflowMenuItem(user, 'overflow-menu-export-all-graphs');

    expect((globalThis as any).chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'EXPORT_ALL_GRAPHS',
        payload: {},
      }),
    );
    expect(anchorClickSpy).not.toHaveBeenCalled();
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
    await clickOverflowMenuItem(user, 'overflow-menu-replay');

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
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
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
    await clickOverflowMenuItem(user, 'overflow-menu-replay');
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
    expect(screen.getByText(/会话:/)).toBeInTheDocument();

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

  it('调试面板支持导出 Assembler 决策日志', async () => {
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
              currentViewPinned: false,
              graph: {
                sessionId: 'session_debug_export',
                revision: 1,
                topics: [],
                nodes: [{ id: 'n1', type: 'claim', text: '测试', timestampMs: 0, status: 'confirmed' }],
                edges: [],
                viewHints: { defaultView: 'timeline', scores: { timeline: 3, causal: 1, comparison: 2, flow: 0, hierarchy: 0 } },
                updatedAt: 200,
              },
            },
          });
        }
        if (message?.type === 'GET_DEBUG_SESSION') {
          return Promise.resolve({
            success: true,
            debugData: {
              session: { sessionId: 'session_debug_export', sourceType: 'tab', createdAt: 100 },
              transcripts: [],
              segments: [],
              traces: [],
              graph: null,
              assemblerRuns: [
                {
                  sessionId: 'session_debug_export',
                  sequence: 1,
                  latestTranscriptId: 't1',
                  latestTranscriptEndMs: 1000,
                  latestTranscriptText: '测试文本',
                  decision: 'commit',
                  reason: 'commit_rule',
                  score: 3,
                  bufferTranscriptCount: 1,
                  effectiveCharCount: 4,
                  waitMs: 200,
                  createdAt: 200,
                },
              ],
              structureUnits: [
                {
                  unitId: 'u1',
                  sessionId: 'session_debug_export',
                  startMs: 0,
                  endMs: 1000,
                  text: '测试文本',
                  sourceChunkIds: ['t1'],
                  reason: 'commit_rule',
                  createdAt: 200,
                },
              ],
              traceSource: 'memory',
            },
          });
        }
        return Promise.resolve({ success: true });
      },
    );

    renderApp();
    const user = userEvent.setup();

    await clickOverflowMenuItem(user, 'overflow-menu-debug');

    await waitFor(() => {
      expect(screen.getByTestId('debug-panel')).toBeDefined();
    });

    const assemblerButton = await screen.findByTestId('debug-export-assembler-button');
    expect(assemblerButton).not.toBeDisabled();
    await user.click(assemblerButton);

    await waitFor(() => {
      expect(anchorClickSpy).toHaveBeenCalled();
    });

    const blob = createObjectURLSpy.mock.calls.at(-1)?.[0] as Blob;
    expect(blob.type).toBe('application/json');

    const json = await blob.text();
    const parsed = JSON.parse(json);
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.meta.sessionId).toBe('session_debug_export');
    expect(parsed.summary.totalRuns).toBe(1);
    expect(parsed.runs).toHaveLength(1);
    expect(parsed.runs[0].decision).toBe('commit');
    expect(parsed.units).toHaveLength(1);
    expect(parsed.units[0].reason).toBe('commit_rule');
  });
});
