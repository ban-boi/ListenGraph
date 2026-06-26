/**
 * structure-focused 测试的共享类型与工具函数。
 *
 * 从 structure-focused.real.test.ts 提取，供真实 structurer 测试复用。
 */

/** 节点数容差：仅对 judge 草稿落地的 fixture（acceptance.promotedFrom）生效。
 * 同模型两次跑 structurer 节点数有 ±1-2 浮动，容差吸收这个波动，避免误红。
 * 人工精校的 realtime fixture 不受影响（保持硬标准）。 */
const NODE_COUNT_TOLERANCE = 2;

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
    /** judge 草稿落地标记：存在表示该 acceptance 由 LLM judge 生成（非人工精校）。
     *  存在时节点数断言享受 NODE_COUNT_TOLERANCE 容差。 */
    promotedFrom?: string;
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

/**
 * 锚点拆分：把误用分隔符合并的候选还原成多个独立子锚点。
 *
 * 背景：LLM draft 偶尔会把多个概念合并成一个候选（如 "幽默应对/自我解嘲"、
 * "辩论目的，自我挑战"），这违反了「短词」格式约定，直接双向子串匹配必挂。
 * 这里按常见分隔符拆开，过滤掉过短的无意义 token（单字如「和」「的」），
 * 保留有意义的子锚点分别参与匹配。
 *
 * 边界：只做分隔符拆分 + 长度过滤，不做语义放宽（不引入同义词、不做相似度）。
 * 若拆分后只剩原始候选（无分隔符），则原样返回，行为与改动前完全一致。
 */
