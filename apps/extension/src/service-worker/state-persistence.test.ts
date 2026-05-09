import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  setupServiceWorkerTests,
  initializeModule,
  dispatchMessage,
  storageState,
  resetStorageState,
  transcribeChunkMock,
  extractSegmentGraphMock,
  appendTranscriptChunkMock,
  listTranscriptChunksBySessionMock,
  saveMergedGraphMock,
  getMergedGraphBySessionMock,
  markEndedMock,
  asrResetMock,
  getSessionMock,
  listRecentSessionsMock,
  bootstrapStructurerWindow,
  sendAudioChunk,
} from './__test-helpers__/index-test-helpers';

describe('Service Worker - 状态持久化与并发', () => {
  beforeEach(async () => {
    await setupServiceWorkerTests();
  });

  it('多个音频 chunk 会串行处理，避免并发触发多个 ASR 请求', async () => {
    let activeTranscribeCalls = 0;
    let maxConcurrentTranscribeCalls = 0;
    let releaseFirstChunk!: () => void;

    transcribeChunkMock
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            activeTranscribeCalls += 1;
            maxConcurrentTranscribeCalls = Math.max(
              maxConcurrentTranscribeCalls,
              activeTranscribeCalls,
            );
            releaseFirstChunk = () => {
              activeTranscribeCalls -= 1;
              resolve({
                chunkId: 'chunk_serial_1',
                sessionId: 'session_serial',
                text: '第一段',
                startMs: 0,
                endMs: 10000,
                provider: 'mock-asr',
              });
            };
          }),
      )
      .mockImplementationOnce(async () => {
        activeTranscribeCalls += 1;
        maxConcurrentTranscribeCalls = Math.max(
          maxConcurrentTranscribeCalls,
          activeTranscribeCalls,
        );
        activeTranscribeCalls -= 1;
        return {
          chunkId: 'chunk_serial_2',
          sessionId: 'session_serial',
          text: '第二段',
          startMs: 10000,
          endMs: 20000,
          provider: 'mock-asr',
        };
      });

    await dispatchMessage(
      {
        type: 'SESSION_START',
        target: 'service-worker',
        payload: { tabId: 123 },
      },
      { tab: { id: 123 } },
    );

    const firstChunkPromise = dispatchMessage(
      {
        type: 'AUDIO_CHUNK_READY',
        target: 'service-worker',
        payload: {
          audioData: [1, 2, 3, 4],
          startMs: 0,
          endMs: 10000,
        },
      },
      { tab: { id: 123 } },
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    const secondChunkPromise = dispatchMessage(
      {
        type: 'AUDIO_CHUNK_READY',
        target: 'service-worker',
        payload: {
          audioData: [5, 6, 7, 8],
          startMs: 10000,
          endMs: 20000,
        },
      },
      { tab: { id: 123 } },
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(transcribeChunkMock).toHaveBeenCalledTimes(1);

    releaseFirstChunk();

    const firstChunkResponse = await firstChunkPromise;
    const secondChunkResponse = await secondChunkPromise;

    expect(firstChunkResponse.success).toBe(true);
    expect(secondChunkResponse.success).toBe(true);
    expect(transcribeChunkMock).toHaveBeenCalledTimes(2);
    expect(maxConcurrentTranscribeCalls).toBe(1);
  });

  it('如果 transcript 落库失败，不会推进 runtime transcript 与时间状态', async () => {
    appendTranscriptChunkMock.mockRejectedValueOnce(new Error('chunk db unavailable'));

    await dispatchMessage(
      {
        type: 'SESSION_START',
        target: 'service-worker',
        payload: { tabId: 123 },
      },
      { tab: { id: 123 } },
    );

    const chunkResponse = await dispatchMessage(
      {
        type: 'AUDIO_CHUNK_READY',
        target: 'service-worker',
        payload: {
          audioData: [1, 2, 3, 4],
          startMs: 0,
          endMs: 30000,
        },
      },
      { tab: { id: 123 } },
    );

    expect(chunkResponse.success).toBe(false);
    expect(extractSegmentGraphMock).not.toHaveBeenCalled();

    const snapshotResponse = await dispatchMessage({
      type: 'GET_RUNTIME_SNAPSHOT',
      target: 'service-worker',
      payload: {},
    });
    expect(snapshotResponse.snapshot.currentTimeMs).toBe(0);
    expect(snapshotResponse.snapshot.graph).toBeNull();
  });

  it('IndexedDB backing store 短暂失败时会重试 transcript 落库', async () => {
    appendTranscriptChunkMock
      .mockRejectedValueOnce(
        new Error('UnknownError Internal error opening backing store for indexedDB.open.'),
      )
      .mockResolvedValueOnce(undefined);

    await dispatchMessage(
      {
        type: 'SESSION_START',
        target: 'service-worker',
        payload: { tabId: 123 },
      },
      { tab: { id: 123 } },
    );

    const chunkResponse = await dispatchMessage(
      {
        type: 'AUDIO_CHUNK_READY',
        target: 'service-worker',
        payload: {
          audioData: [1, 2, 3, 4],
          startMs: 0,
          endMs: 30000,
        },
      },
      { tab: { id: 123 } },
    );

    expect(chunkResponse.success).toBe(true);
    expect(appendTranscriptChunkMock).toHaveBeenCalledTimes(2);
  });

  it('IndexedDB backing store 持续失败时仍会保留内存态 graph，避免主链路直接中断', async () => {
    appendTranscriptChunkMock.mockRejectedValue(
      new Error('UnknownError Internal error opening backing store for indexedDB.open.'),
    );
    saveMergedGraphMock.mockRejectedValue(
      new Error('UnknownError Internal error opening backing store for indexedDB.open.'),
    );

    await dispatchMessage(
      {
        type: 'SESSION_START',
        target: 'service-worker',
        payload: { tabId: 123 },
      },
      { tab: { id: 123 } },
    );

    const chunkResponse = await bootstrapStructurerWindow();

    const snapshotResponse = await dispatchMessage({
      type: 'GET_RUNTIME_SNAPSHOT',
      target: 'service-worker',
      payload: {},
    });

    expect(chunkResponse.success).toBe(true);
    expect(snapshotResponse.snapshot.currentTimeMs).toBe(30000);
    expect(snapshotResponse.snapshot.graph?.nodes[0]?.text).toBe('provider transcript');
  });

  it('runtime state 持久化命中 backing store 异常时不会中断 chunk 处理', async () => {
    const chromeMock = (globalThis as any).chrome;

    await dispatchMessage(
      {
        type: 'SESSION_START',
        target: 'service-worker',
        payload: { tabId: 123 },
      },
      { tab: { id: 123 } },
    );
    chromeMock.storage.session.set.mockRejectedValueOnce(
      new Error('UnknownError Internal error opening backing store for indexedDB.open.'),
    );

    const chunkResponse = await bootstrapStructurerWindow();
    const snapshotResponse = await dispatchMessage({
      type: 'GET_RUNTIME_SNAPSHOT',
      target: 'service-worker',
      payload: {},
    });

    expect(chunkResponse.success).toBe(true);
    expect(snapshotResponse.snapshot.graph?.nodes[0]?.text).toBe('provider transcript');
  });

  it('如果 merged graph 落库失败，不会把未落盘 graph 暴露到 runtime snapshot', async () => {
    saveMergedGraphMock.mockRejectedValueOnce(new Error('graph db unavailable'));

    await dispatchMessage(
      {
        type: 'SESSION_START',
        target: 'service-worker',
        payload: { tabId: 123 },
      },
      { tab: { id: 123 } },
    );

    const chunkResponse = await bootstrapStructurerWindow();

    expect(chunkResponse.success).toBe(false);

    const snapshotResponse = await dispatchMessage({
      type: 'GET_RUNTIME_SNAPSHOT',
      target: 'service-worker',
      payload: {},
    });
    expect(snapshotResponse.snapshot.graph).toBeNull();
    expect(snapshotResponse.snapshot.currentTimeMs).toBe(30000);
  });

  it('节点点击时会把跳转请求转发给原始 tab', async () => {
    const chromeMock = (globalThis as any).chrome;

    const startResponse = await dispatchMessage(
      {
        type: 'SESSION_START',
        target: 'service-worker',
        payload: { tabId: 123 },
      },
      { tab: { id: 123 } },
    );
    const sessionId = startResponse.sessionId as string;

    await dispatchMessage(
      {
        type: 'NODE_CLICKED',
        target: 'service-worker',
        payload: {
          sessionId,
          nodeId: 'n1',
          timestampMs: 15000,
        },
      },
      { tab: { id: 123 } },
    );

    expect(chromeMock.tabs.sendMessage.mock.calls).toEqual(
      expect.arrayContaining([
        [
          123,
          expect.objectContaining({
            type: 'SEEK_TO_TIMESTAMP',
            payload: expect.objectContaining({ timestampMs: 15000 }),
          }),
        ],
      ]),
    );
  });

  it('可以返回当前运行时快照供 sidepanel 冷启动恢复', async () => {
    await dispatchMessage(
      {
        type: 'SESSION_START',
        target: 'service-worker',
        payload: { tabId: 123 },
      },
      { tab: { id: 123 } },
    );

    await bootstrapStructurerWindow();

    const snapshotResponse = await dispatchMessage({
      type: 'GET_RUNTIME_SNAPSHOT',
      target: 'service-worker',
      payload: {},
    });

    expect(snapshotResponse.success).toBe(true);
    expect(snapshotResponse.snapshot.state).toBe('capturing');
    expect(snapshotResponse.snapshot.graph?.nodes.length).toBeGreaterThan(0);
    expect(snapshotResponse.snapshot.currentView).toBeDefined();
  });

  it('收到 CAPTURE_ENDED 后会清理活动会话', async () => {
    const startResponse = await dispatchMessage(
      {
        type: 'SESSION_START',
        target: 'service-worker',
        payload: { tabId: 123 },
      },
      { tab: { id: 123 } },
    );

    const sessionId = startResponse.sessionId as string;

    await dispatchMessage(
      {
        type: 'CAPTURE_ENDED',
        target: 'service-worker',
        payload: { reason: 'share-ended' },
      },
      { tab: { id: 123 } },
    );

    const snapshotResponse = await dispatchMessage({
      type: 'GET_RUNTIME_SNAPSHOT',
      target: 'service-worker',
      payload: {},
    });

    expect(snapshotResponse.snapshot.sessionId).toBeNull();
    expect(snapshotResponse.snapshot.state).toBe('idle');

    const stopResponse = await dispatchMessage({
      type: 'SESSION_STOP',
      target: 'service-worker',
      payload: { sessionId },
    });
    expect(stopResponse.success).toBe(true);
  });

  it('会话结束时会标记 session 资产已结束', async () => {
    const startResponse = await dispatchMessage(
      {
        type: 'SESSION_START',
        target: 'service-worker',
        payload: { tabId: 123 },
      },
      { tab: { id: 123 } },
    );

    await dispatchMessage(
      {
        type: 'CAPTURE_ENDED',
        target: 'service-worker',
        payload: { reason: 'share-ended' },
      },
      { tab: { id: 123 } },
    );

    expect(markEndedMock).toHaveBeenCalledWith(
      startResponse.sessionId,
      expect.any(Number),
    );
  });

  it('即使 markEnded 失败，也会完成内存态与 runtime state 清理', async () => {
    markEndedMock.mockRejectedValueOnce(new Error('db unavailable'));

    await dispatchMessage(
      {
        type: 'SESSION_START',
        target: 'service-worker',
        payload: { tabId: 123 },
      },
      { tab: { id: 123 } },
    );

    await dispatchMessage(
      {
        type: 'CAPTURE_ENDED',
        target: 'service-worker',
        payload: { reason: 'share-ended' },
      },
      { tab: { id: 123 } },
    );

    expect(storageState['listen-graphic-runtime-state']).toEqual(
      expect.objectContaining({
        pendingSessionFinalize: expect.objectContaining({
          sessionId: expect.any(String),
          endedAt: expect.any(Number),
        }),
      }),
    );

    const snapshotResponse = await dispatchMessage({
      type: 'GET_RUNTIME_SNAPSHOT',
      target: 'service-worker',
      payload: {},
    });

    expect(snapshotResponse.snapshot.sessionId).toBeNull();
    expect(snapshotResponse.snapshot.state).toBe('idle');
    expect(markEndedMock).toHaveBeenCalledTimes(2);
    expect(storageState['listen-graphic-runtime-state']).toBeUndefined();
  });

  it('worker 重载后仍可从持久化状态恢复快照', async () => {
    const chromeMock = (globalThis as any).chrome;

    await dispatchMessage(
      {
        type: 'SESSION_START',
        target: 'service-worker',
        payload: { tabId: 123 },
      },
      { tab: { id: 123 } },
    );

    await bootstrapStructurerWindow();

    const onSuspendHandler =
      chromeMock.runtime.onSuspend.addListener.mock.calls.at(-1)?.[0];
    await onSuspendHandler?.();

    vi.resetModules();
    await initializeModule();

    const snapshotResponse = await dispatchMessage({
      type: 'GET_RUNTIME_SNAPSHOT',
      target: 'service-worker',
      payload: {},
    });

    expect(snapshotResponse.success).toBe(true);
    expect(snapshotResponse.snapshot.sessionId).toBeTruthy();
    expect(snapshotResponse.snapshot.state).toBe('capturing');
    expect(snapshotResponse.snapshot.currentTimeMs).toBe(30000);
    expect(snapshotResponse.snapshot.graph?.nodes.length).toBeGreaterThan(0);
  });

  it('runtime state 丢失时会从 storage 恢复最近会话资产', async () => {
    resetStorageState();
    listRecentSessionsMock.mockResolvedValue([
      {
        sessionId: 'session_recovered',
        sourceType: 'tab',
        createdAt: 100,
        endedAt: 120,
      },
    ]);
    listTranscriptChunksBySessionMock.mockResolvedValue([
      {
        chunkId: 'chunk_1',
        sessionId: 'session_recovered',
        text: '第一段',
        startMs: 0,
        endMs: 30000,
        provider: 'mock-asr',
      },
      {
        chunkId: 'chunk_2',
        sessionId: 'session_recovered',
        text: '第二段',
        startMs: 30000,
        endMs: 60000,
        provider: 'mock-asr',
      },
    ]);
    getMergedGraphBySessionMock.mockResolvedValue({
      sessionId: 'session_recovered',
      revision: 2,
      topics: [],
      nodes: [
        {
          id: 'node_1',
          type: 'claim',
          text: '恢复的节点',
          timestampMs: 30000,
          status: 'confirmed',
        },
      ],
      edges: [],
      viewHints: {
        defaultView: 'timeline',
      },
      updatedAt: 200,
    });

    const snapshotResponse = await dispatchMessage({
      type: 'GET_RUNTIME_SNAPSHOT',
      target: 'service-worker',
      payload: {},
    });

    expect(snapshotResponse.success).toBe(true);
    expect(snapshotResponse.snapshot.sessionId).toBe('session_recovered');
    expect(snapshotResponse.snapshot.graph?.nodes[0]?.text).toBe('恢复的节点');
    expect(snapshotResponse.snapshot.currentTimeMs).toBe(60000);
    expect(snapshotResponse.snapshot.currentView).toBe('timeline');
  });

  it('runtime state 丢失时只会恢复最近一个已结束会话的资产', async () => {
    resetStorageState();
    listRecentSessionsMock.mockResolvedValue([
      {
        sessionId: 'session_active_like',
        sourceType: 'tab',
        createdAt: 200,
      },
      {
        sessionId: 'session_ended',
        sourceType: 'tab',
        createdAt: 100,
        endedAt: 150,
      },
    ]);
    listTranscriptChunksBySessionMock.mockImplementation(async (sessionId: string) => {
      if (sessionId === 'session_ended') {
        return [
          {
            chunkId: 'chunk_ended',
            sessionId,
            text: '已结束会话',
            startMs: 0,
            endMs: 30000,
            provider: 'mock-asr',
          },
        ];
      }
      return [
        {
          chunkId: 'chunk_active_like',
          sessionId,
          text: '不应该被恢复',
          startMs: 0,
          endMs: 30000,
          provider: 'mock-asr',
        },
      ];
    });
    getMergedGraphBySessionMock.mockImplementation(async (sessionId: string) => {
      if (sessionId === 'session_ended') {
        return {
          sessionId,
          revision: 1,
          topics: [],
          nodes: [
            {
              id: 'node_ended',
              type: 'claim',
              text: '只恢复已结束会话',
              timestampMs: 0,
              status: 'confirmed',
            },
          ],
          edges: [],
          viewHints: {
            defaultView: 'causal',
          },
          updatedAt: 150,
        };
      }
      return {
        sessionId,
        revision: 1,
        topics: [],
        nodes: [
          {
            id: 'node_active_like',
            type: 'claim',
            text: '不应该被恢复',
            timestampMs: 0,
            status: 'confirmed',
          },
        ],
        edges: [],
        viewHints: {
          defaultView: 'timeline',
        },
        updatedAt: 200,
      };
    });

    const snapshotResponse = await dispatchMessage({
      type: 'GET_RUNTIME_SNAPSHOT',
      target: 'service-worker',
      payload: {},
    });

    expect(snapshotResponse.success).toBe(true);
    expect(snapshotResponse.snapshot.sessionId).toBe('session_ended');
    expect(snapshotResponse.snapshot.graph?.nodes[0]?.text).toBe('只恢复已结束会话');
    expect(listTranscriptChunksBySessionMock).toHaveBeenCalledWith('session_ended');
    expect(getMergedGraphBySessionMock).toHaveBeenCalledWith('session_ended');
  });

  it('stop 发生在 transcribing 中途时会中断当前 chunk 并立即清理会话', async () => {
    let rejectTranscribe!: (reason?: unknown) => void;
    transcribeChunkMock.mockImplementationOnce(
      () => new Promise((_, reject) => {
        rejectTranscribe = reject;
      }),
    );
    asrResetMock.mockImplementation(() => {
      if (rejectTranscribe) {
        rejectTranscribe(new Error('Tencent ASR polling aborted for task 9529'));
      }
    });

    const startResponse = await dispatchMessage(
      {
        type: 'SESSION_START',
        target: 'service-worker',
        payload: { tabId: 123 },
      },
      { tab: { id: 123 } },
    );

    const chunkPromise = dispatchMessage(
      {
        type: 'AUDIO_CHUNK_READY',
        target: 'service-worker',
        payload: {
          audioData: [1, 2, 3, 4],
          startMs: 0,
          endMs: 30000,
        },
      },
      { tab: { id: 123 } },
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    const stopResponse = await dispatchMessage({
      type: 'SESSION_STOP',
      target: 'service-worker',
      payload: { sessionId: startResponse.sessionId },
    });
    const chunkResponse = await chunkPromise;
    const snapshotResponse = await dispatchMessage({
      type: 'GET_RUNTIME_SNAPSHOT',
      target: 'service-worker',
      payload: {},
    });

    expect(chunkResponse.success).toBe(false);
    expect(chunkResponse.error).toContain('停止中');
    expect(stopResponse.success).toBe(true);
    expect(asrResetMock).toHaveBeenCalled();
    expect(saveMergedGraphMock).not.toHaveBeenCalled();
    expect(snapshotResponse.snapshot.sessionId).toBeNull();
    expect(snapshotResponse.snapshot.state).toBe('idle');
  });

  it('stop 会等待实时链路上 structuring 挂起结束后再清理，且停止后快照仍含合并后的图谱', async () => {
    const startResponse = await dispatchMessage(
      {
        type: 'SESSION_START',
        target: 'service-worker',
        payload: { tabId: 123 },
      },
      { tab: { id: 123 } },
    );

    await bootstrapStructurerWindow();

    let finishStructurer!: (value: unknown) => void;
    extractSegmentGraphMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishStructurer = resolve;
        }),
    );

    const chunk4Promise = sendAudioChunk({ startMs: 30000, endMs: 40000 });

    await vi.waitFor(() => {
      expect(extractSegmentGraphMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    const stopPromise = dispatchMessage({
      type: 'SESSION_STOP',
      target: 'service-worker',
      payload: { sessionId: startResponse.sessionId },
    });
    await Promise.resolve();

    finishStructurer!({
      segmentId: 'segment_40000',
      sessionId: startResponse.sessionId,
      startMs: 30000,
      endMs: 40000,
      topic: 'provider topic',
      provider: 'mock-structurer',
      nodes: [
        {
          id: 'segment_40000:node_4',
          type: 'claim',
          text: '第四段',
          timestampMs: 30000,
          status: 'confirmed',
          evidenceChunkIds: ['chunk_mock'],
        },
      ],
      edges: [],
    });

    const [stopResult, chunk4Result] = await Promise.all([stopPromise, chunk4Promise]);

    expect(stopResult.success).toBe(true);
    expect(chunk4Result.success).toBe(true);

    const snapshotResponse = await dispatchMessage({
      type: 'GET_RUNTIME_SNAPSHOT',
      target: 'service-worker',
      payload: {},
    });

    expect(snapshotResponse.snapshot.state).toBe('idle');
    expect(snapshotResponse.snapshot.sessionId).toBeNull();
    expect(snapshotResponse.snapshot.graph?.nodes?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  it('stop 先发出而最后一个 chunk 后到时，会直接丢弃该 chunk 并完成清理', async () => {
    const startResponse = await dispatchMessage(
      {
        type: 'SESSION_START',
        target: 'service-worker',
        payload: { tabId: 123 },
      },
      { tab: { id: 123 } },
    );

    const stopPromise = dispatchMessage({
      type: 'SESSION_STOP',
      target: 'service-worker',
      payload: { sessionId: startResponse.sessionId },
    });

    const lateChunkResponse = await dispatchMessage(
      {
        type: 'AUDIO_CHUNK_READY',
        target: 'service-worker',
        payload: {
          audioData: [1, 2, 3, 4],
          startMs: 0,
          endMs: 30000,
        },
      },
      { tab: { id: 123 } },
    );
    const stopResponse = await stopPromise;
    const snapshotResponse = await dispatchMessage({
      type: 'GET_RUNTIME_SNAPSHOT',
      target: 'service-worker',
      payload: {},
    });

    expect(lateChunkResponse.success).toBe(false);
    expect(lateChunkResponse.error).toContain('停止或进入错误状态');
    expect(stopResponse.success).toBe(true);
    expect(saveMergedGraphMock).not.toHaveBeenCalled();
    expect(snapshotResponse.snapshot.sessionId).toBeNull();
    expect(snapshotResponse.snapshot.state).toBe('idle');
  });

  it('停止请求如果带着旧 sessionId，不会误清理当前活动会话', async () => {
    const startResponse = await dispatchMessage(
      {
        type: 'SESSION_START',
        target: 'service-worker',
        payload: { tabId: 123 },
      },
      { tab: { id: 123 } },
    );

    const stopResponse = await dispatchMessage({
      type: 'SESSION_STOP',
      target: 'service-worker',
      payload: { sessionId: 'session_stale' },
    });
    const snapshotResponse = await dispatchMessage({
      type: 'GET_RUNTIME_SNAPSHOT',
      target: 'service-worker',
      payload: {},
    });

    expect(stopResponse.success).toBe(false);
    expect(stopResponse.error).toContain('不匹配');
    expect(markEndedMock).not.toHaveBeenCalled();
    expect(snapshotResponse.snapshot.sessionId).toBe(startResponse.sessionId);
    expect(snapshotResponse.snapshot.state).toBe('capturing');
  });

  it('worker 重载后仍会恢复用户手选视图', async () => {
    const chromeMock = (globalThis as any).chrome;

    const startResponse = await dispatchMessage(
      {
        type: 'SESSION_START',
        target: 'service-worker',
        payload: { tabId: 123 },
      },
      { tab: { id: 123 } },
    );

    await bootstrapStructurerWindow();

    await dispatchMessage({
      type: 'VIEW_SELECTED',
      target: 'service-worker',
      payload: { sessionId: startResponse.sessionId, view: 'timeline' },
    });

    const onSuspendHandler =
      chromeMock.runtime.onSuspend.addListener.mock.calls.at(-1)?.[0];
    await onSuspendHandler?.();

    vi.resetModules();
    await initializeModule();

    const snapshotResponse = await dispatchMessage({
      type: 'GET_RUNTIME_SNAPSHOT',
      target: 'service-worker',
      payload: {},
    });

    expect(snapshotResponse.snapshot.currentView).toBe('timeline');
    expect(snapshotResponse.snapshot.currentViewPinned).toBe(true);
  });

  it('worker 重载后若标签页被关闭，仍会清理持久化会话', async () => {
    const chromeMock = (globalThis as any).chrome;

    await dispatchMessage(
      {
        type: 'SESSION_START',
        target: 'service-worker',
        payload: { tabId: 123 },
      },
      { tab: { id: 123 } },
    );

    await bootstrapStructurerWindow();

    const onSuspendHandler =
      chromeMock.runtime.onSuspend.addListener.mock.calls.at(-1)?.[0];
    await onSuspendHandler?.();

    vi.resetModules();
    await initializeModule();

    const onRemovedHandler =
      chromeMock.tabs.onRemoved.addListener.mock.calls.at(-1)?.[0];
    await onRemovedHandler?.(123);

    const snapshotResponse = await dispatchMessage({
      type: 'GET_RUNTIME_SNAPSHOT',
      target: 'service-worker',
      payload: {},
    });

    expect(snapshotResponse.snapshot.sessionId).toBeNull();
    expect(snapshotResponse.snapshot.state).toBe('idle');
  });
});
