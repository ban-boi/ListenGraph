import type {
  GraphEdge,
  GraphNode,
  MergedGraph,
  SegmentGraph,
  StructurerProvider,
  StructurerProviderConfig,
  TranscriptChunk,
} from '@listen-graphic/schema';
import { generateId } from '@listen-graphic/shared-utils';
import { DEFAULT_RETRY_POLICY } from '../config';
import { createTimeoutSignal, mapHttpError, retryAsync } from '../http/retry';

type OpenAIChatResponse = {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
};

type SegmentGraphPayload = {
  topic?: string;
  nodes?: Array<Partial<GraphNode>>;
  edges?: Array<Partial<GraphEdge>>;
};

export class OpenAIStructurerProvider implements StructurerProvider {
  name = 'openai-structurer';

  constructor(private readonly config: StructurerProviderConfig) {}

  async extractSegmentGraph(input: {
    sessionId: string;
    transcriptWindow: TranscriptChunk[];
    previousGraph?: MergedGraph;
    language?: string;
  }): Promise<SegmentGraph> {
    const latestTranscript = input.transcriptWindow[input.transcriptWindow.length - 1];
    if (!latestTranscript) {
      throw new Error('Structurer requires at least one transcript chunk');
    }

    const retryPolicy = {
      ...DEFAULT_RETRY_POLICY,
      ...this.config.retry,
    };

    const payload = await retryAsync(
      async (attempt) => {
        const response = await fetch(
          `${this.config.endpoint ?? 'https://api.openai.com/v1'}/chat/completions`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${getCredential(this.config)}`,
            },
            body: JSON.stringify({
              model: this.config.model ?? 'gpt-4.1-mini',
              response_format: { type: 'json_object' },
              messages: buildMessages(input),
            }),
            signal: createTimeoutSignal(retryPolicy.timeoutMs),
          },
        );

        if (!response.ok) {
          throw mapHttpError({
            provider: this.name,
            stage: 'structurer',
            status: response.status,
            message: await safeReadError(response),
            attemptCount: attempt,
          });
        }

        const json = (await response.json()) as OpenAIChatResponse;
        const rawContent = json.choices?.[0]?.message?.content?.trim();
        if (!rawContent) {
          throw mapHttpError({
            provider: this.name,
            stage: 'structurer',
            code: 'INVALID_RESPONSE',
            message: 'Structurer provider returned an empty response',
            retriable: false,
            attemptCount: attempt,
          });
        }

        try {
          return JSON.parse(stripCodeFences(rawContent)) as SegmentGraphPayload;
        } catch {
          throw mapHttpError({
            provider: this.name,
            stage: 'structurer',
            code: 'INVALID_RESPONSE',
            message: 'Structurer provider returned invalid JSON',
            retriable: false,
            attemptCount: attempt,
          });
        }
      },
      retryPolicy,
    );

    return {
      segmentId: generateId('segment'),
      sessionId: input.sessionId,
      startMs: latestTranscript.startMs,
      endMs: latestTranscript.endMs,
      topic: payload.topic,
      provider: this.name,
      nodes: materializeNodes(payload.nodes, latestTranscript),
      edges: materializeEdges(payload.edges),
      raw: payload,
    };
  }
}

function getCredential(config: StructurerProviderConfig) {
  return config.mode === 'relay' ? config.sessionToken : config.apiKey;
}

function buildMessages(input: {
  transcriptWindow: TranscriptChunk[];
  previousGraph?: MergedGraph;
  language?: string;
}) {
  const transcriptText = input.transcriptWindow
    .map(
      (chunk) =>
        `[${chunk.startMs}-${chunk.endMs}] ${chunk.text}`,
    )
    .join('\n');

  return [
    {
      role: 'system',
      content:
        'You are a strict JSON structurer. Return only JSON with topic, nodes, and edges. Nodes must use allowed types: claim, reason, example, question, conclusion. Edges must use allowed types: supports, opposes, causes, follows, example_of.',
    },
    {
      role: 'user',
      content: JSON.stringify({
        language: input.language ?? 'zh',
        transcriptWindow: transcriptText,
        previousGraphSummary: input.previousGraph
          ? {
              nodeCount: input.previousGraph.nodes.length,
              edgeCount: input.previousGraph.edges.length,
            }
          : null,
      }),
    },
  ];
}

function materializeNodes(
  nodes: Array<Partial<GraphNode>> | undefined,
  latestTranscript: TranscriptChunk,
): GraphNode[] {
  if (!nodes?.length) {
    return [
      {
        id: generateId('node'),
        type: 'claim',
        text: latestTranscript.text,
        timestampMs: latestTranscript.startMs,
        status: 'draft',
        evidenceChunkIds: [latestTranscript.chunkId],
      },
    ];
  }

  return nodes.map((node) => ({
    id: node.id ?? generateId('node'),
    type: node.type ?? 'claim',
    text: node.text ?? latestTranscript.text,
    speaker: node.speaker,
    timestampMs: node.timestampMs ?? latestTranscript.startMs,
    confidence: node.confidence,
    status: node.status ?? 'draft',
    topicId: node.topicId,
    evidenceChunkIds: node.evidenceChunkIds?.length
      ? node.evidenceChunkIds
      : [latestTranscript.chunkId],
  }));
}

function materializeEdges(edges: Array<Partial<GraphEdge>> | undefined): GraphEdge[] {
  return (edges ?? [])
    .filter((edge) => edge.source && edge.target)
    .map((edge) => ({
      id: edge.id ?? generateId('edge'),
      source: edge.source as string,
      target: edge.target as string,
      type: edge.type ?? 'supports',
      confidence: edge.confidence,
      evidenceChunkIds: edge.evidenceChunkIds,
    }));
}

function stripCodeFences(content: string) {
  return content.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/, '');
}

async function safeReadError(response: Response) {
  try {
    return (await response.text()) || `Structurer request failed with status ${response.status}`;
  } catch {
    return `Structurer request failed with status ${response.status}`;
  }
}
