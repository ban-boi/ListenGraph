import { beforeEach, describe, expect, test, vi } from 'vitest';
import * as path from 'path';
import type {
  MergedGraph,
  ProviderConfig,
  SerializableProviderError,
  TranscriptChunk,
} from '@listen-graphic/schema';
import {
  type FetchTrace,
  type FixtureRunContext,
  ExternalProviderIssueError,
  fetchWithHarnessTimeout,
  writeRealStructurerTrace,
  attachStructurerTraceContext,
  normalizeText,
  summarizeGraph,
  summarizeStructurerCalls,
  loadFixtures,
  writeFixtureDiagnostics,
  getExternalSkipResult,
  getExternalIssueMetadata,
  assertFixtureAcceptance,
} from './structure-focused-helpers';

const FIXTURE_DIR = path.resolve(__dirname, './fixtures/structure');
const realStructurerType = process.env.LISTEN_GRAPHIC_E2E_STRUCTURER_TYPE?.trim();
const realStructurerKey = process.env.LISTEN_GRAPHIC_E2E_STRUCTURER_API_KEY?.trim();
const structureProfile = process.env.LISTEN_GRAPHIC_E2E_STRUCTURE_PROFILE?.trim().toLowerCase() || 'full';
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
const timeoutCooldownMs = Number.parseInt(
  process.env.LISTEN_GRAPHIC_E2E_STRUCTURE_TIMEOUT_COOLDOWN_MS?.trim() || '',
  10,
);
const effectiveTimeoutCooldownMs = Number.isFinite(timeoutCooldownMs)
  ? timeoutCooldownMs
  : Math.max(effectiveFixtureDelayMs, effectiveStructurerTimeoutMs);
const rateLimitCooldownMs = Number.parseInt(
  process.env.LISTEN_GRAPHIC_E2E_STRUCTURE_RATE_LIMIT_COOLDOWN_MS?.trim() || '',
  10,
);
const effectiveRateLimitCooldownMs = Number.isFinite(rateLimitCooldownMs)
  ? rateLimitCooldownMs
  : Math.max(effectiveFixtureDelayMs, 60_000);
const externalRetryLimit = Number.parseInt(
  process.env.LISTEN_GRAPHIC_E2E_STRUCTURE_EXTERNAL_RETRY_LIMIT?.trim() || '',
  10,
);
const effectiveExternalRetryLimit = Number.isFinite(externalRetryLimit)
  ? Math.max(externalRetryLimit, 0)
  : 1;
const fixtureTestTimeoutMs = Number.parseInt(
  process.env.LISTEN_GRAPHIC_E2E_STRUCTURE_TEST_TIMEOUT_MS?.trim() || '',
  10,
);
const effectiveFixtureTestTimeoutMs = Number.isFinite(fixtureTestTimeoutMs)
  ? fixtureTestTimeoutMs
  : effectiveStructurerTimeoutMs > 0
    ? (effectiveStructurerTimeoutMs +
        Math.max(
          effectiveFixtureDelayMs,
          effectiveTimeoutCooldownMs,
          effectiveRateLimitCooldownMs,
        ) +
        30_000) *
      (effectiveExternalRetryLimit + 1)
    : 3_600_000;
const diagnosticArtifactDir = process.env.LISTEN_GRAPHIC_E2E_STRUCTURE_DIAGNOSTIC_DIR?.trim();
const traceRealStructurer =
  process.env.LISTEN_GRAPHIC_E2E_STRUCTURE_TRACE?.trim() === '1';
const canRunRealStructurer =
  Boolean(realStructurerType) &&
  (realStructurerType === 'zhipu' ? Boolean(realStructurerKey) : Boolean(realStructurerKey));
