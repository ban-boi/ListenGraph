import type {
  EdgeType,
  GraphEdge,
  GraphNode,
  MergedGraph,
  NodeType,
  SegmentGraph,
  StructurerProvider,
  StructurerProviderConfig,
  TranscriptChunk,
} from '@listen-graphic/schema';
import { generateId } from '@listen-graphic/shared-utils';
import { DEFAULT_STRUCTURER_RETRY_POLICY } from '../config';
import {
  createTimeoutSignal,
  mapHttpError,
  retryAsync,
  type ProviderRequestError,
} from '../http/retry';

type OpenAIChatResponse = {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
  }>;
};

type SegmentGraphPayload = {
  answer?: {
    topic?: string;
    nodes?: unknown[];
    edges?: unknown[];
  };
  topic?: string;
  nodes?: unknown[];
  edges?: unknown[];
};

type NormalizedSegmentGraphPayload = {
  topic?: string;
  nodes: NormalizedNode[];
  edges: NormalizedEdge[];
};

type NormalizedNode = {
  providerLocalId: string;
  type: NodeType;
  text: string;
  speaker?: string;
  timestampMs?: number;
  confidence?: number;
  status?: GraphNode['status'];
  topicId?: string;
  evidenceChunkIds?: string[];
};

type NormalizedEdge = {
  source: string;
  target: string;
  type: EdgeType;
  confidence?: number;
  evidenceChunkIds?: string[];
};

type RecentGraphContextEntry = Pick<GraphNode, 'id' | 'type' | 'text' | 'timestampMs'>;
type RecentGraphContext = {
  nodes: RecentGraphContextEntry[];
  edges: Array<Pick<GraphEdge, 'source' | 'target' | 'type'>>;
};

const ALLOWED_NODE_TYPES = new Set<NodeType>([
  'claim',
  'reason',
  'example',
  'question',
  'conclusion',
]);
const ALLOWED_EDGE_TYPES = new Set<EdgeType>([
  'supports',
  'opposes',
  'causes',
  'follows',
  'example_of',
]);
const TENCENT_TRANSCRIPT_PREFIX =
  /^\[\d+:\d+\.\d+,\d+:\d+\.\d+\]\s*/;

export class OpenAIStructurerProvider implements StructurerProvider {
  name = 'openai-structurer';

  constructor(private readonly config: StructurerProviderConfig) {}

