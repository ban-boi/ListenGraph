import { beforeEach, describe, expect, test, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import type {
  EdgeType,
  MergedGraph,
  ProviderConfig,
  SerializableProviderError,
  TranscriptChunk,
} from '@listen-graphic/schema';

type StructureFixture = {
  name: string;
  seed?: {
    transcriptWindow?: Array<Omit<TranscriptChunk, 'sessionId' | 'provider'> & { provider?: string }>;
    mergedGraph?: MergedGraph;
    currentTimeMs?: number;
    chunkIndex?: number;
  };
  transcripts: Array<Omit<TranscriptChunk, 'sessionId' | 'provider'> & { provider?: string }>;
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
  };
};

const FIXTURE_DIR = path.resolve(__dirname, './fixtures/structure');
const realStructurerType = process.env.LISTEN_GRAPHIC_E2E_STRUCTURER_TYPE?.trim();
const realStructurerKey = process.env.LISTEN_GRAPHIC_E2E_STRUCTURER_API_KEY?.trim();
const requestedFixtureFilter = process.env.LISTEN_GRAPHIC_E2E_STRUCTURE_FIXTURE
  ?.trim()
  .toLowerCase();
const allowExternalIssueSkip =
  process.env.LISTEN_GRAPHIC_E2E_STRUCTURE_ALLOW_EXTERNAL_SKIP?.trim() === '1';
const structurerTimeoutMs = Number.parseInt(
  process.env.LISTEN_GRAPHIC_E2E_STRUCTURER_TIMEOUT_MS?.trim() || '',
  10,
);
const effectiveStructurerTimeoutMs = Number.isFinite(structurerTimeoutMs)
  ? structurerTimeoutMs
  : 180_000;
const fixtureDelayMs = Number.parseInt(
  process.env.LISTEN_GRAPHIC_E2E_STRUCTURE_DELAY_MS?.trim() || '',
  10,
);
const effectiveFixtureDelayMs = Number.isFinite(fixtureDelayMs) ? fixtureDelayMs : 20_000;
const canRunRealStructurer =
  Boolean(realStructurerType) &&
  (realStructurerType === 'zhipu' ? Boolean(realStructurerKey) : Boolean(realStructurerKey));
const describeReal = canRunRealStructurer ? describe : describe.skip;

type FetchTrace = {
  url: string;
  method: string;
  status?: number;
  ok?: boolean;
  responseBody?: string;
  error?: string;
};

type ExternalSkipResult = {
  skippedDueToExternalIssue: true;
  reason: string;
};