const describeReal = canRunRealStructurer ? describe : describe.skip;
const SMOKE_FIXTURE_NAMES = new Set([
  'bootstrap-basic',
  'bootstrap-law-constraint',
  'incremental-support-reason',
  'incremental-role-self',
]);
const REPLAY_FIXTURE_PREFIX = 'replay-realtime-';

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
  let currentFixtureRunContext: FixtureRunContext | null = null;

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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 测试 mock 的 chrome 对象，需要访问 vi.fn() 方法
    const chromeMock = (globalThis as Record<string, unknown>).chrome as any;
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
        attachStructurerTraceContext(trace, init?.body, currentFixtureRunContext);
        fetchTraces.push(trace);

        try {
          writeRealStructurerTrace('fetch:start', trace, [
            `mode=${trace.structurerMode ?? '<unknown>'}`,
            `timeoutMs=${effectiveStructurerTimeoutMs}`,
            `url=${trace.url}`,
          ], traceRealStructurer);
          const response = await fetchWithHarnessTimeout(nativeFetch, input, init, effectiveStructurerTimeoutMs);
          trace.status = response.status;
          trace.ok = response.ok;
          writeRealStructurerTrace('fetch:response', trace, [
            `status=${response.status}`,
            `ok=${response.ok}`,
          ], traceRealStructurer);
          try {
            trace.responseBody = (await response.clone().text()).slice(0, 50_000);
            writeRealStructurerTrace('fetch:body', trace, [
              `chars=${trace.responseBody.length}`,
            ], traceRealStructurer);
          } catch (error) {
            trace.responseBody =
              error instanceof Error ? `<failed to read body: ${error.message}>` : '<failed to read body>';
            writeRealStructurerTrace('fetch:body-error', trace, [
              `error=${error instanceof Error ? error.message : String(error)}`,
            ], traceRealStructurer);
          }
          return response;
        } catch (error) {
          trace.error = error instanceof Error ? error.message : String(error);
          writeRealStructurerTrace('fetch:error', trace, [`error=${trace.error}`], traceRealStructurer);
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

  function formatRunDiagnostics(runResponse: {
    success: boolean;
    error?: string;
    providerError?: SerializableProviderError;
  }) {
    const callSummaries = summarizeStructurerCalls(fetchTraces);
    return JSON.stringify(
      {
        runResponse,
        fetchTraces,
        callSummaries,
      },
      null,
      2,
    );
  }

  function materializeFixture(
    fixture: import('./structure-focused-helpers').StructureFixture,
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
            transcriptSequence: fixture.seed.transcriptSequence,
            chunkIndex: fixture.seed.chunkIndex,
            sessionId,
            sourceType: 'file' as const,
          }
        : undefined,
      transcripts: fixture.transcripts.map(materializeChunk),
    };
  }

  async function runFixture(
    fixture: import('./structure-focused-helpers').StructureFixture,
    fixtureAttempt: number,
  ) {
    fetchTraces = [];
    const expectedSessionId = `fixture_${fixture.name}_${Date.now()}`;
    const materialized = materializeFixture(fixture, expectedSessionId);
    currentFixtureRunContext = {
      fixtureName: fixture.name,
      fixtureAttempt,
      nextCallSequence: 1,
      callSequenceByKey: new Map(),
    };
    let runResponse: {
      success: boolean;
      error?: string;
      providerError?: SerializableProviderError;
      sessionId?: string;
    };
    try {
      runResponse = await dispatchMessage({
        type: 'TEST_STRUCTURER_SESSION_RUN',
        target: 'service-worker',
        payload: {
          seed: materialized.seed,
          transcripts: materialized.transcripts,
          finalizeSession: true,
        },
      });
    } finally {
      currentFixtureRunContext = null;
    }
    writeFixtureDiagnostics({
      fixtureName: fixture.name,
      fixtureAttempt,
      runResponse,
      fetchTraces,
      diagnosticArtifactDir,
    });

    const externalSkipResult = getExternalSkipResult(
      fixture,
      runResponse,
      {
        allowExternalIssueSkip,
        effectiveRateLimitCooldownMs,
        effectiveTimeoutCooldownMs,
        effectiveStructurerTimeoutMs,
        structurerEndpoint: savedProviderConfig.structurer.endpoint,
        structurerType: savedProviderConfig.structurer.type,
      },
      fetchTraces,
    );
    if (externalSkipResult) {
      return externalSkipResult;
    }

    const externalIssue = getExternalIssueMetadata(
      runResponse,
      fetchTraces,
      savedProviderConfig.structurer.endpoint,
    );
    if (externalIssue) {
      throw new ExternalProviderIssueError(
        externalIssue,
        formatRunDiagnostics(runResponse),
        runResponse,
      );
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

  const fixtures = loadFixtures({
    fixtureDir: FIXTURE_DIR,
    structureProfile,
    requestedFixtureFilter,
    replayFixturePrefix: REPLAY_FIXTURE_PREFIX,
    smokeFixtureNames: SMOKE_FIXTURE_NAMES,
  });
  let nextFixtureCooldownMs = 0;
  for (const [index, fixture] of fixtures.entries()) {
    test(
      fixture.name,
      {
        timeout: effectiveFixtureTestTimeoutMs,
      },
      async () => {
        const cooldownBeforeFixtureMs =
          index > 0 ? Math.max(effectiveFixtureDelayMs, nextFixtureCooldownMs) : 0;
        if (cooldownBeforeFixtureMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, cooldownBeforeFixtureMs));
      }
      nextFixtureCooldownMs = 0;

      try {
        let attempt = 0;
        while (true) {
          attempt += 1;
          try {
            const result = await runFixture(fixture, attempt);
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
            break;
          } catch (error) {
            if (
              error instanceof ExternalProviderIssueError &&
              attempt <= effectiveExternalRetryLimit
            ) {
              const retryCooldownMs =
                error.metadata.kind === 'timeout'
                  ? effectiveTimeoutCooldownMs
                  : effectiveRateLimitCooldownMs;
              console.warn(
                [
                  `${fixture.name} attempt ${attempt} hit external ${error.metadata.kind}.`,
                  `retrying_after_ms=${retryCooldownMs}`,
                  `endpoint=${error.metadata.endpoint}`,
                ].join(' '),
              );
              await new Promise((resolve) => setTimeout(resolve, retryCooldownMs));
              continue;
            }

            throw error;
          }
        }
      } catch (error) {
        if (error instanceof ExternalProviderIssueError) {
          nextFixtureCooldownMs =
            error.metadata.kind === 'timeout'
              ? effectiveTimeoutCooldownMs
              : effectiveRateLimitCooldownMs;
        }
        throw error;
      }
      },
    );
  }
});