  async extractSegmentGraph(input: {
    sessionId: string;
    transcriptWindow: TranscriptChunk[];
    previousGraph?: MergedGraph;
    language?: string;
  }): Promise<SegmentGraph> {
    const firstTranscript = input.transcriptWindow[0];
    const latestTranscript = input.transcriptWindow[input.transcriptWindow.length - 1];
    if (!firstTranscript || !latestTranscript) {
      throw new Error('Structurer requires at least one transcript chunk');
    }
    const segmentId = generateId('segment');

    const retryPolicy = {
      ...DEFAULT_STRUCTURER_RETRY_POLICY,
      ...this.config.retry,
    };
    const recentGraphContext = getRecentGraphContext(input.previousGraph);

    const rawPayload = await retryAsync(
      async (attempt) => {
        let response: Response;
        try {
          response = await fetch(
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
                messages: buildMessages(input, recentGraphContext),
                ...(this.config.type === 'zhipu'
                  ? {
                      thinking: {
                        type: 'disabled',
                      },
                    }
                  : {}),
              }),
              signal: createTimeoutSignal(retryPolicy.timeoutMs),
            },
          );
        } catch (error) {
          if (isAbortError(error)) {
            throw mapHttpError({
              provider: this.name,
              stage: 'structurer',
              code: 'TIMEOUT_ERROR',
              message: `Structurer request timed out after ${retryPolicy.timeoutMs}ms`,
              retriable: false,
              attemptCount: attempt,
            });
          }

          throw error;
        }

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
      (error) => isRetriableProviderError(error, retryPolicy),
    );
    const payload = normalizeSegmentGraphPayload(rawPayload);
    const materializedNodes = materializeNodes({
      nodes: payload.nodes,
      latestTranscript,
      latestTranscriptText: cleanTranscriptText(latestTranscript.text),
      segmentId,
      allowFallback: !input.previousGraph,
    });

    return {
      segmentId,
      sessionId: input.sessionId,
      startMs: input.previousGraph ? latestTranscript.startMs : firstTranscript.startMs,
      endMs: latestTranscript.endMs,
      topic: payload.topic,
      provider: this.name,
      nodes: materializedNodes.nodes,
      edges: materializeEdges({
        edges: payload.edges,
        providerLocalToCanonicalId: materializedNodes.providerLocalToCanonicalId,
        recentGraphNodeIds: new Set(recentGraphContext.nodes.map((node) => node.id)),
        latestChunkId: latestTranscript.chunkId,
      }),
      raw: rawPayload,
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
}, recentGraphContext: RecentGraphContext) {
  const transcriptText = input.transcriptWindow
    .map(
      (chunk) =>
        `[${chunk.startMs}-${chunk.endMs}] ${cleanTranscriptText(chunk.text)}`,
    )
    .join('\n');
  const latestTranscript = input.transcriptWindow[input.transcriptWindow.length - 1];
  const mode = input.previousGraph ? 'incremental' : 'bootstrap';

  return [
    {
      role: 'system',
      content: [
        'You are a strict JSON structurer for ListenGraph.',
        'Return only one JSON object. No markdown, no explanation, no code fences.',
        'The JSON shape must be exactly:',
        '{"topic":"string","nodes":[{"id":"n1","type":"claim","text":"short text"}],"edges":[{"source":"n1","target":"n2","type":"supports"}]}',
        'Allowed node types: claim, reason, example, question, conclusion.',
        'Allowed edge types: supports, opposes, causes, follows, example_of.',
        'Node text must be concise, atomic, and must not include timestamps.',
        'If there is not enough new information, return {"topic":"","nodes":[],"edges":[]}.',
        'When mode is bootstrap, summarize the full window into useful nodes.',
        'When mode is incremental, only output net-new nodes implied by latestChunkTranscript.',
        'Preserve explicit names, titles, and concrete quoted terms from the transcript when they matter, especially person names, show names, and debate/topic labels.',
        'Do not replace explicit names or concrete terms with vague abstractions when the literal wording carries meaning.',
        'Do not restate, paraphrase, or rename semantics that already exist in recentGraphContext.',
        'If latestChunkTranscript mainly adds detail, support, or an example for an existing node, prefer adding an edge instead of repeating the claim as a new node.',
        'If latestChunkTranscript describes a benefit, reason, consequence, or clarification of a recentGraphContext node, output a new reason/example node and connect it to the matching recentGraphContext node id.',
        'When recentGraphContext already contains the main claim and latestChunkTranscript gives a supporting benefit, rationale, or concrete implication, do not leave the new node disconnected.',
        'If you return multiple new nodes in incremental mode, at least one returned edge must directly connect a new node to the matching recentGraphContext node id whenever the latestChunkTranscript explains or evaluates that existing claim.',
        'Do not keep all returned edges only between newly created nodes when the latestChunkTranscript is clearly providing reasons, consequences, or objections about a recentGraphContext node.',
        'If latestChunkTranscript is only a stage direction, sponsor read, greeting, applause cue, host transition, seating instruction, or a fragment with no stable proposition, return empty nodes and edges.',
        'If latestChunkTranscript does not introduce net-new semantics, return empty nodes and edges.',
        'Edges may connect returned node ids to other returned node ids or to recentGraphContext node ids.',
        'Avoid repeating the same event, debate topic, example, or claim with different wording.',
      ].join(' '),
    },
    {
      role: 'user',
      content: JSON.stringify({
        language: input.language ?? 'zh',
        mode,
        windowTranscript: transcriptText,
        latestChunkTranscript: latestTranscript
          ? `[${latestTranscript.startMs}-${latestTranscript.endMs}] ${cleanTranscriptText(latestTranscript.text)}`
          : '',
        recentGraphContext,
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

function materializeNodes(params: {
  nodes: NormalizedNode[];
  latestTranscript: TranscriptChunk;
  latestTranscriptText: string;
  segmentId: string;
  allowFallback: boolean;
}) {
  const providerLocalToCanonicalId = new Map<string, string>();

  if (params.nodes.length === 0) {
    if (!params.allowFallback) {
      return {
        providerLocalToCanonicalId,
        nodes: [],
      };
    }
    const fallbackId = `${params.segmentId}:fallback`;
    providerLocalToCanonicalId.set('fallback', fallbackId);
    return {
      providerLocalToCanonicalId,
      nodes: [
        {
          id: fallbackId,
          type: 'claim' as const,
          text: params.latestTranscriptText,
          timestampMs: params.latestTranscript.startMs,
          status: 'draft' as const,
          evidenceChunkIds: [params.latestTranscript.chunkId],
        },
      ],
    };
  }

  const nodes = params.nodes.map((node, index) => {
    const providerLocalId = node.providerLocalId || `node_${index + 1}`;
    const canonicalId = `${params.segmentId}:${providerLocalId}`;
    if (!providerLocalToCanonicalId.has(providerLocalId)) {
      providerLocalToCanonicalId.set(providerLocalId, canonicalId);
    }

    return {
      id: canonicalId,
      type: node.type,
      text: node.text,
      speaker: node.speaker,
      timestampMs: node.timestampMs ?? params.latestTranscript.startMs,
      confidence: node.confidence,
      status: node.status ?? 'draft',
      topicId: node.topicId,
      evidenceChunkIds: node.evidenceChunkIds?.length
        ? node.evidenceChunkIds
        : [params.latestTranscript.chunkId],
    };
  });

  return {
    providerLocalToCanonicalId,
    nodes,
  };
}

function materializeEdges(params: {
  edges: NormalizedEdge[];
  providerLocalToCanonicalId: Map<string, string>;
  recentGraphNodeIds: Set<string>;
  latestChunkId: string;
}): GraphEdge[] {
  const materializedEdges: GraphEdge[] = [];

  params.edges.forEach((edge) => {
      const source =
        params.providerLocalToCanonicalId.get(edge.source) ??
        (params.recentGraphNodeIds.has(edge.source) ? edge.source : null);
      const target =
        params.providerLocalToCanonicalId.get(edge.target) ??
        (params.recentGraphNodeIds.has(edge.target) ? edge.target : null);

      if (!source || !target) {
        return;
      }

      materializedEdges.push({
        id: generateId('edge'),
        source,
        target,
        type: edge.type,
        confidence: edge.confidence,
        evidenceChunkIds: edge.evidenceChunkIds?.length
          ? edge.evidenceChunkIds
          : [params.latestChunkId],
      });
    });

  return materializedEdges;
}

function normalizeSegmentGraphPayload(payload: SegmentGraphPayload): NormalizedSegmentGraphPayload {
  const root = isRecord(payload.answer) ? payload.answer : payload;

  return {
    topic: asTrimmedString(root.topic),
    nodes: Array.isArray(root.nodes)
      ? root.nodes
          .map((node, index) => normalizeNode(node, index))
          .filter((node): node is NormalizedNode => node !== null)
      : [],
    edges: Array.isArray(root.edges)
      ? root.edges
          .map((edge) => normalizeEdge(edge))
          .filter((edge): edge is NormalizedEdge => edge !== null)
      : [],
  };
}

function normalizeNode(node: unknown, index: number): NormalizedNode | null {
  if (!isRecord(node)) {
    return null;
  }

  const type = asTrimmedString(node.type);
  if (!type || !ALLOWED_NODE_TYPES.has(type as NodeType)) {
    return null;
  }

  const text =
    asTrimmedString(node.text) ??
    asTrimmedString(node.content) ??
    asTrimmedString(node.label);
  if (!text) {
    return null;
  }

  return {
    providerLocalId: String(node.id ?? `node_${index + 1}`),
    type: type as NodeType,
    text,
    speaker: asTrimmedString(node.speaker),
    timestampMs: asFiniteNumber(node.timestampMs),
    confidence: asFiniteNumber(node.confidence),
    status: node.status === 'confirmed' ? 'confirmed' : node.status === 'draft' ? 'draft' : undefined,
    topicId: asTrimmedString(node.topicId),
    evidenceChunkIds: normalizeStringArray(node.evidenceChunkIds),
  };
}

function normalizeEdge(edge: unknown): NormalizedEdge | null {
  if (!isRecord(edge)) {
    return null;
  }

  const source = asTrimmedString(edge.source);
  const target = asTrimmedString(edge.target);
  const edgeType = asTrimmedString(edge.type);
  const type = edgeType ? edgeType as EdgeType : 'supports';

  if (!source || !target || (edgeType && !ALLOWED_EDGE_TYPES.has(type))) {
    return null;
  }

  return {
    source,
    target,
    type,
    confidence: asFiniteNumber(edge.confidence),
    evidenceChunkIds: normalizeStringArray(edge.evidenceChunkIds),
  };
}

function getRecentGraphContext(previousGraph?: MergedGraph): RecentGraphContext {
  const nodes = (previousGraph?.nodes ?? []).slice(-8).map((node) => ({
    id: node.id,
    type: node.type,
    text: node.text,
    timestampMs: node.timestampMs,
  }));
  const recentNodeIds = new Set(nodes.map((node) => node.id));
  const edges = (previousGraph?.edges ?? [])
    .filter(
      (edge) => recentNodeIds.has(edge.source) || recentNodeIds.has(edge.target),
    )
    .slice(-4)
    .map((edge) => ({
      source: edge.source,
      target: edge.target,
      type: edge.type,
    }));

  return {
    nodes,
    edges,
  };
}

function cleanTranscriptText(text: string) {
  return text
    .split('\n')
    .map((line) => line.replace(TENCENT_TRANSCRIPT_PREFIX, '').trim())
    .filter(Boolean)
    .join('\n');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asTrimmedString(value: unknown) {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function asFiniteNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function normalizeStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const normalized = value
    .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    .map((entry) => entry.trim());
  return normalized.length > 0 ? normalized : undefined;
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

function isRetriableProviderError(
  error: unknown,
  retryPolicy: { retryableStatusCodes: number[] },
) {
  if (isAbortError(error)) {
    return true;
  }

  if (typeof error === 'object' && error && 'status' in error) {
    const status = (error as ProviderRequestError).status;
    return typeof status === 'number' && retryPolicy.retryableStatusCodes.includes(status);
  }

  return error instanceof TypeError;
}

function isAbortError(error: unknown) {
  return (
    (error instanceof Error && error.name === 'AbortError') ||
    (typeof DOMException !== 'undefined' &&
      error instanceof DOMException &&
      error.name === 'AbortError')
  );
}