export function splitAnchor(normalizedCandidate: string): string[] {
  // 按常见分隔符拆分：斜杠、竖线、逗号、分号、顿号、空格、中文标点
  const parts = normalizedCandidate.split(/[\/｜|，,；;、\s]+/).filter(Boolean);
  // 过滤掉过短 token（< 2 字符），避免「的」「和」等无意义词产生误匹配
  const meaningful = parts.filter((p) => p.length >= 2);
  // 若过滤后为空（如候选本身是单字），回退到原始候选，保持原有行为
  if (meaningful.length === 0) return [normalizedCandidate];
  // 含分隔符时返回拆分结果；无分隔符时（parts.length === 1）原样返回
  return parts.length > 1 ? meaningful : [normalizedCandidate];
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

/** Fixture 断言参数类型 */
export type FixtureAssertionParams = {
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
};

/**
 * 第 1 层：确定性契约断言（模型无关，进 CI 硬门）。
 *
 * 只校验「不依赖参考模型分布就能确定」的工程契约：
 * - minSegments（输入有几个 transcript，纯确定性）
 * - exported transcripts 数量（导出不丢）
 * - fallback 行为（allowFallback / expectFallbackUsed / maxFallbackRuns）
 *
 * 这些断言崩了 = 代码坏了（schema、流程、稳定性问题），必须立刻修、必须阻塞发布。
 * 注意：节点/边数阈值、文本/类型/边类型语义断言不在这一层——它们依赖参考模型分布，
 * 见 assertFixtureQuality。
 */
export function assertFixtureContract(params: FixtureAssertionParams) {
  const { fixture, debugData, exportData } = params;
  const acceptance = fixture.acceptance;
  const lastStructurerRun = debugData.structurerRuns?.at(-1);
  const graphSummary = summarizeGraph(debugData.graph);

  expect(
    debugData.segments.length,
    `${fixture.name} minSegments graph=${JSON.stringify(graphSummary)}`,
  ).toBeGreaterThanOrEqual(acceptance.minSegments);

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
}

/**
 * 第 3 层：质量断言（模型特异，不阻塞发布）。
 *
 * 校验依赖参考模型分布的语义/数值断言：
 * - 节点/边数阈值（含 judge 草稿容差）
 * - 文本锚点（mustContain / mustContainOneOf，含 splitAnchor 拆分）
 * - 禁词、节点类型、边类型、跨图边、重复文本
 *
 * 这些断言崩了 ≠ 代码坏了，更可能是「当前模型分布与参考模型不同」。
 * 因此默认 soft：失败只 warn 不 throw（LISTEN_GRAPHIC_STRUCTURE_QUALITY_SOFT=1，默认开）。
 * 深度排查时可设 SOFT=0 让它 hard（失败阻塞）。
 */
export function assertFixtureQuality(params: FixtureAssertionParams) {
  const { fixture, debugData, previousGraph } = params;
  const acceptance = fixture.acceptance;
  const lastSegment = debugData.segments.at(-1);
  const graphSummary = summarizeGraph(debugData.graph);

  // soft 模式：quality 断言失败时 warn 而非 throw。
  // 默认开——因为 quality 红多为模型分布差异，不该阻塞 CI。
  // 设 LISTEN_GRAPHIC_STRUCTURE_QUALITY_SOFT=0 可恢复 hard（用于深度排查）。
  const soft = process.env.LISTEN_GRAPHIC_STRUCTURE_QUALITY_SOFT?.trim() !== '0';
  // 收集本 fixture 的 quality 失败，soft 模式下一次性 warn
  const failures: string[] = [];
  const softExpect = <T>(actual: T, message: string, matcher: (a: T) => void) => {
    try {
      matcher(actual);
    } catch (err) {
      if (soft) {
        failures.push(`${message}\n  ${(err as Error).message}`);
      } else {
        throw err;
      }
    }
  };

  // 节点数容差：仅对 judge 草稿落地的 fixture（带 promotedFrom）生效。
  const isAiDraft = Boolean(acceptance.promotedFrom);
  const nodeTol = isAiDraft ? NODE_COUNT_TOLERANCE : 0;
  const effectiveMinNodes = acceptance.minMergedNodes - nodeTol;
  const effectiveMaxNodes =
    acceptance.maxMergedNodes !== undefined ? acceptance.maxMergedNodes + nodeTol : undefined;

  softExpect(
    debugData.graph?.nodes.length ?? 0,
    `${fixture.name} minMergedNodes (draft ${acceptance.minMergedNodes}, tol -${nodeTol} → ${effectiveMinNodes})`,
    (n) =>
      expect(n, `${fixture.name} minMergedNodes graph=${JSON.stringify(graphSummary)}`).toBeGreaterThanOrEqual(effectiveMinNodes),
  );
  if (effectiveMaxNodes !== undefined) {
    softExpect(
      debugData.graph?.nodes.length ?? 0,
      `${fixture.name} maxMergedNodes (draft ${acceptance.maxMergedNodes}, tol +${nodeTol} → ${effectiveMaxNodes})`,
      (n) =>
        expect(n, `${fixture.name} maxMergedNodes graph=${JSON.stringify(graphSummary)}`).toBeLessThanOrEqual(effectiveMaxNodes),
    );
  }
  softExpect(
    debugData.graph?.edges.length ?? 0,
    `${fixture.name} minMergedEdges`,
    (e) =>
      expect(e, `${fixture.name} minMergedEdges graph=${JSON.stringify(graphSummary)}`).toBeGreaterThanOrEqual(acceptance.minMergedEdges),
  );

  if (acceptance.disallowDuplicatePreviousTexts && previousGraph && lastSegment) {
    const previousTexts = new Set(previousGraph.nodes.map((node) => normalizeText(node.text)));
    const duplicatedTexts = (lastSegment as { nodes: Array<{ text: string }> })
      .nodes.map((node) => normalizeText(node.text))
      .filter((text) => previousTexts.has(text));
    softExpect(
      duplicatedTexts,
      `${fixture.name} disallowDuplicatePreviousTexts`,
      (d) =>
        expect(d, `${fixture.name} should avoid duplicating previous node text graph=${JSON.stringify(graphSummary)}`).toEqual([]),
    );
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
    softExpect(
      hasCrossGraphEdge,
      `${fixture.name} expectCrossGraphEdges`,
      (h) =>
        expect(h, `${fixture.name} should contain a cross-graph edge graph=${JSON.stringify(graphSummary)}`).toBe(true),
    );
  }

  const normalizedNodeTexts = (debugData.graph?.nodes ?? []).map((node) =>
    normalizeText(node.text),
  );

  if (acceptance.mustContainTexts?.length) {
    for (const expectedText of acceptance.mustContainTexts) {
      const normalizedExpected = normalizeText(expectedText);
      const matched = normalizedNodeTexts.some(
        (nodeText) => nodeText.includes(normalizedExpected) || normalizedExpected.includes(nodeText),
      );
      softExpect(
        matched,
        `${fixture.name} mustContainTexts "${expectedText}"`,
        (m) =>
          expect(m, `${fixture.name} should contain text "${expectedText}" graph=${JSON.stringify(graphSummary)}`).toBe(true),
      );
    }
  }

  if (acceptance.mustContainOneOfTexts?.length) {
    for (const candidateGroup of acceptance.mustContainOneOfTexts) {
      const subAnchorsPerCandidate = candidateGroup.map((candidateText) =>
        splitAnchor(normalizeText(candidateText)),
      );
      const matched = subAnchorsPerCandidate.some((subAnchors) =>
        subAnchors.some((normalizedExpected) =>
          normalizedNodeTexts.some(
            (nodeText) => nodeText.includes(normalizedExpected) || normalizedExpected.includes(nodeText),
          ),
        ),
      );
      softExpect(
        matched,
        `${fixture.name} mustContainOneOfTexts ${JSON.stringify(candidateGroup)}`,
        (m) =>
          expect(m, `${fixture.name} should contain one of ${JSON.stringify(candidateGroup)} graph=${JSON.stringify(graphSummary)}`).toBe(true),
      );
    }
  }

  if (acceptance.forbiddenTexts?.length) {
    for (const forbiddenText of acceptance.forbiddenTexts) {
      const normalizedForbidden = normalizeText(forbiddenText);
      const matched = normalizedNodeTexts.some((nodeText) =>
        nodeText.includes(normalizedForbidden),
      );
      softExpect(
        matched,
        `${fixture.name} forbiddenTexts "${forbiddenText}"`,
        (m) =>
          expect(m, `${fixture.name} should not contain text "${forbiddenText}" graph=${JSON.stringify(graphSummary)}`).toBe(false),
      );
    }
  }

  if (acceptance.mustHaveNodeTypes?.length) {
    const nodeTypes = new Set((debugData.graph?.nodes ?? []).map((node) => node.type));
    for (const nodeType of acceptance.mustHaveNodeTypes) {
      softExpect(
        nodeTypes.has(nodeType),
        `${fixture.name} mustHaveNodeTypes "${nodeType}"`,
        (has) =>
          expect(has, `${fixture.name} should contain node type "${nodeType}" graph=${JSON.stringify(graphSummary)}`).toBe(true),
      );
    }
  }

  if (acceptance.requiredEdgeTypes?.length) {
    const edgeTypes = new Set((debugData.graph?.edges ?? []).map((edge) => edge.type));
    for (const edgeType of acceptance.requiredEdgeTypes) {
      softExpect(
        edgeTypes.has(edgeType),
        `${fixture.name} requiredEdgeTypes "${edgeType}"`,
        (has) =>
          expect(has, `${fixture.name} should contain edge type "${edgeType}" graph=${JSON.stringify(graphSummary)}`).toBe(true),
      );
    }
  }

  // soft 模式下，汇总 warn 所有 quality 失败（不阻塞）
  if (failures.length > 0) {
    const tag = soft ? '[quality-soft]' : '[quality-hard]';
    console.warn(
      `\n${tag} ${fixture.name} 有 ${failures.length} 个质量断言未通过（不阻塞 CI）：\n` +
        failures.map((f) => `  - ${f}`).join('\n'),
    );
  }
}

/**
 * 兼容入口：依次执行 contract（硬）+ quality（默认 soft）。
 * 保留旧名以避免破坏现有调用点；新代码应直接调用 assertFixtureContract / assertFixtureQuality。
 */
export function assertFixtureAcceptance(params: FixtureAssertionParams) {
  assertFixtureContract(params);
  assertFixtureQuality(params);
}

/** 将 MergedGraph 精简为 LLM judge 友好的 compact 格式并写入 JSON 文件 */
export function writeCompactGraphArtifact(
  fixtureName: string,
  mergedGraph: MergedGraph | null,
  assemblerEnabled: boolean,
): void {
  const mode = assemblerEnabled ? 'with-assembler' : 'no-assembler';
  const artifactDir = path.resolve(__dirname, 'fixtures/structure/artifacts/segments/graphs');
  fs.mkdirSync(artifactDir, { recursive: true });

  const nodes = mergedGraph?.nodes ?? [];
  const edges = mergedGraph?.edges ?? [];

  // 构建 id → text 查找表
  const nodeTextById = new Map<string, string>();
  for (const node of nodes) {
    nodeTextById.set(node.id, node.text);
  }

  const compact = {
    fixtureName,
    assemblerEnabled,
    nodes: nodes.map((node) => ({
      id: node.id,
      type: node.type,
      text: node.text,
    })),
    edges: edges.map((edge) => ({
      sourceText: nodeTextById.get(edge.source) ?? edge.source,
      targetText: nodeTextById.get(edge.target) ?? edge.target,
      type: edge.type,
      confidence: edge.confidence,
    })),
    stats: {
      nodeCount: nodes.length,
      edgeCount: edges.length,
    },
  };

  const outputPath = path.join(artifactDir, `${fixtureName}.${mode}.compact-graph.json`);
  fs.writeFileSync(outputPath, `${JSON.stringify(compact, null, 2)}\n`);
}
