import { beforeEach, describe, expect, it } from 'vitest';
import {
  setupServiceWorkerTests,
  dispatchMessage,
  transcribeChunkMock,
  extractSegmentGraphMock,
  appendTranscriptChunkMock,
  listTranscriptChunksBySessionMock,
  appendSegmentGraphMock,
  listSegmentGraphsBySessionMock,
  saveMergedGraphMock,
  getMergedGraphBySessionMock,
  getSessionMock,
  sendAudioChunk,
  bootstrapStructurerWindow,
  runInjectedStructurerSession,
} from './__test-helpers__/index-test-helpers';

describe('Service Worker - 音频处理与结构化', () => {
  beforeEach(async () => {
    await setupServiceWorkerTests();
  });

  it('收到音频 chunk 后会广播 transcript 与 graph 更新', async () => {
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

    const sentMessageTypes = chromeMock.runtime.sendMessage.mock.calls.map(
      (call: Array<{ type?: string }>) => call[0]?.type,
    );
    expect(sentMessageTypes).toContain('TRANSCRIPT_READY');
    expect(sentMessageTypes).toContain('MERGED_GRAPH_UPDATED');
  });

  it('收到音频 chunk 后会通过 providers 契约处理 transcript 与 segment', async () => {
    await dispatchMessage(
      {
        type: 'SESSION_START',
        target: 'service-worker',
        payload: { tabId: 123 },
      },
      { tab: { id: 123 } },
    );

    await sendAudioChunk({
      startMs: 0,
      endMs: 10000,
      audioMimeType: 'audio/wav',
      sampleRate: 16000,
      channels: 1,
      bitDepth: 16,
    });
    await sendAudioChunk({ startMs: 10000, endMs: 20000 });
    await sendAudioChunk({ startMs: 20000, endMs: 30000 });

    expect(transcribeChunkMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: expect.any(String),
        startMs: 0,
        endMs: 10000,
        audio: expect.any(Blob),
      }),
    );
    const transcribeInput = transcribeChunkMock.mock.calls[0]?.[0];
    expect(transcribeInput.audio.type).toBe('audio/wav');
    expect(extractSegmentGraphMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: expect.any(String),
        transcriptWindow: expect.arrayContaining([
          expect.objectContaining({
            text: 'provider transcript',
            provider: 'mock-asr',
          }),
        ]),
      }),
    );
    expect(extractSegmentGraphMock.mock.calls[0]?.[0].transcriptWindow).toHaveLength(3);
  });

  it('structure-focused 注入链路会绕过 ASR，直接驱动真实 structurer 挂点', async () => {
    const response = await runInjectedStructurerSession({
      transcripts: [
        {
          chunkId: 'chunk_1',
          text: '第一段结构化输入',
          startMs: 0,
          endMs: 10000,
        },
        {
          chunkId: 'chunk_2',
          text: '第二段结构化输入',
          startMs: 10000,
          endMs: 20000,
        },
        {
          chunkId: 'chunk_3',
          text: '第三段结构化输入',
          startMs: 20000,
          endMs: 30000,
        },
      ],
      finalizeSession: false,
    });

    expect(response).toMatchObject({ success: true });
    expect(transcribeChunkMock).not.toHaveBeenCalled();
    expect(extractSegmentGraphMock).toHaveBeenCalledTimes(1);
    expect(extractSegmentGraphMock).toHaveBeenCalledWith(
      expect.objectContaining({
        transcriptWindow: [
          expect.objectContaining({ text: '第一段结构化输入' }),
          expect.objectContaining({ text: '第二段结构化输入' }),
          expect.objectContaining({ text: '第三段结构化输入' }),
        ],
      }),
    );

    const snapshotResponse = await dispatchMessage({
      type: 'GET_RUNTIME_SNAPSHOT',
      target: 'service-worker',
      payload: {},
    });
    expect(snapshotResponse.snapshot.sessionId).toBeTruthy();
    expect(snapshotResponse.snapshot.graph?.nodes.length).toBeGreaterThan(0);
  });

  it('structure-focused 注入链路支持以现有 graph 作为增量上下文', async () => {
    const previousGraph = {
      sessionId: 'session_injected',
      revision: 1,
      topics: [],
      nodes: [
        {
          id: 'existing_node_1',
          type: 'claim',
          text: '已有观点',
          timestampMs: 0,
          status: 'confirmed',
        },
      ],
      edges: [],
      updatedAt: 1,
    };

    const response = await runInjectedStructurerSession({
      seed: {
        sessionId: 'session_injected',
        transcriptWindow: [
          {
            chunkId: 'chunk_seed_1',
            text: '已有上下文一',
            startMs: 0,
            endMs: 10000,
          },
          {
            chunkId: 'chunk_seed_2',
            text: '已有上下文二',
            startMs: 10000,
            endMs: 20000,
          },
          {
            chunkId: 'chunk_seed_3',
            text: '已有上下文三',
            startMs: 20000,
            endMs: 30000,
          },
        ],
        mergedGraph: previousGraph,
        currentTimeMs: 30000,
        chunkIndex: 3,
      },
      transcripts: [
        {
          chunkId: 'chunk_4',
          text: '新的增量信息',
          startMs: 30000,
          endMs: 40000,
        },
      ],
    });

    expect(response.success).toBe(true);
    expect(transcribeChunkMock).not.toHaveBeenCalled();
    expect(extractSegmentGraphMock).toHaveBeenCalledWith(
      expect.objectContaining({
        previousGraph: expect.objectContaining({
          nodes: [expect.objectContaining({ id: 'existing_node_1' })],
        }),
        transcriptWindow: [
          expect.objectContaining({ text: '已有上下文二' }),
          expect.objectContaining({ text: '已有上下文三' }),
          expect.objectContaining({ text: '新的增量信息' }),
        ],
      }),
    );
  });

  it('structure-focused 导出会在 merged graph 缺失时从 segments 重建 graph', async () => {
    const transcriptRecords = new Map<string, Record<string, unknown>[]>();
    const segmentRecords = new Map<string, Record<string, unknown>[]>();

    appendTranscriptChunkMock.mockImplementation(async (chunk: Record<string, unknown>) => {
      const current = transcriptRecords.get(chunk.sessionId as string) ?? [];
      transcriptRecords.set(chunk.sessionId as string, [...current, chunk]);
    });
    listTranscriptChunksBySessionMock.mockImplementation(
      async (sessionId: string) => transcriptRecords.get(sessionId) ?? [],
    );
    appendSegmentGraphMock.mockImplementation(async (segment: Record<string, unknown>) => {
      const current = segmentRecords.get(segment.sessionId as string) ?? [];
      segmentRecords.set(segment.sessionId as string, [...current, segment]);
    });
    listSegmentGraphsBySessionMock.mockImplementation(
      async (sessionId: string) => segmentRecords.get(sessionId) ?? [],
    );
    getMergedGraphBySessionMock.mockResolvedValue(undefined);

    const response = await runInjectedStructurerSession({
      transcripts: [
        {
          chunkId: 'chunk_1',
          text: '第一段结构化输入',
          startMs: 0,
          endMs: 10000,
        },
        {
          chunkId: 'chunk_2',
          text: '第二段结构化输入',
          startMs: 10000,
          endMs: 20000,
        },
        {
          chunkId: 'chunk_3',
          text: '第三段结构化输入',
          startMs: 20000,
          endMs: 30000,
        },
      ],
    });

    expect(response).toEqual(expect.objectContaining({ success: true }));
    getSessionMock.mockResolvedValue({
      sessionId: response.sessionId,
      sourceType: 'file',
      createdAt: 100,
      endedAt: 200,
    });

    const exportResponse = await dispatchMessage({
      type: 'EXPORT_SESSION',
      target: 'service-worker',
      payload: { sessionId: response.sessionId, format: 'json' },
    });
    const debugResponse = await dispatchMessage({
      type: 'GET_DEBUG_SESSION',
      target: 'service-worker',
      payload: { sessionId: response.sessionId },
    });

    expect(exportResponse.success).toBe(true);
    expect(exportResponse.exportData.content).toContain('第三段结构化输入');
    expect(debugResponse.success).toBe(true);
    expect(debugResponse.debugData.graph?.nodes.length).toBeGreaterThan(0);
  });

  it('前两个 10 秒 chunk 只累计上下文，不会提前触发 structurer', async () => {
    const chromeMock = (globalThis as any).chrome;

    await dispatchMessage(
      {
        type: 'SESSION_START',
        target: 'service-worker',
        payload: { tabId: 123 },
      },
      { tab: { id: 123 } },
    );

    await sendAudioChunk({ startMs: 0, endMs: 10000 });
    await sendAudioChunk({ startMs: 10000, endMs: 20000 });

    expect(extractSegmentGraphMock).not.toHaveBeenCalled();

    const sentProgressMessages = chromeMock.runtime.sendMessage.mock.calls
      .map((call: Array<{ type?: string; payload?: Record<string, unknown> }>) => call[0])
      .filter((message: { type?: string; payload?: Record<string, unknown> }) => message?.type === 'PROVIDER_PROGRESS');
    expect(sentProgressMessages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          payload: expect.objectContaining({
            stage: 'structurer',
            message: expect.stringContaining('等待 30 秒上下文'),
          }),
        }),
      ]),
    );
  });

  it('收到音频 chunk 后会持久化 transcript 与 merged graph 资产', async () => {
    await dispatchMessage(
      {
        type: 'SESSION_START',
        target: 'service-worker',
        payload: { tabId: 123 },
      },
      { tab: { id: 123 } },
    );

    await bootstrapStructurerWindow();

    expect(appendTranscriptChunkMock).toHaveBeenCalledWith(
      expect.objectContaining({
        chunkId: 'chunk_mock',
        text: 'provider transcript',
      }),
    );
    expect(appendSegmentGraphMock).toHaveBeenCalledWith(
      expect.objectContaining({
        segmentId: 'segment_30000',
        topic: 'provider topic',
      }),
    );
    expect(saveMergedGraphMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: expect.any(String),
        nodes: expect.arrayContaining([
          expect.objectContaining({
            text: 'provider transcript',
          }),
        ]),
      }),
    );
  });
});
