import { describe, expect, it } from 'vitest';
import { MockAsrProvider, MockStructurerProvider } from '@listen-graphic/providers';
import type { MergedGraph, TranscriptChunk } from '@listen-graphic/schema';

describe('Mock providers contract', () => {
  it('MockAsrProvider 返回符合契约的 transcript chunk', async () => {
    const provider = new MockAsrProvider();

    const transcript = await provider.transcribeChunk({
      audio: new ArrayBuffer(8),
      startMs: 1000,
      endMs: 4000,
      sessionId: 'session_1',
      language: 'zh',
    });

    expect(transcript.sessionId).toBe('session_1');
    expect(transcript.startMs).toBe(1000);
    expect(transcript.endMs).toBe(4000);
    expect(transcript.provider).toBe('mock-asr');
    expect(transcript.text.length).toBeGreaterThan(0);
    expect(transcript.tokens?.length).toBeGreaterThan(0);
    expect((transcript.raw as { audioSize: number }).audioSize).toBe(8);
  });

  it('MockAsrProvider 对不同 chunk 位置给出稳定且可恢复的输出', async () => {
    const firstProvider = new MockAsrProvider();
    const secondProvider = new MockAsrProvider();

    const firstChunk = await firstProvider.transcribeChunk({
      audio: new ArrayBuffer(8),
      startMs: 0,
      endMs: 30000,
      sessionId: 'session_1',
    });
    const laterChunk = await secondProvider.transcribeChunk({
      audio: new ArrayBuffer(8),
      startMs: 30000,
      endMs: 60000,
      sessionId: 'session_1',
    });

    expect(laterChunk.text).not.toBe(firstChunk.text);
  });

  it('MockStructurerProvider 使用最新 transcript 和上一版图生成当前 segment', async () => {
    const provider = new MockStructurerProvider();
    const transcriptWindow: TranscriptChunk[] = [
      {
        chunkId: 'chunk_1',
        sessionId: 'session_1',
        text: '上一段内容',
        startMs: 0,
        endMs: 10000,
        provider: 'mock-asr',
      },
      {
        chunkId: 'chunk_2',
        sessionId: 'session_1',
        text: '最新观点内容',
        startMs: 10000,
        endMs: 20000,
        provider: 'mock-asr',
      },
    ];

    const previousGraph: MergedGraph = {
      sessionId: 'session_1',
      revision: 1,
      topics: [],
      nodes: [
        {
          id: 'node_prev',
          type: 'claim',
          text: '上一节点',
          timestampMs: 0,
          status: 'confirmed',
        },
      ],
      edges: [],
      updatedAt: Date.now(),
    };

    const segment = await provider.extractSegmentGraph({
      sessionId: 'session_1',
      transcriptWindow,
      previousGraph,
      language: 'zh',
    });

    expect(segment.sessionId).toBe('session_1');
    expect(segment.startMs).toBe(10000);
    expect(segment.endMs).toBe(20000);
    expect(segment.provider).toBe('mock-structurer');
    expect(segment.nodes).toHaveLength(1);
    expect(segment.nodes[0].text).toBe('最新观点内容');
    expect(segment.nodes[0].timestampMs).toBe(10000);
    expect(segment.nodes[0].evidenceChunkIds).toEqual(['chunk_2']);
    expect(segment.edges).toHaveLength(1);
    expect(segment.edges[0]).toEqual(
      expect.objectContaining({
        source: 'node_prev',
        target: segment.nodes[0].id,
        evidenceChunkIds: ['chunk_2'],
      }),
    );
  });
});
