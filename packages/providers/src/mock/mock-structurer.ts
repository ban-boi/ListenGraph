import type {
  EdgeType,
  GraphNode,
  SegmentGraph,
  StructurerProvider,
  MergedGraph,
  TranscriptChunk,
} from '@listen-graphic/schema';
import { generateId } from '@listen-graphic/shared-utils';

const NODE_TYPES: GraphNode['type'][] = [
  'claim',
  'reason',
  'example',
  'question',
  'conclusion',
];

const EDGE_TYPES: EdgeType[] = [
  'supports',
  'opposes',
  'causes',
  'follows',
  'example_of',
];

const SPEAKERS = ['主持人', '嘉宾A', '嘉宾B'];

export class MockStructurerProvider implements StructurerProvider {
  name = 'mock-structurer';

  async extractSegmentGraph(input: {
    sessionId: string;
    transcriptWindow: TranscriptChunk[];
    previousGraph?: MergedGraph;
    language?: string;
  }): Promise<SegmentGraph> {
    const latestTranscript = input.transcriptWindow[input.transcriptWindow.length - 1];
    if (!latestTranscript) {
      throw new Error('MockStructurerProvider 需要至少一个 transcript chunk');
    }

    const segmentIndex = input.previousGraph?.nodes.length ?? 0;
    const nodeType = NODE_TYPES[segmentIndex % NODE_TYPES.length];
    const speaker = SPEAKERS[segmentIndex % SPEAKERS.length];
    const edgeType = EDGE_TYPES[segmentIndex % EDGE_TYPES.length];
    const confidence = 0.82 + ((segmentIndex % 4) * 0.03);
    const nodeId = generateId('node');
    const status: GraphNode['status'] =
      confidence >= 0.88 ? 'confirmed' : 'draft';

    const nodes: GraphNode[] = [
      {
        id: nodeId,
        type: nodeType,
        text: latestTranscript.text,
        speaker,
        timestampMs: latestTranscript.startMs,
        status,
        confidence,
        evidenceChunkIds: [latestTranscript.chunkId],
      },
    ];

    const previousNode =
      input.previousGraph?.nodes[input.previousGraph.nodes.length - 1];
    const edges = previousNode
      ? [
          {
            id: generateId('edge'),
            source: previousNode.id,
            target: nodeId,
            type: edgeType,
        confidence: 0.84 + ((segmentIndex % 3) * 0.03),
            evidenceChunkIds: [latestTranscript.chunkId],
          },
        ]
      : [];

    return {
      segmentId: generateId('segment'),
      sessionId: input.sessionId,
      startMs: latestTranscript.startMs,
      endMs: latestTranscript.endMs,
      topic: 'AI 创业讨论',
      provider: this.name,
      nodes,
      edges,
      raw: {
        transcriptWindowSize: input.transcriptWindow.length,
        language: input.language || 'zh',
      },
    };
  }

  reset() {
    // stateless mock provider: keep as no-op for compatibility
  }
}
