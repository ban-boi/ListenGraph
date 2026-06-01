/**
 * structure-focused 测试的共享类型与工具函数。
 *
 * 从 structure-focused.real.test.ts 提取，供真实 structurer 测试复用。
 */

import * as fs from 'fs';
import * as path from 'path';
import type {
  EdgeType,
  MergedGraph,
  NodeType,
  ProviderConfig,
  SerializableProviderError,
  TranscriptChunk,
} from '@listen-graphic/schema';

// ─── 类型定义 ───

export type StructureFixture = {
  name: string;
  seed?: {
    transcriptWindow?: Array<
      Omit<TranscriptChunk, 'sessionId' | 'provider'> & { provider?: string }
    >;
    mergedGraph?: MergedGraph;
    currentTimeMs?: number;
    transcriptSequence?: number;
    chunkIndex?: number;
  };
  transcripts: Array<
    Omit<TranscriptChunk, 'sessionId' | 'provider'> & { provider?: string }
  >;
  acceptance: {
    minSegments: number;
    minMergedNodes: number;
    minMergedEdges: number;
    allowFallback: boolean;
    expectFallbackUsed?: boolean;
    disallowDuplicatePreviousTexts?: boolean;
    expectCrossGraphEdges?: boolean;
    mustContainTexts?: string[];
    mustContainOneOfTexts?: string[][];
    requiredEdgeTypes?: EdgeType[];
    maxMergedNodes?: number;
    maxFallbackRuns?: number;
    forbiddenTexts?: string[];
    mustHaveNodeTypes?: NodeType[];
    manualReviewTags?: string[];
  };
};

export type FetchTrace = {
  url: string;
  method: string;
  fixtureName?: string;
  fixtureAttempt?: number;
  callSequence?: number;
  callKey?: string;
  structurerMode?: 'bootstrap' | 'incremental' | string;
  latestChunkTranscript?: string;
  latestChunkRange?: {
    startMs: number;
    endMs: number;
  };
  status?: number;
  ok?: boolean;
  responseBody?: string;
  error?: string;
};

export type StructurerCallSummary = {
  fixtureName?: string;
  fixtureAttempt?: number;
  callSequence: number;
  mode: string;
  latestChunkTranscript: string;
  latestChunkRange?: {
    startMs: number;
    endMs: number;
  };
  requestCount: number;
  outcomes: string[];
  sawSuccess: boolean;
  sawAbort: boolean;
  finalOutcome: string;
};

export type FixtureRunContext = {
  fixtureName: string;
  fixtureAttempt: number;
  nextCallSequence: number;
  callSequenceByKey: Map<string, number>;
};

export type ExternalSkipResult = {
  skippedDueToExternalIssue: true;
  reason: string;
};

export type ExternalIssueMetadata = {
  kind: 'rate_limit' | 'timeout';
  endpoint: string;
  status?: number;
};

// ─── 错误类 ───

export class ExternalProviderIssueError extends Error {
  constructor(
    readonly metadata: ExternalIssueMetadata,
    readonly diagnostics: string,
    readonly runResponse: {
      success: boolean;
      error?: string;
      providerError?: SerializableProviderError;
    },
  ) {
    super(
      metadata.kind === 'timeout'
        ? `External structurer timeout at ${metadata.endpoint}`
        : `External structurer rate limit at ${metadata.endpoint}`,
    );
    this.name = 'ExternalProviderIssueError';
  }
}

// ─── 纯工具函数 ───

/** 从 RequestInit 中剥离 signal，避免与 harness 自身超时冲突 */
export function omitFetchSignal(init?: RequestInit): RequestInit | undefined {
  if (!init || !('signal' in init)) {
    return init;
  }

  const { signal: _signal, ...rest } = init;
  return rest;
}

