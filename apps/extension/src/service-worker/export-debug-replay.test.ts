import { ProviderRequestError } from '@listen-graphic/providers';
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
  listAllMergedGraphsMock,
  getSessionMock,
  bootstrapStructurerWindow,
  startRealtimeSession,
  sendStableUtterance,
} from './__test-helpers__/index-test-helpers';

describe('Service Worker - 导出、调试与回放', () => {
  beforeEach(async () => {
    await setupServiceWorkerTests();
  });

  it('调试会话会返回 transcript、segment 和逐轮 trace', async () => {
    const storedTranscripts: Record<string, unknown>[] = [];
    const storedSegments: Record<string, unknown>[] = [];
    let storedGraph: Record<string, unknown> | undefined;

    appendTranscriptChunkMock.mockImplementation(async (chunk: Record<string, unknown>) => {
      storedTranscripts.push(chunk);
    });
    listTranscriptChunksBySessionMock.mockImplementation(async (sessionId: string) =>
      storedTranscripts.filter((chunk) => chunk.sessionId === sessionId),
    );
    appendSegmentGraphMock.mockImplementation(async (segment: Record<string, unknown>) => {
      storedSegments.push(segment);
    });
    listSegmentGraphsBySessionMock.mockImplementation(async (sessionId: string) =>
      storedSegments.filter((segment) => segment.sessionId === sessionId),
    );
    saveMergedGraphMock.mockImplementation(async (graph: Record<string, unknown>) => {
      storedGraph = graph;
    });
    getMergedGraphBySessionMock.mockImplementation(async (sessionId: string) =>
      storedGraph?.sessionId === sessionId ? storedGraph : undefined,
    );

    const startResponse = await dispatchMessage(
      {
        type: 'SESSION_START',
        target: 'service-worker',
        payload: { tabId: 123 },
      },
      { tab: { id: 123 } },
    );
    const sessionId = startResponse.sessionId;

    await bootstrapStructurerWindow();

    const debugResponse = await dispatchMessage({
      type: 'GET_DEBUG_SESSION',
      target: 'service-worker',
      payload: { sessionId },
    });

    expect(debugResponse.success).toBe(true);
    expect(debugResponse.debugData.transcripts).toHaveLength(3);
    expect(debugResponse.debugData.segments).toHaveLength(1);
    expect(debugResponse.debugData.structurerRuns).toHaveLength(1);
    expect(debugResponse.debugData.traces).toHaveLength(3);
    expect(debugResponse.debugData.traces).toEqual([
      expect.objectContaining({
        sequence: 1,
        segment: null,
        structurerRun: null,
        assemblerRun: null,
      }),
      expect.objectContaining({
        sequence: 2,
        segment: null,
        structurerRun: null,
        assemblerRun: null,
      }),
      expect.objectContaining({
        sequence: 3,
        transcript: expect.objectContaining({
          chunkId: 'chunk_mock',
          text: 'provider transcript',
        }),
        transcriptWindow: [
          expect.objectContaining({
            chunkId: 'chunk_mock',
          }),
          expect.objectContaining({
            chunkId: 'chunk_mock',
          }),
          expect.objectContaining({
            chunkId: 'chunk_mock',
          }),
        ],
        segment: expect.objectContaining({
          segmentId: 'segment_30000',
          provider: 'mock-structurer',
        }),
        structurerRun: expect.objectContaining({
          segmentId: 'segment_30000',
          status: 'success',
          windowChunkCount: 3,
        }),
        assemblerRun: null,
        mergedGraphAfter: expect.objectContaining({
          sessionId,
          nodes: expect.arrayContaining([
            expect.objectContaining({
              text: 'provider transcript',
            }),
          ]),
        }),
      }),
    ]);
  });

  it('ws 调试会话会暴露 assembler 运行与 structure unit', async () => {
    const storedTranscripts: Record<string, unknown>[] = [];
    const storedSegments: Record<string, unknown>[] = [];
    let storedGraph: Record<string, unknown> | undefined;

    appendTranscriptChunkMock.mockImplementation(async (chunk: Record<string, unknown>) => {
      storedTranscripts.push(chunk);
    });
    listTranscriptChunksBySessionMock.mockImplementation(async (sessionId: string) =>
      storedTranscripts.filter((chunk) => chunk.sessionId === sessionId),
    );
    appendSegmentGraphMock.mockImplementation(async (segment: Record<string, unknown>) => {
      storedSegments.push(segment);
    });
    listSegmentGraphsBySessionMock.mockImplementation(async (sessionId: string) =>
      storedSegments.filter((segment) => segment.sessionId === sessionId),
    );
    saveMergedGraphMock.mockImplementation(async (graph: Record<string, unknown>) => {
      storedGraph = graph;
    });
    getMergedGraphBySessionMock.mockImplementation(async (sessionId: string) =>
      storedGraph?.sessionId === sessionId ? storedGraph : undefined,
    );
    const startResponse = await startRealtimeSession();
    const sessionId = startResponse.sessionId;
    getSessionMock.mockImplementation(async (requestedSessionId: string) =>
      requestedSessionId === sessionId
        ? {
            sessionId,
            sourceType: 'tab',
            createdAt: 100,
          }
        : undefined,
    );

    await sendStableUtterance({
      text: '我们先把今天讨论的主题和前提条件大致梳理一下，这样后面不容易混乱。',
      startMs: 0,
      endMs: 25_000,
    });
    await sendStableUtterance({
      text: '接下来会重点谈执行层面的约束、预期结果以及为什么这件事必须现在推进。',
      startMs: 25_000,
      endMs: 52_000,
      finalReason: 'input_finished',
    });
    await sendStableUtterance({
      text: '这个问题其实和后面的执行细节',
      startMs: 52_000,
      endMs: 53_500,
    });
    await sendStableUtterance({
      text: '有直接关系，所以我们需要先把边界梳理清楚。',
      startMs: 53_500,
      endMs: 55_600,
    });

    const debugResponse = await dispatchMessage({
      type: 'GET_DEBUG_SESSION',
      target: 'service-worker',
      payload: { sessionId },
    });

    expect(debugResponse.success).toBe(true);
    expect(debugResponse.debugData.assemblerRuns?.length).toBeGreaterThanOrEqual(4);
    expect(debugResponse.debugData.structureUnits).toHaveLength(1);
    expect(debugResponse.debugData.traces[2]).toEqual(
      expect.objectContaining({
        sequence: 3,
        assemblerRun: expect.objectContaining({
          decision: 'wait',
          latestTranscriptId: storedTranscripts[2]?.chunkId,
        }),
        structurerRun: null,
      }),
    );
    expect(debugResponse.debugData.traces[3]).toEqual(
      expect.objectContaining({
        sequence: 4,
        assemblerRun: expect.objectContaining({
          decision: 'commit',
          committedUnitId: expect.any(String),
          committedChunkIds: [storedTranscripts[2]?.chunkId, storedTranscripts[3]?.chunkId],
        }),
        structurerRun: expect.objectContaining({
          status: 'success',
          latestTranscriptId: expect.stringMatching(/^structure_unit_/),
        }),
      }),
    );
    expect(debugResponse.debugData.structureUnits[0]).toEqual(
      expect.objectContaining({
        sourceChunkIds: [storedTranscripts[2]?.chunkId, storedTranscripts[3]?.chunkId],
        reason: 'commit_rule',
      }),
    );
  });

  it('structurer 抛出带 structurerDiagnostics 时，debug 与 lastProviderError 保留诊断', async () => {
    const storedTranscripts: Record<string, unknown>[] = [];
    appendTranscriptChunkMock.mockImplementation(async (chunk: Record<string, unknown>) => {
      storedTranscripts.push(chunk);
    });
    listTranscriptChunksBySessionMock.mockImplementation(async (sessionId: string) =>
      storedTranscripts.filter((chunk) => chunk.sessionId === sessionId),
    );

    extractSegmentGraphMock.mockRejectedValueOnce(
      new ProviderRequestError({
        code: 'INVALID_RESPONSE',
        message: 'Structurer provider returned invalid JSON',
        provider: 'mock-structurer',
        stage: 'structurer',
        retriable: true,
        structurerDiagnostics: {
          responsePreview: '{broken',
          responseTruncated: false,
          parseStage: 'primary_json',
          parseMessage: 'Unexpected token',
        },
      }),
    );

    const startResponse = await dispatchMessage(
      {
        type: 'SESSION_START',
        target: 'service-worker',
        payload: { tabId: 123 },
      },
      { tab: { id: 123 } },
    );
    const sessionId = startResponse.sessionId;

    await bootstrapStructurerWindow();

    const debugResponse = await dispatchMessage({
      type: 'GET_DEBUG_SESSION',
      target: 'service-worker',
      payload: { sessionId },
    });

    expect(debugResponse.success).toBe(true);
    expect(debugResponse.debugData.lastProviderError).toEqual(
      expect.objectContaining({
        code: 'INVALID_RESPONSE',
        structurerDiagnostics: expect.objectContaining({
          responsePreview: '{broken',
          parseStage: 'primary_json',
        }),
      }),
    );
    const runs = debugResponse.debugData.structurerRuns ?? [];
    expect(runs.length).toBeGreaterThanOrEqual(1);
    expect(runs[runs.length - 1]).toEqual(
      expect.objectContaining({
        status: 'error',
        errorCode: 'INVALID_RESPONSE',
        structurerDiagnostics: expect.objectContaining({
          responsePreview: '{broken',
          parseStage: 'primary_json',
        }),
      }),
    );
  });

  it('可以导出当前会话的 JSON 资产', async () => {
    getSessionMock.mockResolvedValue({
      sessionId: 'session_export',
      sourceType: 'tab',
      createdAt: 100,
      endedAt: 200,
    });
    listTranscriptChunksBySessionMock.mockResolvedValue([
      {
        chunkId: 'chunk_export',
        sessionId: 'session_export',
        text: '导出文本',
        startMs: 0,
        endMs: 30000,
        provider: 'mock-asr',
      },
    ]);
    getMergedGraphBySessionMock.mockResolvedValue({
      sessionId: 'session_export',
      revision: 1,
      topics: [],
      nodes: [
        {
          id: 'node_export',
          type: 'claim',
          text: '导出节点',
          timestampMs: 0,
          status: 'confirmed',
        },
      ],
      edges: [],
      viewHints: {
        defaultView: 'timeline',
      },
      updatedAt: 200,
    });

    const exportResponse = await dispatchMessage({
      type: 'EXPORT_SESSION',
      target: 'service-worker',
      payload: { sessionId: 'session_export', format: 'json' },
    });

    expect(exportResponse.success).toBe(true);
    expect(exportResponse.exportData.filename).toContain('session_export');
    expect(exportResponse.exportData.mimeType).toBe('application/json');
    expect(exportResponse.exportData.content).toContain('"sessionId": "session_export"');
    expect(exportResponse.exportData.content).toContain('"导出文本"');
    expect(exportResponse.exportData.content).toContain('"导出节点"');
  });

  it('会话图导出不会混入 assembler 调试数据', async () => {
    const storedTranscripts: Record<string, unknown>[] = [];
    const storedSegments: Record<string, unknown>[] = [];
    let storedGraph: Record<string, unknown> | undefined;

    appendTranscriptChunkMock.mockImplementation(async (chunk: Record<string, unknown>) => {
      storedTranscripts.push(chunk);
    });
    listTranscriptChunksBySessionMock.mockImplementation(async (sessionId: string) =>
      storedTranscripts.filter((chunk) => chunk.sessionId === sessionId),
    );
    appendSegmentGraphMock.mockImplementation(async (segment: Record<string, unknown>) => {
      storedSegments.push(segment);
    });
    listSegmentGraphsBySessionMock.mockImplementation(async (sessionId: string) =>
      storedSegments.filter((segment) => segment.sessionId === sessionId),
    );
    saveMergedGraphMock.mockImplementation(async (graph: Record<string, unknown>) => {
      storedGraph = graph;
    });
    getMergedGraphBySessionMock.mockImplementation(async (sessionId: string) =>
      storedGraph?.sessionId === sessionId ? storedGraph : undefined,
    );
    const startResponse = await startRealtimeSession();
    const sessionId = startResponse.sessionId;
    getSessionMock.mockImplementation(async (requestedSessionId: string) =>
      requestedSessionId === sessionId
        ? {
            sessionId,
            sourceType: 'tab',
            createdAt: 100,
            endedAt: 200,
          }
        : undefined,
    );

    await sendStableUtterance({
      text: '我们先把这次讨论的前提条件和背景交代清楚，后面才能稳定往下推。',
      startMs: 0,
      endMs: 24_000,
    });
    await sendStableUtterance({
      text: '接下来重点会落在执行路径、约束关系和为什么这个问题不能继续拖延上。',
      startMs: 24_000,
      endMs: 50_000,
      finalReason: 'input_finished',
    });
    await sendStableUtterance({
      text: '我们先把讨论的前提条件列出来',
      startMs: 50_000,
      endMs: 51_200,
    });
    await sendStableUtterance({
      text: '这样后面的约束和执行路径就不会混在一起了。',
      startMs: 51_200,
      endMs: 53_300,
    });

    const exportResponse = await dispatchMessage({
      type: 'EXPORT_SESSION',
      target: 'service-worker',
      payload: { sessionId, format: 'json' },
    });

    expect(exportResponse.success).toBe(true);
    const parsed = JSON.parse(exportResponse.exportData.content);
    expect(parsed.assemblerRuns).toBeUndefined();
    expect(parsed.structureUnits).toBeUndefined();

    const debugResponse = await dispatchMessage({
      type: 'GET_DEBUG_SESSION',
      target: 'service-worker',
      payload: { sessionId },
    });

    expect(debugResponse.success).toBe(true);
    expect(debugResponse.debugData.assemblerRuns.length).toBeGreaterThanOrEqual(4);
    expect(debugResponse.debugData.structureUnits).toHaveLength(1);
    expect(debugResponse.debugData.structureUnits[0].sourceChunkIds).toEqual([
      storedTranscripts[2]?.chunkId,
      storedTranscripts[3]?.chunkId,
    ]);
  });

  it('缺少 graph 资产时不会导出 Mermaid', async () => {
    getSessionMock.mockResolvedValue({
      sessionId: 'session_without_graph',
      sourceType: 'tab',
      createdAt: 100,
      endedAt: 200,
    });
    listTranscriptChunksBySessionMock.mockResolvedValue([]);
    getMergedGraphBySessionMock.mockResolvedValue(undefined);

    const exportResponse = await dispatchMessage({
      type: 'EXPORT_SESSION',
      target: 'service-worker',
      payload: { sessionId: 'session_without_graph', format: 'mermaid' },
    });

    expect(exportResponse.success).toBe(false);
    expect(exportResponse.error).toContain('graph');
  });

  it('当前会话处于 transcribing 时不会导出不一致快照', async () => {
    let resolveTranscribe!: (value: unknown) => void;
    transcribeChunkMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveTranscribe = resolve;
        }),
    );

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

    const exportResponse = await dispatchMessage({
      type: 'EXPORT_SESSION',
      target: 'service-worker',
      payload: { sessionId: startResponse.sessionId, format: 'json' },
    });

    resolveTranscribe({
      chunkId: 'chunk_after_export_attempt',
      sessionId: startResponse.sessionId,
      text: '稍后完成',
      startMs: 0,
      endMs: 30000,
      provider: 'mock-asr',
    });
    await chunkPromise;

    expect(exportResponse.success).toBe(false);
    expect(exportResponse.error).toContain('处理中');
  });

  it('可以返回当前会话的 debug 资产快照', async () => {
    getSessionMock.mockResolvedValue({
      sessionId: 'session_debug',
      sourceType: 'tab',
      createdAt: 100,
      endedAt: 200,
    });
    listTranscriptChunksBySessionMock.mockResolvedValue([
      {
        chunkId: 'chunk_debug_1',
        sessionId: 'session_debug',
        text: '第一段调试转写',
        startMs: 0,
        endMs: 30000,
        provider: 'mock-asr',
      },
    ]);
    getMergedGraphBySessionMock.mockResolvedValue({
      sessionId: 'session_debug',
      revision: 1,
      topics: [],
      nodes: [
        {
          id: 'node_debug',
          type: 'claim',
          text: '调试节点',
          timestampMs: 0,
          status: 'confirmed',
        },
      ],
      edges: [],
      viewHints: {
        defaultView: 'timeline',
      },
      updatedAt: 200,
    });

    const debugResponse = await dispatchMessage({
      type: 'GET_DEBUG_SESSION',
      target: 'service-worker',
      payload: { sessionId: 'session_debug' },
    });

    expect(debugResponse.success).toBe(true);
    expect(debugResponse.debugData.session.sessionId).toBe('session_debug');
    expect(debugResponse.debugData.transcripts).toHaveLength(1);
    expect(debugResponse.debugData.graph.nodes[0].text).toBe('调试节点');
  });

  it('runtime snapshot 会暴露当前 pending assembler 状态', async () => {
    const startResponse = await startRealtimeSession();
    expect(startResponse.success).toBe(true);

    const utteranceResponse = await sendStableUtterance({
      text: '我觉得这个问题还需要继续展开',
      startMs: 0,
      endMs: 1_000,
    });
    expect(utteranceResponse.success).toBe(true);

    const snapshotResponse = await dispatchMessage({
      type: 'GET_RUNTIME_SNAPSHOT',
      target: 'service-worker',
      payload: {},
    });

    expect(snapshotResponse.snapshot.currentAssemblerState).toEqual(
      expect.objectContaining({
        enabled: true,
        pendingUtteranceCount: 1,
        pendingEffectiveCharCount: expect.any(Number),
        pendingPreview: '我觉得这个问题还需要继续展开',
      }),
    );
  });

  it('可以返回会话回放所需的 transcript 和时长', async () => {
    getSessionMock.mockResolvedValue({
      sessionId: 'session_replay',
      sourceType: 'tab',
      createdAt: 100,
      endedAt: 200,
    });
    listTranscriptChunksBySessionMock.mockResolvedValue([
      {
        chunkId: 'chunk_replay_1',
        sessionId: 'session_replay',
        text: '第一段回放转写',
        startMs: 0,
        endMs: 30000,
        provider: 'mock-asr',
      },
      {
        chunkId: 'chunk_replay_2',
        sessionId: 'session_replay',
        text: '第二段回放转写',
        startMs: 30000,
        endMs: 60000,
        provider: 'mock-asr',
      },
    ]);
    getMergedGraphBySessionMock.mockResolvedValue({
      sessionId: 'session_replay',
      revision: 1,
      topics: [],
      nodes: [
        {
          id: 'node_replay',
          type: 'claim',
          text: '回放节点',
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

    const replayResponse = await dispatchMessage({
      type: 'GET_REPLAY_SESSION',
      target: 'service-worker',
      payload: { sessionId: 'session_replay' },
    });

    expect(replayResponse.success).toBe(true);
    expect(replayResponse.replayData.session.sessionId).toBe('session_replay');
    expect(replayResponse.replayData.transcripts).toHaveLength(2);
    expect(replayResponse.replayData.durationMs).toBe(60000);
    expect(replayResponse.replayData.graph.nodes[0].text).toBe('回放节点');
  });

  it('EXPORT_ALL_GRAPHS 通过 dispatchMessage 正确路由', async () => {
    listAllMergedGraphsMock.mockResolvedValue([
      {
        sessionId: 's1',
        revision: 1,
        topics: [],
        nodes: [
          {
            id: 'n1',
            type: 'claim',
            text: '测试',
            timestampMs: 0,
            status: 'confirmed',
          },
        ],
        edges: [],
        updatedAt: 100,
      },
    ]);

    const response = await dispatchMessage({
      type: 'EXPORT_ALL_GRAPHS',
      target: 'service-worker',
      payload: {},
    });

    expect(response.success).toBe(true);
    const parsed = JSON.parse(response.exportData.content);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].sessionId).toBe('s1');
    expect(response.exportData.mimeType).toBe('application/json');
    expect(response.exportData.filename).toMatch(/^graph-corpus-\d{4}-\d{2}-\d{2}\.json$/);
  });

  it('EXPORT_ALL_GRAPHS 在无有效 graph 时返回失败', async () => {
    listAllMergedGraphsMock.mockResolvedValue([]);

    const response = await dispatchMessage({
      type: 'EXPORT_ALL_GRAPHS',
      target: 'service-worker',
      payload: {},
    });

    expect(response.success).toBe(false);
    expect(response.error).toBe('没有有效的 graph 数据可导出');
  });

  it('EXPORT_ALL_GRAPHS 会过滤损坏 graph 并按 sessionId 升序排列', async () => {
    listAllMergedGraphsMock.mockResolvedValue([
      {
        sessionId: 's3',
        revision: 1,
        topics: [],
        nodes: [
          {
            id: 'n3',
            type: 'claim',
            text: '第三个',
            timestampMs: 0,
            status: 'confirmed',
          },
        ],
        edges: [],
        updatedAt: 300,
      },
      {
        sessionId: 's1',
        revision: 1,
        topics: [],
        nodes: [
          {
            id: 'n1',
            type: 'claim',
            text: '第一个',
            timestampMs: 0,
            status: 'confirmed',
          },
        ],
        edges: [],
        updatedAt: 100,
      },
      {
        sessionId: 'corrupt',
        revision: 1,
        topics: [],
        nodes: [],
        edges: [],
        updatedAt: 50,
      },
      {
        sessionId: 'invalid',
      },
      {
        sessionId: 's2',
        revision: 1,
        topics: [],
        nodes: [
          {
            id: 'n2',
            type: 'claim',
            text: '第二个',
            timestampMs: 0,
            status: 'confirmed',
          },
        ],
        edges: [],
        updatedAt: 200,
      },
    ]);

    const response = await dispatchMessage({
      type: 'EXPORT_ALL_GRAPHS',
      target: 'service-worker',
      payload: {},
    });

    expect(response.success).toBe(true);
    const parsed = JSON.parse(response.exportData.content);
    expect(parsed).toHaveLength(3);
    expect(parsed.map((graph: { sessionId: string }) => graph.sessionId)).toEqual([
      's1',
      's2',
      's3',
    ]);
  });
});
