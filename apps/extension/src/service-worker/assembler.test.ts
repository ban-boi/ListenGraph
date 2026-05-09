import { beforeEach, describe, expect, it } from 'vitest';
import {
  setupServiceWorkerTests,
  dispatchMessage,
  extractSegmentGraphMock,
  appendSegmentGraphMock,
  mockRealtimeProviderConfig,
  runInjectedStructurerSession,
} from './__test-helpers__/index-test-helpers';

describe('Service Worker - 汇编器', () => {
  beforeEach(async () => {
    await setupServiceWorkerTests();
  });

  it('已有 merged graph 时，会先缓冲单条增量 utterance，再将多条 utterance 聚合为一个 structure unit', async () => {
    mockRealtimeProviderConfig();
    const response = await runInjectedStructurerSession({
      seed: {
        mergedGraph: {
          sessionId: 'session_injected',
          revision: 1,
          topics: [],
          nodes: [
            {
              id: 'existing-node',
              type: 'claim',
              text: '已有节点',
              timestampMs: 0,
              status: 'confirmed',
              evidenceChunkIds: ['seed_chunk'],
            },
          ],
          edges: [],
          updatedAt: Date.now(),
        },
      },
      transcripts: [
        {
          chunkId: 'chunk_a',
          text: '第一段补充说明第一段补充说明第一段补充说明',
          startMs: 0,
          endMs: 3000,
          transport: 'ws',
        },
        {
          chunkId: 'chunk_b',
          text: '第二段补充说明第二段补充说明第二段补充说明',
          startMs: 3000,
          endMs: 6000,
          transport: 'ws',
        },
      ],
    });

    expect(response).toEqual(expect.objectContaining({ success: true }));
    expect(extractSegmentGraphMock).toHaveBeenCalledTimes(1);
    expect(extractSegmentGraphMock).toHaveBeenCalledWith(
      expect.objectContaining({
        previousGraph: expect.objectContaining({
          nodes: expect.arrayContaining([expect.objectContaining({ id: 'existing-node' })]),
        }),
        transcriptWindow: [
          expect.objectContaining({
            text: expect.stringContaining('第一段补充说明'),
            startMs: 0,
            endMs: 6000,
          }),
        ],
      }),
    );
  });

  it('已有 merged graph 时，会将明显半句和补完句以 merge_with_prev 提交', async () => {
    mockRealtimeProviderConfig();
    const response = await runInjectedStructurerSession({
      seed: {
        mergedGraph: {
          sessionId: 'session_injected',
          revision: 1,
          topics: [],
          nodes: [
            {
              id: 'existing-node',
              type: 'claim',
              text: '已有节点',
              timestampMs: 0,
              status: 'confirmed',
              evidenceChunkIds: ['seed_chunk'],
            },
          ],
          edges: [],
          updatedAt: Date.now(),
        },
      },
      transcripts: [
        {
          chunkId: 'chunk_incomplete',
          text: '这个方案现在最核心的问题在于',
          startMs: 0,
          endMs: 1200,
          transport: 'ws',
        },
        {
          chunkId: 'chunk_completion',
          text: '它需要先把实时转写和结构化输入的边界分清楚。',
          startMs: 1200,
          endMs: 3600,
          transport: 'ws',
        },
      ],
    });

    expect(response).toEqual(expect.objectContaining({ success: true }));
    expect(extractSegmentGraphMock).toHaveBeenCalledTimes(1);
    expect(extractSegmentGraphMock).toHaveBeenCalledWith(
      expect.objectContaining({
        transcriptWindow: [
          expect.objectContaining({
            text: expect.stringContaining('这个方案现在最核心的问题在于'),
            startMs: 0,
            endMs: 3600,
            raw: expect.objectContaining({
              reason: 'merge_with_prev',
              sourceChunkIds: ['chunk_incomplete', 'chunk_completion'],
              type: 'structure-unit',
            }),
          }),
        ],
      }),
    );
    expect(appendSegmentGraphMock).toHaveBeenCalledWith(
      expect.objectContaining({
        nodes: expect.arrayContaining([
          expect.objectContaining({
            evidenceChunkIds: ['chunk_incomplete', 'chunk_completion'],
          }),
        ]),
      }),
    );
  });

  it('已有 merged graph 时，不会把完整句误判为 merge_with_prev', async () => {
    mockRealtimeProviderConfig();
    const response = await runInjectedStructurerSession({
      seed: {
        mergedGraph: {
          sessionId: 'session_injected',
          revision: 1,
          topics: [],
          nodes: [
            {
              id: 'existing-node',
              type: 'claim',
              text: '已有节点',
              timestampMs: 0,
              status: 'confirmed',
              evidenceChunkIds: ['seed_chunk'],
            },
          ],
          edges: [],
          updatedAt: Date.now(),
        },
      },
      transcripts: [
        {
          chunkId: 'chunk_complete_a',
          text: '第一段已经完整说明了当前方案的基本约束。',
          startMs: 0,
          endMs: 1600,
          transport: 'ws',
        },
        {
          chunkId: 'chunk_complete_b',
          text: '第二段开始说明另一个独立的执行风险。',
          startMs: 1600,
          endMs: 3200,
          transport: 'ws',
        },
      ],
    });

    expect(response).toEqual(expect.objectContaining({ success: true }));

    const debugResponse = await dispatchMessage({
      type: 'GET_DEBUG_SESSION',
      target: 'service-worker',
      payload: { sessionId: 'session_injected' },
    });

    expect(debugResponse.success).toBe(true);
    expect(debugResponse.debugData.structureUnits ?? []).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reason: 'merge_with_prev',
        }),
      ]),
    );
  });

  it('已有 merged graph 时，会跳过低信息量稳定话语，不触发 structurer', async () => {
    mockRealtimeProviderConfig();
    const response = await runInjectedStructurerSession({
      seed: {
        mergedGraph: {
          sessionId: 'session_injected',
          revision: 1,
          topics: [],
          nodes: [
            {
              id: 'existing-node',
              type: 'claim',
              text: '已有节点',
              timestampMs: 0,
              status: 'confirmed',
              evidenceChunkIds: ['seed_chunk'],
            },
          ],
          edges: [],
          updatedAt: Date.now(),
        },
      },
      transcripts: [
        {
          chunkId: 'chunk_noise',
          text: '好的',
          startMs: 0,
          endMs: 1000,
          transport: 'ws',
        },
      ],
    });

    expect(response.success).toBe(true);
    expect(extractSegmentGraphMock).not.toHaveBeenCalled();
  });
});