/** 使用 harness 自身超时包装 fetch，不依赖 provider 的 signal */
export async function fetchWithHarnessTimeout(
  nativeFetch: typeof fetch,
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  effectiveStructurerTimeoutMs: number,
) {
  const timeoutMs =
    init?.signal && effectiveStructurerTimeoutMs > 0
      ? effectiveStructurerTimeoutMs
      : 0;
  const fetchPromise = nativeFetch(input, omitFetchSignal(init));
  if (!timeoutMs) {
    return fetchPromise;
  }

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      fetchPromise,
      new Promise<Response>((_, reject) => {
        timeoutId = setTimeout(() => {
          const error = new Error(`Harness fetch timed out after ${timeoutMs}ms`);
          error.name = 'AbortError';
          reject(error);
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

/** 输出 structurer 请求追踪日志 */
export function writeRealStructurerTrace(
  event: string,
  trace: FetchTrace,
  details: string[] = [],
  enabled: boolean,
) {
  if (!enabled) {
    return;
  }

  console.warn(
    [
      `[structure-real:${event}]`,
      `fixture=${trace.fixtureName ?? '<unknown>'}`,
      `attempt=${trace.fixtureAttempt ?? '<unknown>'}`,
      `call=${trace.callSequence ?? '<unknown>'}`,
      ...details,
    ].join(' '),
  );
}

/** 文本标准化，用于断言比较 */
export function normalizeText(value: string) {
  return value.trim().toLowerCase().replace(/[，。！？、,.!?\s]/g, '');
}

/** 汇总图谱信息用于断言消息 */
export function summarizeGraph(graph: MergedGraph | null) {
  if (!graph) {
    return { nodeCount: 0, edgeCount: 0, nodeTexts: [], edges: [] };
  }

  return {
    nodeCount: graph.nodes.length,
    edgeCount: graph.edges.length,
    nodeTexts: graph.nodes.map((node) => node.text),
    edges: graph.edges.map((edge) => ({
      source: edge.source,
      target: edge.target,
      type: edge.type,
    })),
  };
}

/** 从转写文本中提取时间范围 */
export function extractTranscriptRange(transcript: string) {
  const match = transcript.match(/^\[(\d+)-(\d+)\]/);
  if (!match) {
    return undefined;
  }

  return {
    startMs: Number.parseInt(match[1], 10),
    endMs: Number.parseInt(match[2], 10),
  };
}

/** 解析 structurer 请求体，提取模式和转写上下文 */
export function parseStructurerRequestBody(body: string) {
  try {
    const parsed = JSON.parse(body) as {
      messages?: Array<{ role?: string; content?: string }>;
    };
    const userMessage = parsed.messages?.find((message) => message.role === 'user')?.content;
    if (!userMessage) {
      return null;
    }
    const content = JSON.parse(userMessage) as {
      mode?: string;
      latestChunkTranscript?: string;
    };
    const latestChunkTranscript =
      typeof content.latestChunkTranscript === 'string' ? content.latestChunkTranscript : '';
    return {
      mode: typeof content.mode === 'string' ? content.mode : 'unknown',
      latestChunkTranscript,
      latestChunkRange: extractTranscriptRange(latestChunkTranscript),
    };
  } catch {
    return null;
  }
}

/** 将 trace 上下文（fixture 名称、调用序号等）附加到 FetchTrace */
export function attachStructurerTraceContext(
  trace: FetchTrace,
  requestBody: RequestInit['body'],
  currentFixtureRunContext: FixtureRunContext | null,
) {
  if (!currentFixtureRunContext || typeof requestBody !== 'string') {
    return;
  }

  const parsed = parseStructurerRequestBody(requestBody);
  if (!parsed) {
    return;
  }

  const key = `${parsed.mode}|${parsed.latestChunkTranscript}`;
  let callSequence = currentFixtureRunContext.callSequenceByKey.get(key);
  if (!callSequence) {
    callSequence = currentFixtureRunContext.nextCallSequence++;
    currentFixtureRunContext.callSequenceByKey.set(key, callSequence);
  }

  trace.fixtureName = currentFixtureRunContext.fixtureName;
  trace.fixtureAttempt = currentFixtureRunContext.fixtureAttempt;
  trace.callSequence = callSequence;
  trace.callKey = key;
  trace.structurerMode = parsed.mode;
  trace.latestChunkTranscript = parsed.latestChunkTranscript;
  trace.latestChunkRange = parsed.latestChunkRange;
}

/** 按 fixture+attempt 分组汇总 structurer 调用 */
export function summarizeStructurerCalls(traces: FetchTrace[]): StructurerCallSummary[] {
  const grouped = new Map<string, StructurerCallSummary>();

  for (const trace of traces) {
    if (!trace.callSequence) {
      continue;
    }

    const key = `${trace.fixtureAttempt ?? 0}:${trace.callSequence}`;
    const current = grouped.get(key) ?? {
      fixtureName: trace.fixtureName,
      fixtureAttempt: trace.fixtureAttempt,
      callSequence: trace.callSequence,
      mode: trace.structurerMode ?? 'unknown',
      latestChunkTranscript: trace.latestChunkTranscript ?? '',
      latestChunkRange: trace.latestChunkRange,
      requestCount: 0,
      outcomes: [],
      sawSuccess: false,
      sawAbort: false,
      finalOutcome: 'unknown',
    };

    current.requestCount += 1;
    if (trace.status === 429) {
      current.outcomes.push('rate_limit:429');
    } else if (trace.ok) {
      current.outcomes.push(`success:${trace.status}`);
      current.sawSuccess = true;
    } else if (trace.status) {
      current.outcomes.push(`http:${trace.status}`);
    }

    if (trace.error) {
      current.outcomes.push(
        trace.error.includes('AbortError') ? 'timeout:abort' : `error:${trace.error}`,
      );
      if (trace.error.includes('AbortError')) {
        current.sawAbort = true;
      }
    }

    current.finalOutcome =
      trace.error?.includes('AbortError')
        ? 'timeout'
        : trace.status === 429
          ? 'rate_limit'
          : trace.ok
            ? `success:${trace.status}`
            : trace.status
              ? `http:${trace.status}`
              : trace.error
                ? `error:${trace.error}`
                : current.finalOutcome;
    grouped.set(key, current);
  }

  return [...grouped.values()].sort(
    (left, right) =>
      (left.fixtureAttempt ?? 0) - (right.fixtureAttempt ?? 0) ||
      left.callSequence - right.callSequence,
  );
}

/** 将 fixture 运行诊断信息写入文件 */
export function writeFixtureDiagnostics(params: {
  fixtureName: string;
  fixtureAttempt: number;
  runResponse: {
    success: boolean;
    error?: string;
    providerError?: SerializableProviderError;
  };
  fetchTraces: FetchTrace[];
  diagnosticArtifactDir: string | undefined;
}) {
  if (!params.diagnosticArtifactDir) {
    return;
  }

  fs.mkdirSync(params.diagnosticArtifactDir, { recursive: true });
  const outputPath = path.join(
    params.diagnosticArtifactDir,
    `${params.fixtureName}.attempt-${params.fixtureAttempt}.diagnostic.json`,
  );
  fs.writeFileSync(
    outputPath,
    `${JSON.stringify(
      {
        fixtureName: params.fixtureName,
        fixtureAttempt: params.fixtureAttempt,
        recordedAt: new Date().toISOString(),
        runResponse: params.runResponse,
        callSummaries: summarizeStructurerCalls(params.fetchTraces),
        fetchTraces: params.fetchTraces,
      },
      null,
      2,
    )}\n`,
  );
}

/** 加载并过滤 fixture 列表 */
export function loadFixtures(params: {
  fixtureDir: string;
  structureProfile: string;
  requestedFixtureFilter: string | undefined;
  replayFixturePrefix: string;
  smokeFixtureNames: Set<string>;
}) {
  let fixtures = fs
    .readdirSync(params.fixtureDir)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => {
      const raw = fs.readFileSync(path.join(params.fixtureDir, name), 'utf-8');
      return JSON.parse(raw) as StructureFixture;
    });

  if (params.structureProfile === 'smoke') {
    fixtures = fixtures.filter(
      (fixture) =>
        !fixture.name.startsWith(params.replayFixturePrefix) &&
        params.smokeFixtureNames.has(fixture.name),
    );
  } else if (params.structureProfile === 'replay') {
    fixtures = fixtures.filter((fixture) =>
      fixture.name.startsWith(params.replayFixturePrefix),
    );
  } else if (params.structureProfile !== 'full') {
    throw new Error(
      `Unsupported LISTEN_GRAPHIC_E2E_STRUCTURE_PROFILE=${params.structureProfile}. Expected smoke, full, or replay.`,
    );
  } else {
    fixtures = fixtures.filter(
      (fixture) => !fixture.name.startsWith(params.replayFixturePrefix),
    );
  }

  if (!params.requestedFixtureFilter) {
    return fixtures;
  }

  const requestedNames = params.requestedFixtureFilter
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  const filtered = fixtures.filter((fixture) =>
    requestedNames.some((name) => fixture.name.toLowerCase().includes(name)),
  );
  if (filtered.length === 0) {
    throw new Error(
      `No structure fixtures matched LISTEN_GRAPHIC_E2E_STRUCTURE_FIXTURE=${params.requestedFixtureFilter}`,
    );
  }

  return filtered;
}

/** 检测外部 provider 问题（限流/超时） */
export function getExternalIssueMetadata(
  runResponse: {
    success: boolean;
    error?: string;
    providerError?: SerializableProviderError;
  },
  fetchTraces: FetchTrace[],
  structurerEndpoint: string | undefined,
): ExternalIssueMetadata | null {
  if (runResponse.success) {
    return null;
  }

  const providerError = runResponse.providerError;
  const matchedTrace = fetchTraces.find((trace) => trace.status === 429);
  const traceBody = matchedTrace?.responseBody ?? '';
  const timedOutTraceCount = fetchTraces.filter((trace) =>
    trace.error?.includes('AbortError'),
  ).length;
  const lastTraceWithUrl = [...fetchTraces].reverse().find((trace) => trace.url);
  const isKnownRateLimit =
    providerError?.code === 'RATE_LIMIT_ERROR' ||
    providerError?.status === 429 ||
    matchedTrace?.status === 429 ||
    traceBody.includes('"code":"1302"');
  const isKnownTimeout =
    providerError?.code === 'TIMEOUT_ERROR' || timedOutTraceCount > 0;

  if (isKnownRateLimit) {
    return {
      kind: 'rate_limit',
      endpoint: matchedTrace?.url ?? structurerEndpoint ?? '<unknown>',
      status: providerError?.status ?? matchedTrace?.status ?? 429,
    };
  }

  if (isKnownTimeout) {
    return {
      kind: 'timeout',
      endpoint:
        lastTraceWithUrl?.url ?? matchedTrace?.url ?? structurerEndpoint ?? '<unknown>',
    };
  }

  return null;
}

/** 根据 external issue 类型生成 skip result */
export function getExternalSkipResult(
  fixture: StructureFixture,
  runResponse: {
    success: boolean;
    error?: string;
    providerError?: SerializableProviderError;
  },
  params: {
    allowExternalIssueSkip: boolean;
    effectiveRateLimitCooldownMs: number;
    effectiveTimeoutCooldownMs: number;
    effectiveStructurerTimeoutMs: number;
    structurerEndpoint: string | undefined;
    structurerType: string;
  },
  fetchTraces: FetchTrace[],
): ExternalSkipResult | null {
  const externalIssue = getExternalIssueMetadata(
    runResponse,
    fetchTraces,
    params.structurerEndpoint,
  );
  if (!externalIssue) {
    return null;
  }

  if (externalIssue.kind === 'rate_limit' && params.allowExternalIssueSkip) {
    return {
      skippedDueToExternalIssue: true,
      reason: [
        `${fixture.name} hit a known external structurer rate limit and was skipped.`,
        `provider=${runResponse.providerError?.provider ?? params.structurerType}`,
        `status=${externalIssue.status ?? 429}`,
        `endpoint=${externalIssue.endpoint}`,
        `recommended_wait_ms=${params.effectiveRateLimitCooldownMs}`,
        `Unset LISTEN_GRAPHIC_E2E_STRUCTURE_ALLOW_EXTERNAL_SKIP to treat this as a hard failure.`,
      ].join(' '),
    };
  }

  if (externalIssue.kind === 'timeout' && params.allowExternalIssueSkip) {
    return {
      skippedDueToExternalIssue: true,
      reason: [
        `${fixture.name} hit a known external structurer timeout and was skipped.`,
        `provider=${runResponse.providerError?.provider ?? params.structurerType}`,
        `timeout_ms=${params.effectiveStructurerTimeoutMs}`,
        `endpoint=${externalIssue.endpoint}`,
        `recommended_wait_ms=${params.effectiveTimeoutCooldownMs}`,
        `Unset LISTEN_GRAPHIC_E2E_STRUCTURE_ALLOW_EXTERNAL_SKIP to treat this as a hard failure.`,
      ].join(' '),
    };
  }

  return null;
}

/** Fixture 断言验收检查 */
export function assertFixtureAcceptance(params: {
  fixture: StructureFixture;
  debugData: {
    segments: unknown[];
    transcripts: TranscriptChunk[];
    graph: MergedGraph | null;
    structurerRuns?: Array<{ fallbackUsed?: boolean }>;
  };
  exportData: {
    transcripts: TranscriptChunk[];
    graph: MergedGraph;
  };
  previousGraph: MergedGraph | null;
}) {
  const { fixture, debugData, exportData, previousGraph } = params;
  const acceptance = fixture.acceptance;
  const lastSegment = debugData.segments.at(-1);
  const lastStructurerRun = debugData.structurerRuns?.at(-1);
  const graphSummary = summarizeGraph(debugData.graph);

  expect(
    debugData.segments.length,
    `${fixture.name} minSegments graph=${JSON.stringify(graphSummary)}`,
  ).toBeGreaterThanOrEqual(acceptance.minSegments);
  expect(
    debugData.graph?.nodes.length ?? 0,
    `${fixture.name} minMergedNodes graph=${JSON.stringify(graphSummary)}`,
  ).toBeGreaterThanOrEqual(acceptance.minMergedNodes);
  if (acceptance.maxMergedNodes !== undefined) {
    expect(
      debugData.graph?.nodes.length ?? 0,
      `${fixture.name} maxMergedNodes graph=${JSON.stringify(graphSummary)}`,
    ).toBeLessThanOrEqual(acceptance.maxMergedNodes);
  }
  expect(
    debugData.graph?.edges.length ?? 0,
    `${fixture.name} minMergedEdges graph=${JSON.stringify(graphSummary)}`,
  ).toBeGreaterThanOrEqual(acceptance.minMergedEdges);
  expect(
    exportData.transcripts.length,
    `${fixture.name} exported transcripts`,
  ).toBeGreaterThanOrEqual(fixture.transcripts.length);

  const fallbackUsed = Boolean(lastStructurerRun?.fallbackUsed);
  if (!acceptance.allowFallback) {
    expect(fallbackUsed, `${fixture.name} should not fallback`).toBe(false);
  }
  if (acceptance.expectFallbackUsed !== undefined) {
    expect(fallbackUsed, `${fixture.name} fallback expectation`).toBe(
      acceptance.expectFallbackUsed,
    );
  }
  if (acceptance.maxFallbackRuns !== undefined) {
    const fallbackRunCount =
      debugData.structurerRuns?.filter((run) => run.fallbackUsed).length ?? 0;
    expect(fallbackRunCount, `${fixture.name} maxFallbackRuns`).toBeLessThanOrEqual(
      acceptance.maxFallbackRuns,
    );
  }

  if (acceptance.disallowDuplicatePreviousTexts && previousGraph && lastSegment) {
    const previousTexts = new Set(previousGraph.nodes.map((node) => normalizeText(node.text)));
    const duplicatedTexts = (lastSegment as { nodes: Array<{ text: string }> })
      .nodes.map((node) => normalizeText(node.text))
      .filter((text) => previousTexts.has(text));
    expect(
      duplicatedTexts,
      `${fixture.name} should avoid duplicating previous node text graph=${JSON.stringify(graphSummary)}`,
    ).toEqual([]);
  }

  if (acceptance.expectCrossGraphEdges && previousGraph && lastSegment) {
    const previousNodeIds = new Set(previousGraph.nodes.map((node) => node.id));
    const lastSegmentNodeIds = new Set(
      (lastSegment as { nodes: Array<{ id: string }> }).nodes.map((node) => node.id),
    );
    const mergedEdges = debugData.graph?.edges ?? [];
    const hasCrossGraphEdge = mergedEdges.some(
      (edge: { source: string; target: string }) =>
        (previousNodeIds.has(edge.source) && lastSegmentNodeIds.has(edge.target)) ||
        (previousNodeIds.has(edge.target) && lastSegmentNodeIds.has(edge.source)),
    );
    expect(
      hasCrossGraphEdge,
      `${fixture.name} should contain a cross-graph edge graph=${JSON.stringify(graphSummary)}`,
    ).toBe(true);
  }

  if (acceptance.mustContainTexts?.length) {
    const normalizedNodeTexts = (debugData.graph?.nodes ?? []).map((node) =>
      normalizeText(node.text),
    );
    for (const expectedText of acceptance.mustContainTexts) {
      const normalizedExpected = normalizeText(expectedText);
      const matched = normalizedNodeTexts.some(
        (nodeText) =>
          nodeText.includes(normalizedExpected) ||
          normalizedExpected.includes(nodeText),
      );
      expect(
        matched,
        `${fixture.name} should contain text "${expectedText}" graph=${JSON.stringify(graphSummary)}`,
      ).toBe(true);
    }
  }

  if (acceptance.mustContainOneOfTexts?.length) {
    const normalizedNodeTexts = (debugData.graph?.nodes ?? []).map((node) =>
      normalizeText(node.text),
    );
    for (const candidateGroup of acceptance.mustContainOneOfTexts) {
      const matched = candidateGroup.some((candidateText) => {
        const normalizedExpected = normalizeText(candidateText);
        return normalizedNodeTexts.some(
          (nodeText) =>
            nodeText.includes(normalizedExpected) ||
            normalizedExpected.includes(nodeText),
        );
      });
      expect(
        matched,
        `${fixture.name} should contain one of ${JSON.stringify(candidateGroup)} graph=${JSON.stringify(graphSummary)}`,
      ).toBe(true);
    }
  }

  if (acceptance.forbiddenTexts?.length) {
    const normalizedNodeTexts = (debugData.graph?.nodes ?? []).map((node) =>
      normalizeText(node.text),
    );
    for (const forbiddenText of acceptance.forbiddenTexts) {
      const normalizedForbidden = normalizeText(forbiddenText);
      const matched = normalizedNodeTexts.some((nodeText) =>
        nodeText.includes(normalizedForbidden),
      );
      expect(
        matched,
        `${fixture.name} should not contain text "${forbiddenText}" graph=${JSON.stringify(graphSummary)}`,
      ).toBe(false);
    }
  }

  if (acceptance.mustHaveNodeTypes?.length) {
    const nodeTypes = new Set((debugData.graph?.nodes ?? []).map((node) => node.type));
    for (const nodeType of acceptance.mustHaveNodeTypes) {
      expect(
        nodeTypes.has(nodeType),
        `${fixture.name} should contain node type "${nodeType}" graph=${JSON.stringify(graphSummary)}`,
      ).toBe(true);
    }
  }

  if (acceptance.requiredEdgeTypes?.length) {
    const edgeTypes = new Set((debugData.graph?.edges ?? []).map((edge) => edge.type));
    for (const edgeType of acceptance.requiredEdgeTypes) {
      expect(
        edgeTypes.has(edgeType),
        `${fixture.name} should contain edge type "${edgeType}" graph=${JSON.stringify(graphSummary)}`,
      ).toBe(true);
    }
  }
}