describeReal('Structure-focused real structurer', () => {
  let messageListeners: Array<
    (message: any, sender: any, sendResponse: (response: any) => void) => boolean | void
  > = [];
  let dispatchMessage: (message: any, sender?: { tab?: { id: number } }) => Promise<any>;
  let storageState: Record<string, unknown> = {};
  let sessionRecords = new Map<string, any>();
  let transcriptRecords = new Map<string, any[]>();
  let segmentRecords = new Map<string, any[]>();
  let mergedGraphRecords = new Map<string, any>();
  let savedProviderConfig: ProviderConfig;
  let fetchTraces: FetchTrace[] = [];

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.useRealTimers();

    messageListeners = [];
    storageState = {};
    sessionRecords = new Map();
    transcriptRecords = new Map();
    segmentRecords = new Map();
    mergedGraphRecords = new Map();
    savedProviderConfig = createRealStructurerConfig();
    fetchTraces = [];

    await initializeModule();
  });

  async function initializeModule() {
    const chromeMock = (globalThis as any).chrome;
    messageListeners = [];
    const nativeFetch = globalThis.fetch?.bind(globalThis);

    if (!nativeFetch) {
      throw new Error('Current test environment does not provide fetch');
    }

    vi.doMock('@listen-graphic/storage', () => ({
      createSessionRepository: () => ({
        save: vi.fn(async (session: any) => {
          sessionRecords.set(session.sessionId, session);
        }),
        get: vi.fn(async (sessionId: string) => sessionRecords.get(sessionId)),
        listRecent: vi.fn(async () => Array.from(sessionRecords.values())),
        markEnded: vi.fn(async (sessionId: string, endedAt: number) => {
          const current = sessionRecords.get(sessionId);
          if (!current) {
            return;
          }
          sessionRecords.set(sessionId, { ...current, endedAt });
        }),
      }),
      createTranscriptChunkRepository: () => ({
        append: vi.fn(async (chunk: any) => {
          const current = transcriptRecords.get(chunk.sessionId) ?? [];
          transcriptRecords.set(chunk.sessionId, [...current, chunk]);
        }),
        listBySession: vi.fn(async (sessionId: string) => transcriptRecords.get(sessionId) ?? []),
      }),
      createSegmentGraphRepository: () => ({
        append: vi.fn(async (segment: any) => {
          const current = segmentRecords.get(segment.sessionId) ?? [];
          segmentRecords.set(segment.sessionId, [...current, segment]);
        }),
        listBySession: vi.fn(async (sessionId: string) => segmentRecords.get(sessionId) ?? []),
      }),
      createMergedGraphRepository: () => ({
        save: vi.fn(async (graph: any) => {
          mergedGraphRecords.set(graph.sessionId, graph);
        }),
        getBySession: vi.fn(async (sessionId: string) => mergedGraphRecords.get(sessionId)),
      }),
      createSettingsRepository: () => ({
        getProviderConfig: vi.fn(async () => savedProviderConfig),
        saveProviderConfig: vi.fn(async (config: ProviderConfig) => {
          savedProviderConfig = config;
        }),
        clearProviderSecrets: vi.fn(async () => {
          savedProviderConfig = {
            ...savedProviderConfig,
            structurer: {
              ...savedProviderConfig.structurer,
              apiKey: undefined,
              sessionToken: undefined,
            },
          };
        }),
      }),
      db: {
        sessions: {},
        transcriptChunks: {},
        segmentGraphs: {},
        mergedGraphs: {},
        settings: {},
      },
    }));

    chromeMock.storage.session.get.mockImplementation((key: string) =>
      Promise.resolve({ [key]: storageState[key] }),
    );
    chromeMock.storage.session.set.mockImplementation((value: Record<string, unknown>) => {
      storageState = { ...storageState, ...value };
      return Promise.resolve();
    });
    chromeMock.storage.session.remove.mockImplementation((key: string) => {
      delete storageState[key];
      return Promise.resolve();
    });

    chromeMock.runtime.onMessage.addListener.mockImplementation((listener: any) => {
      messageListeners.push(listener);
    });
    chromeMock.runtime.sendMessage.mockImplementation(
      (message: any, callback?: (response: any) => void) => {
        const sendResponse = (response: any) => {
          callback?.(response);
        };

        for (const listener of messageListeners) {
          const result = listener(message, { tab: { id: 1 } }, sendResponse);
          if (result === true) {
            return Promise.resolve({ success: true });
          }
        }

        return Promise.resolve({ success: true });
      },
    );

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const trace: FetchTrace = {
          url:
            typeof input === 'string'
              ? input
              : input instanceof URL
                ? input.toString()
                : input.url,
          method:
            init?.method ??
            (typeof input === 'string' || input instanceof URL ? 'GET' : input.method || 'GET'),
        };
        fetchTraces.push(trace);

        try {
          const response = await nativeFetch(input, init);
          trace.status = response.status;
          trace.ok = response.ok;
          try {
            trace.responseBody = (await response.clone().text()).slice(0, 800);
          } catch (error) {
            trace.responseBody =
              error instanceof Error ? `<failed to read body: ${error.message}>` : '<failed to read body>';
          }
          return response;
        } catch (error) {
          trace.error = error instanceof Error ? error.message : String(error);
          throw error;
        }
      }),
    );

    await import('./index');

    dispatchMessage = (message, sender = { tab: { id: 1 } }) =>
      new Promise((resolve) => {
        const listener = messageListeners[0];
        listener(message, sender, resolve);
      });
  }

  function createRealStructurerConfig(): ProviderConfig {
    return {
      asr: {
        type: 'mock',
        mode: 'direct',
        model: 'mock-asr',
        language: process.env.LISTEN_GRAPHIC_E2E_ASR_LANGUAGE?.trim() || 'zh',
      },
      structurer: {
        type: (realStructurerType as ProviderConfig['structurer']['type']) || 'openai',
        mode: 'direct',
        endpoint: process.env.LISTEN_GRAPHIC_E2E_STRUCTURER_ENDPOINT?.trim() || undefined,
        apiKey: realStructurerKey || undefined,
        model: process.env.LISTEN_GRAPHIC_E2E_STRUCTURER_MODEL?.trim() || undefined,
        language: process.env.LISTEN_GRAPHIC_E2E_STRUCTURER_LANGUAGE?.trim() || 'zh',
        retry: {
          timeoutMs: effectiveStructurerTimeoutMs,
        },
      },
    };
  }

  function loadFixtures() {
    const fixtures = fs
      .readdirSync(FIXTURE_DIR)
      .filter((name) => name.endsWith('.json'))
      .sort()
      .map((name) => {
        const raw = fs.readFileSync(path.join(FIXTURE_DIR, name), 'utf-8');
        return JSON.parse(raw) as StructureFixture;
      });

    if (!requestedFixtureFilter) {
      return fixtures;
    }

    const requestedNames = requestedFixtureFilter
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);

    const filtered = fixtures.filter((fixture) =>
      requestedNames.some((name) => fixture.name.toLowerCase().includes(name)),
    );
    if (filtered.length === 0) {
      throw new Error(
        `No structure fixtures matched LISTEN_GRAPHIC_E2E_STRUCTURE_FIXTURE=${requestedFixtureFilter}`,
      );
    }

    return filtered;
  }

  function formatRunDiagnostics(runResponse: {
    success: boolean;
    error?: string;
    providerError?: SerializableProviderError;
  }) {
    return JSON.stringify(
      {
        runResponse,
        fetchTraces,
      },
      null,
      2,
    );
  }

  function getExternalSkipResult(
    fixture: StructureFixture,
    runResponse: {
      success: boolean;
      error?: string;
      providerError?: SerializableProviderError;
    },
  ): ExternalSkipResult | null {
    if (runResponse.success) {
      return null;
    }

    const providerError = runResponse.providerError;
    const matchedTrace = fetchTraces.find((trace) => trace.status === 429);
    const traceBody = matchedTrace?.responseBody ?? '';
    const timedOutTraceCount = fetchTraces.filter((trace) => trace.error?.includes('AbortError')).length;
    const isKnownRateLimit =
      providerError?.code === 'RATE_LIMIT_ERROR' ||
      providerError?.status === 429 ||
      matchedTrace?.status === 429 ||
      traceBody.includes('"code":"1302"');
    const isKnownTimeout =
      providerError?.code === 'TIMEOUT_ERROR' ||
      timedOutTraceCount > 0;

    if (isKnownRateLimit && allowExternalIssueSkip) {
      const recommendedDelayMs = Math.max(effectiveFixtureDelayMs, 20_000);
      const endpoint = matchedTrace?.url ?? savedProviderConfig.structurer.endpoint ?? '<unknown>';
      const status = providerError?.status ?? matchedTrace?.status ?? 429;

      return {
        skippedDueToExternalIssue: true,
        reason: [
          `${fixture.name} hit a known external structurer rate limit and was skipped.`,
          `provider=${providerError?.provider ?? savedProviderConfig.structurer.type}`,
          `status=${status}`,
          `endpoint=${endpoint}`,
          `recommended_wait_ms=${recommendedDelayMs}`,
          `Unset LISTEN_GRAPHIC_E2E_STRUCTURE_ALLOW_EXTERNAL_SKIP to treat this as a hard failure.`,
        ].join(' '),
      };
    }

    if (isKnownTimeout && allowExternalIssueSkip) {
      return {
        skippedDueToExternalIssue: true,
        reason: [
          `${fixture.name} hit a known external structurer timeout and was skipped.`,
          `provider=${providerError?.provider ?? savedProviderConfig.structurer.type}`,
          `timeout_ms=${effectiveStructurerTimeoutMs}`,
          `endpoint=${savedProviderConfig.structurer.endpoint ?? '<unknown>'}`,
          `Unset LISTEN_GRAPHIC_E2E_STRUCTURE_ALLOW_EXTERNAL_SKIP to treat this as a hard failure.`,
        ].join(' '),
      };
    }

    return null;
  }

  function normalizeText(value: string) {
    return value.trim().toLowerCase().replace(/[，。！？、,.!?\s]/g, '');
  }

  function summarizeGraph(graph: MergedGraph | null) {
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

  function materializeFixture(
    fixture: StructureFixture,
    sessionId: string,
  ) {
    const materializeChunk = (
      transcript: Omit<TranscriptChunk, 'sessionId' | 'provider'> & { provider?: string },
    ): TranscriptChunk => ({
      ...transcript,
      sessionId,
      provider: transcript.provider ?? 'fixture-asr',
    });

    const mergedGraph = fixture.seed?.mergedGraph
      ? {
          ...fixture.seed.mergedGraph,
          sessionId,
        }
      : undefined;

    return {
      seed: fixture.seed
        ? {
            transcriptWindow: fixture.seed.transcriptWindow?.map(materializeChunk),
            mergedGraph,
            currentTimeMs: fixture.seed.currentTimeMs,
            chunkIndex: fixture.seed.chunkIndex,
            sessionId,
            sourceType: 'file' as const,
          }
        : undefined,
      transcripts: fixture.transcripts.map(materializeChunk),
    };
  }

  async function runFixture(fixture: StructureFixture) {
    const expectedSessionId = `fixture_${fixture.name}_${Date.now()}`;
    const materialized = materializeFixture(fixture, expectedSessionId);
    const runResponse = await dispatchMessage({
      type: 'TEST_STRUCTURER_SESSION_RUN',
      target: 'service-worker',
      payload: {
        seed: materialized.seed,
        transcripts: materialized.transcripts,
        finalizeSession: true,
      },
    });

    const externalSkipResult = getExternalSkipResult(fixture, runResponse);
    if (externalSkipResult) {
      return externalSkipResult;
    }

    expect(
      runResponse.success,
      `${fixture.name} should run successfully: ${formatRunDiagnostics(runResponse)}`,
    ).toBe(true);

    const sessionId = runResponse.sessionId ?? expectedSessionId;

    const debugResponse = await dispatchMessage({
      type: 'GET_DEBUG_SESSION',
      target: 'service-worker',
      payload: { sessionId },
    });
    expect(
      debugResponse.success,
      `${fixture.name} debug fetch failed: ${JSON.stringify(debugResponse, null, 2)}`,
    ).toBe(true);

    const exportResponse = await dispatchMessage({
      type: 'EXPORT_SESSION',
      target: 'service-worker',
      payload: { sessionId, format: 'json' },
    });
    expect(
      exportResponse.success,
      `${fixture.name} export failed: ${JSON.stringify(
        {
          exportResponse,
          debugData: debugResponse.debugData,
          persistedSegmentCount: segmentRecords.get(sessionId)?.length ?? 0,
          persistedMergedGraphPresent: mergedGraphRecords.has(sessionId),
          persistedMergedGraphKeys: Array.from(mergedGraphRecords.keys()),
        },
        null,
        2,
      )}`,
    ).toBe(true);

    return {
      sessionId,
      debugData: debugResponse.debugData as {
        segments: any[];
        transcripts: TranscriptChunk[];
        graph: MergedGraph | null;
        structurerRuns?: Array<{ fallbackUsed?: boolean }>;
      },
      exportData: JSON.parse(exportResponse.exportData.content) as {
        transcripts: TranscriptChunk[];
        graph: MergedGraph;
      },
      previousGraph: materialized.seed?.mergedGraph ?? null,
    };
  }

  function assertFixtureAcceptance(params: {
    fixture: StructureFixture;
    debugData: {
      segments: any[];
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
    expect(
      debugData.graph?.edges.length ?? 0,
      `${fixture.name} minMergedEdges graph=${JSON.stringify(graphSummary)}`,
    ).toBeGreaterThanOrEqual(acceptance.minMergedEdges);
    expect(exportData.transcripts.length, `${fixture.name} exported transcripts`).toBeGreaterThanOrEqual(
      fixture.transcripts.length,
    );

    const fallbackUsed = Boolean(lastStructurerRun?.fallbackUsed);
    if (!acceptance.allowFallback) {
      expect(fallbackUsed, `${fixture.name} should not fallback`).toBe(false);
    }
    if (acceptance.expectFallbackUsed !== undefined) {
      expect(fallbackUsed, `${fixture.name} fallback expectation`).toBe(
        acceptance.expectFallbackUsed,
      );
    }

    if (acceptance.disallowDuplicatePreviousTexts && previousGraph && lastSegment) {
      const previousTexts = new Set(previousGraph.nodes.map((node) => normalizeText(node.text)));
      const duplicatedTexts = lastSegment.nodes
        .map((node: { text: string }) => normalizeText(node.text))
        .filter((text: string) => previousTexts.has(text));
      expect(
        duplicatedTexts,
        `${fixture.name} should avoid duplicating previous node text graph=${JSON.stringify(graphSummary)}`,
      ).toEqual([]);
    }

    if (acceptance.expectCrossGraphEdges && previousGraph && lastSegment) {
      const previousNodeIds = new Set(previousGraph.nodes.map((node) => node.id));
      const lastSegmentNodeIds = new Set(lastSegment.nodes.map((node: { id: string }) => node.id));
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
      const normalizedNodeTexts = (debugData.graph?.nodes ?? []).map((node) => normalizeText(node.text));
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
      const normalizedNodeTexts = (debugData.graph?.nodes ?? []).map((node) => normalizeText(node.text));
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

  const fixtures = loadFixtures();
  for (const [index, fixture] of fixtures.entries()) {
    test(fixture.name, { timeout: effectiveStructurerTimeoutMs + 30_000 }, async () => {
      if (index > 0 && effectiveFixtureDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, effectiveFixtureDelayMs));
      }
      const result = await runFixture(fixture);
      if ('skippedDueToExternalIssue' in result) {
        console.warn(result.reason);
        return;
      }
      assertFixtureAcceptance({
        fixture,
        debugData: result.debugData,
        exportData: result.exportData,
        previousGraph: result.previousGraph,
      });
    });
  }
});
