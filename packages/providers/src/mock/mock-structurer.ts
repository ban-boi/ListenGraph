import type {
  SegmentGraph,
  StructurerProvider,
  MergedGraph,
  TranscriptChunk,
} from '@listen-graphic/schema';

export class MockStructurerProvider implements StructurerProvider {
  name = 'mock-structurer';

  async extractSegmentGraph(input: {
    sessionId: string;
    transcriptWindow: TranscriptChunk[];
    previousGraph?: MergedGraph;
    language?: string;
  }): Promise<SegmentGraph> {
    return {
      segmentId: 'seg_1',
      sessionId: input.sessionId,
      startMs: 0,
      endMs: 60000,
      topic: 'mock topic',
      provider: this.name,
      nodes: [
        {
          id: 'n1',
          type: 'claim',
          text: 'AI 工具的核心不是摘要，而是理解结构',
          timestampMs: 5000,
          status: 'confirmed',
          confidence: 0.9,
        },
        {
          id: 'n2',
          type: 'reason',
          text: '长音频用户难以把握整体逻辑',
          timestampMs: 12000,
          status: 'confirmed',
          confidence: 0.88,
        },
      ],
      edges: [
        {
          id: 'e1',
          source: 'n2',
          target: 'n1',
          type: 'supports',
          confidence: 0.86,
        },
      ],
    };
  }
}
