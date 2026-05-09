import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const extensionRoot = path.resolve(__dirname, '..');
const fixtureDir = path.join(extensionRoot, 'src', 'service-worker', 'fixtures', 'structure');
const diagnosticArtifactDir = path.join(fixtureDir, 'artifacts', 'provider-instability');

const STRUCTURER_BOOTSTRAP_MIN_CHUNKS = 2;
const STRUCTURER_BOOTSTRAP_MIN_DURATION_MS = 45_000;
const STRUCTURER_BOOTSTRAP_MIN_CHAR_COUNT = 160;
const STRUCTURE_UNIT_SOFT_WAIT_MS = 1_800;
const STRUCTURE_UNIT_HARD_WAIT_MS = 4_000;
const STRUCTURE_UNIT_MIN_EFFECTIVE_CHARS_FOR_COMMIT = 28;
const STRUCTURE_UNIT_MAX_BUFFERED_UTTERANCES = 3;
const STRUCTURE_UNIT_MAX_BUFFERED_CHARS = 72;
const STRUCTURE_UNIT_SCORE_COMMIT_THRESHOLD = 2;
const STRUCTURE_UNIT_SCORE_WAIT_THRESHOLD = 1;

main();

function main() {
  const fixtureNames = discoverFixtureNames();
  const compareMode = process.argv.includes('--compare');
  const jsonMode = process.argv.includes('--json');

  if (!compareMode) {
    const results = fixtureNames.map((name) => analyzeFixture(name));
    const summary = buildSummary(results);
    const report = {
      generatedAt: new Date().toISOString(),
      fixtureCount: results.length,
      summary,
      fixtures: results,
      notes: [
        'This report uses the current programmatic assembler heuristics offline against replay-realtime fixtures.',
        'It reports deterministic scheduling KPIs only; empty-output ratio still requires real structurer replay/debug artifacts.',
        'Use --compare for side-by-side with/without assembler comparison.',
      ],
    };
    if (jsonMode) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    } else {
      printHumanReport(report);
    }
    return;
  }

  const withResults = fixtureNames.map((name) => analyzeFixture(name));
  const withoutResults = fixtureNames.map((name) => analyzeFixtureNoAssembler(name));
  const withSummary = buildSummary(withResults);
  const withoutSummary = buildSummary(withoutResults);

  const comparisonReport = {
    generatedAt: new Date().toISOString(),
    fixtureCount: fixtureNames.length,
    withAssembler: { summary: withSummary, fixtures: withResults },
    noAssembler: { summary: withoutSummary, fixtures: withoutResults },
    comparison: buildComparison(withResults, withoutResults),
  };

  if (jsonMode) {
    process.stdout.write(`${JSON.stringify(comparisonReport, null, 2)}\n`);
  } else {
    printCompareReport(comparisonReport);
  }
}

function discoverFixtureNames() {
  const filter = process.env.LISTEN_GRAPHIC_E2E_STRUCTURE_FIXTURE?.trim().toLowerCase();
  const filters = filter
    ? filter
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean)
    : [];

  const names = fs
    .readdirSync(fixtureDir)
    .filter((name) => name.endsWith('.json') && name.startsWith('replay-realtime-'))
    .map((name) => name.replace(/\.json$/i, ''))
    .filter((name) =>
      filters.length === 0
        ? true
        : filters.some((value) => name.toLowerCase().includes(value)),
    )
    .sort();

  if (names.length === 0) {
    throw new Error(
      filter
        ? `No replay fixtures matched LISTEN_GRAPHIC_E2E_STRUCTURE_FIXTURE=${filter}`
        : 'No replay-realtime fixtures found.',
    );
  }

  return names;
}

function analyzeFixture(fixtureName) {
  const fixturePath = path.join(fixtureDir, `${fixtureName}.json`);
  const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf-8'));
  const transcripts = (fixture.transcripts ?? []).map((transcript) => ({
    chunkId: transcript.chunkId,
    text: transcript.text,
    startMs: transcript.startMs,
    endMs: transcript.endMs,
    finalReason: transcript.finalReason ?? 'endpoint',
  }));

  const state = {
    transcriptWindow: [],
    mergedGraph: false,
    pendingBuffer: null,
    commitEvents: [],
    assemblerRuns: [],
    lowInfoSkips: 0,
  };

  for (const transcript of transcripts) {
    state.transcriptWindow.push(transcript);

    if (isLowInformationTranscript(transcript)) {
      state.lowInfoSkips += 1;
      state.assemblerRuns.push({
        transcriptId: transcript.chunkId,
        decision: 'skip_current',
        reason: 'skip_low_information',
      });
      continue;
    }

    state.pendingBuffer = appendToPendingStructureBuffer(state.pendingBuffer, transcript);
    const signals = deriveAssemblerSignals(state, transcript);
    const hardDecision = decideByHardRules(state, transcript, state.pendingBuffer, signals);
    const decision =
      hardDecision ??
      decideByScore(scoreBoundary(state.pendingBuffer, signals.waitMs));

    state.assemblerRuns.push({
      transcriptId: transcript.chunkId,
      decision: decision.type,
      reason: decision.reason,
      score: decision.score ?? null,
    });

    if (decision.type !== 'commit') {
      continue;
    }

    state.commitEvents.push({
      transcriptId: transcript.chunkId,
      endMs: transcript.endMs,
      utteranceCount: state.pendingBuffer.utterances.length,
      effectiveCharCount: state.pendingBuffer.effectiveChars,
      reason: decision.reason,
    });
    state.pendingBuffer = null;
    state.mergedGraph = true;
  }

  const sessionStartMs = transcripts[0]?.startMs ?? 0;
  const sessionEndMs = transcripts[transcripts.length - 1]?.endMs ?? 0;
  const durationMs = Math.max(0, sessionEndMs - sessionStartMs);
  const commitCount = state.commitEvents.length;
  const emptyOutputStats = loadEmptyOutputStats(fixtureName);
  const firstGraphLatencyMs =
    state.commitEvents[0] != null ? Math.max(0, state.commitEvents[0].endMs - sessionStartMs) : null;
  const structurerCallsPerMinute =
    durationMs > 0 ? Number(((commitCount / durationMs) * 60_000).toFixed(2)) : 0;
  const avgUtterancesPerCommit =
    commitCount > 0
      ? Number(
          (
            state.commitEvents.reduce((sum, event) => sum + event.utteranceCount, 0) / commitCount
          ).toFixed(2),
        )
      : 0;

  return {
    fixtureName,
    transcriptCount: transcripts.length,
    durationMs,
    commitCount,
    firstGraphLatencyMs,
    structurerCallsPerMinute,
    lowInfoSkips: state.lowInfoSkips,
    avgUtterancesPerCommit,
    ...emptyOutputStats,
    commitReasons: summarizeReasons(state.commitEvents),
  };
}

function analyzeFixtureNoAssembler(fixtureName) {
  const fixturePath = path.join(fixtureDir, `${fixtureName}.json`);
  const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf-8'));
  const transcripts = (fixture.transcripts ?? []).map((t) => ({
    chunkId: t.chunkId,
    text: t.text,
    startMs: t.startMs,
    endMs: t.endMs,
    finalReason: t.finalReason ?? 'endpoint',
  }));

  const state = {
    transcriptWindow: [],
    mergedGraph: false,
    commitEvents: [],
    assemblerRuns: [],
    lowInfoSkips: 0,
    waitSkips: 0,
  };

  for (const transcript of transcripts) {
    state.transcriptWindow.push(transcript);

    // 低信息跳过（与 assembler 无关，是 transcript 级过滤）
    if (isLowInformationTranscript(transcript)) {
      state.lowInfoSkips += 1;
      state.assemblerRuns.push({
        transcriptId: transcript.chunkId,
        decision: 'skip_current',
        reason: 'skip_low_information',
      });
      continue;
    }

    // 未出图时的 bootstrap 上下文检查
    if (!state.mergedGraph) {
      const forceBootstrap =
        (transcript.finalReason === 'input_finished' || transcript.finalReason === 'manual_flush') &&
        getEffectiveTranscriptWindowCharCount(state.transcriptWindow) > 0;

      if (!forceBootstrap && !hasEnoughRealtimeBootstrapContext(state.transcriptWindow)) {
        state.waitSkips += 1;
        state.assemblerRuns.push({
          transcriptId: transcript.chunkId,
          decision: 'wait',
          reason: 'wait_bootstrap_context',
        });
        continue;
      }
    }

    // 其余每条非低信息 utterance → 立即 commit
    const reason = (transcript.finalReason === 'input_finished' || transcript.finalReason === 'manual_flush')
      ? 'commit_force_flush'
      : 'commit_immediate';

    state.assemblerRuns.push({
      transcriptId: transcript.chunkId,
      decision: 'commit',
      reason,
    });

    state.commitEvents.push({
      transcriptId: transcript.chunkId,
      endMs: transcript.endMs,
      utteranceCount: 1,
      effectiveCharCount: getEffectiveTranscriptCharCount(transcript),
      reason,
    });
    state.mergedGraph = true;
  }

  const sessionStartMs = transcripts[0]?.startMs ?? 0;
  const sessionEndMs = transcripts[transcripts.length - 1]?.endMs ?? 0;
  const durationMs = Math.max(0, sessionEndMs - sessionStartMs);
  const commitCount = state.commitEvents.length;
  const emptyOutputStats = loadEmptyOutputStats(fixtureName);
  const firstGraphLatencyMs =
    state.commitEvents[0] != null ? Math.max(0, state.commitEvents[0].endMs - sessionStartMs) : null;
  const structurerCallsPerMinute =
    durationMs > 0 ? Number(((commitCount / durationMs) * 60_000).toFixed(2)) : 0;
  const avgUtterancesPerCommit =
    commitCount > 0
      ? Number(
          (state.commitEvents.reduce((sum, e) => sum + e.utteranceCount, 0) / commitCount).toFixed(2),
        )
      : 0;

  return {
    fixtureName,
    transcriptCount: transcripts.length,
    durationMs,
    commitCount,
    firstGraphLatencyMs,
    structurerCallsPerMinute,
    lowInfoSkips: state.lowInfoSkips,
    avgUtterancesPerCommit,
    ...emptyOutputStats,
    commitReasons: summarizeReasons(state.commitEvents),
  };
}

function buildSummary(results) {
  const firstGraphLatencies = results
    .map((item) => item.firstGraphLatencyMs)
    .filter((value) => typeof value === 'number')
    .sort((a, b) => a - b);

  return {
    firstGraphLatencyMs: summarizeDistribution(firstGraphLatencies),
    averageStructurerCallsPerMinute:
      results.length > 0
        ? Number(
            (
              results.reduce((sum, item) => sum + item.structurerCallsPerMinute, 0) / results.length
            ).toFixed(2),
          )
        : 0,
    averageLowInfoSkips:
      results.length > 0
        ? Number(
            (results.reduce((sum, item) => sum + item.lowInfoSkips, 0) / results.length).toFixed(2),
          )
        : 0,
    averageUtterancesPerCommit:
      results.length > 0
        ? Number(
            (
              results.reduce((sum, item) => sum + item.avgUtterancesPerCommit, 0) / results.length
            ).toFixed(2),
          )
        : 0,
    mergeWithPrevCommits: results.reduce(
      (sum, item) => sum + (item.commitReasons.merge_with_prev ?? 0),
      0,
    ),
    emptyOutputRatio: summarizeEmptyOutputRatio(results),
  };
}

function printHumanReport(report) {
  console.log(`Structure-unit ws KPI preview (${report.fixtureCount} fixtures)`);
  console.log(`Generated at: ${report.generatedAt}`);
  console.log('');
  console.log('Summary:');
  console.log(
    `- firstGraphLatencyMs p50/p95/max: ${formatNullable(report.summary.firstGraphLatencyMs?.p50)} / ${formatNullable(report.summary.firstGraphLatencyMs?.p95)} / ${formatNullable(report.summary.firstGraphLatencyMs?.max)}`,
  );
  console.log(
    `- average structurer calls per minute: ${report.summary.averageStructurerCallsPerMinute}`,
  );
  console.log(`- average low-info skips: ${report.summary.averageLowInfoSkips}`);
  console.log(
    `- average utterances per commit: ${report.summary.averageUtterancesPerCommit}`,
  );
  console.log(`- merge_with_prev commits: ${report.summary.mergeWithPrevCommits}`);
  console.log(`- empty output ratio: ${formatRatio(report.summary.emptyOutputRatio)}`);
  console.log('');
  console.log('Fixtures:');

  for (const item of report.fixtures) {
    console.log(
      `- ${item.fixtureName}: firstGraphLatencyMs=${formatNullable(item.firstGraphLatencyMs)}, callsPerMinute=${item.structurerCallsPerMinute}, commits=${item.commitCount}, mergeWithPrev=${item.commitReasons.merge_with_prev ?? 0}, lowInfoSkips=${item.lowInfoSkips}, avgUtterancesPerCommit=${item.avgUtterancesPerCommit}, emptyOutputRatio=${formatRatio(item.emptyOutputRatio)}`,
    );
  }

  console.log('');
  console.log('Notes:');
  for (const note of report.notes) {
    console.log(`- ${note}`);
  }
}

function summarizeDistribution(values) {
  if (values.length === 0) {
    return null;
  }

  return {
    min: values[0],
    p50: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    max: values[values.length - 1],
  };
}

function percentile(values, ratio) {
  const index = Math.min(values.length - 1, Math.max(0, Math.ceil(values.length * ratio) - 1));
  return values[index];
}

function summarizeReasons(events) {
  return events.reduce((accumulator, event) => {
    accumulator[event.reason] = (accumulator[event.reason] ?? 0) + 1;
    return accumulator;
  }, {});
}

function summarizeEmptyOutputRatio(results) {
  const totals = results.reduce(
    (accumulator, item) => ({
      emptyOutputCount: accumulator.emptyOutputCount + (item.emptyOutputCount ?? 0),
      artifactCallCount: accumulator.artifactCallCount + (item.artifactCallCount ?? 0),
    }),
    { emptyOutputCount: 0, artifactCallCount: 0 },
  );

  if (totals.artifactCallCount === 0) {
    return null;
  }

  return Number((totals.emptyOutputCount / totals.artifactCallCount).toFixed(3));
}

function loadEmptyOutputStats(fixtureName) {
  const artifactPaths = findDiagnosticArtifacts(fixtureName);
  if (artifactPaths.length === 0) {
    return {
      emptyOutputRatio: null,
      emptyOutputCount: null,
      artifactCallCount: 0,
      diagnosticArtifactCount: 0,
    };
  }

  const latestArtifactPath = artifactPaths[artifactPaths.length - 1];
  const artifact = JSON.parse(fs.readFileSync(latestArtifactPath, 'utf-8'));
  const traces = Array.isArray(artifact.fetchTraces) ? artifact.fetchTraces : [];
  const parsedOutputs = traces
    .map((trace) => parseStructurerOutputFromTrace(trace))
    .filter((output) => output != null);
  const emptyOutputCount = parsedOutputs.filter(
    (output) => output.nodes.length === 0 && output.edges.length === 0,
  ).length;

  return {
    emptyOutputRatio:
      parsedOutputs.length > 0
        ? Number((emptyOutputCount / parsedOutputs.length).toFixed(3))
        : null,
    emptyOutputCount,
    artifactCallCount: parsedOutputs.length,
    diagnosticArtifactCount: artifactPaths.length,
    diagnosticArtifactPath: path.relative(extensionRoot, latestArtifactPath),
  };
}

function findDiagnosticArtifacts(fixtureName) {
  if (!fs.existsSync(diagnosticArtifactDir)) {
    return [];
  }

  return fs
    .readdirSync(diagnosticArtifactDir)
    .filter(
      (name) =>
        name.startsWith(`${fixtureName}.attempt-`) &&
        name.endsWith('.diagnostic.json'),
    )
    .map((name) => path.join(diagnosticArtifactDir, name))
    .sort((left, right) => getAttemptNumber(left) - getAttemptNumber(right));
}

function getAttemptNumber(filePath) {
  const match = path.basename(filePath).match(/\.attempt-(\d+)\.diagnostic\.json$/);
  return match ? Number.parseInt(match[1], 10) : 0;
}

function parseStructurerOutputFromTrace(trace) {
  if (typeof trace?.responseBody !== 'string' || !trace.responseBody.trim()) {
    return null;
  }

  try {
    const response = JSON.parse(trace.responseBody);
    const content = response?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') {
      return null;
    }

    const parsedContent = parseJsonObjectFromText(content);
    if (!parsedContent) {
      return null;
    }

    return {
      nodes: Array.isArray(parsedContent.nodes) ? parsedContent.nodes : [],
      edges: Array.isArray(parsedContent.edges) ? parsedContent.edges : [],
    };
  } catch {
    return parseStructurerOutputFromRawBody(trace.responseBody);
  }
}

function parseStructurerOutputFromRawBody(responseBody) {
  const compact = responseBody.replace(/\s+/g, '');
  const nodesEmpty = hasJsonArrayField(compact, 'nodes', 'empty');
  const edgesEmpty = hasJsonArrayField(compact, 'edges', 'empty');
  const nodesNonEmpty = hasJsonArrayField(compact, 'nodes', 'non-empty');
  const edgesNonEmpty = hasJsonArrayField(compact, 'edges', 'non-empty');

  if (!nodesEmpty && !nodesNonEmpty && !edgesEmpty && !edgesNonEmpty) {
    return null;
  }

  return {
    nodes: nodesNonEmpty ? [{}] : [],
    edges: edgesNonEmpty ? [{}] : [],
  };
}

function hasJsonArrayField(text, field, kind) {
  const escapedField = `\\\\\\"${field}\\\\\\"`;
  const plainField = `"${field}"`;
  const fieldPatterns = [escapedField, plainField];
  const arrayPattern = kind === 'empty' ? String.raw`\:\[\]` : String.raw`\:\[\{`;
  return fieldPatterns.some((pattern) => new RegExp(`${pattern}${arrayPattern}`).test(text));
}

function parseJsonObjectFromText(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) {
    return null;
  }

  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

function appendToPendingStructureBuffer(buffer, transcript) {
  const utterances = [...(buffer?.utterances ?? []), transcript].slice(
    -STRUCTURE_UNIT_MAX_BUFFERED_UTTERANCES,
  );
  const startedAt = buffer?.startedAt ?? transcript.endMs;
  return createPendingStructureBuffer(utterances, startedAt, transcript.endMs);
}

function createPendingStructureBuffer(utterances, startedAt, updatedAt) {
  const combinedText = utterances.map((item) => item.text).join('\n');
  return {
    utterances,
    startedAt,
    updatedAt,
    totalChars: utterances.reduce((sum, item) => sum + getNormalizedTranscriptCharCount(item), 0),
    effectiveChars: utterances.reduce((sum, item) => sum + getEffectiveTranscriptCharCount(item), 0),
    sawTerminalPunctuation: hasTerminalPunctuation(combinedText),
    sawIncompleteTail: hasIncompleteTailPattern(combinedText),
  };
}

function deriveAssemblerSignals(state, transcript) {
  const buffer = state.pendingBuffer;
  const waitMs = Math.max(0, buffer.updatedAt - buffer.startedAt);
  return {
    waitMs,
    hasBootstrapReadyContext: hasEnoughRealtimeBootstrapContext(state.transcriptWindow),
    forceBootstrapExternal: false,
    forceBootstrapCompleted: shouldForceBootstrapForCompletedRealtimeInput(
      transcript,
      state.transcriptWindow,
      state.mergedGraph,
    ),
    hitHardWait: waitMs >= STRUCTURE_UNIT_HARD_WAIT_MS,
    hitMaxBufferedUtterances:
      buffer.utterances.length >= STRUCTURE_UNIT_MAX_BUFFERED_UTTERANCES,
    hitMaxBufferedChars: buffer.effectiveChars >= STRUCTURE_UNIT_MAX_BUFFERED_CHARS,
  };
}

function decideByHardRules(state, transcript, buffer, signals) {
  if (signals.hitHardWait) {
    return { type: 'commit', reason: 'commit_timeout' };
  }

  if (
    transcript.finalReason === 'input_finished' ||
    transcript.finalReason === 'manual_flush'
  ) {
    return { type: 'commit', reason: 'commit_force_flush' };
  }

  if (state.mergedGraph && (signals.hitMaxBufferedUtterances || signals.hitMaxBufferedChars)) {
    return { type: 'commit', reason: 'commit_force_flush' };
  }

  if (state.mergedGraph && isMergeWithPrevCandidate(buffer)) {
    return { type: 'commit', reason: 'merge_with_prev' };
  }

  if (!state.mergedGraph) {
    if (signals.forceBootstrapExternal || signals.forceBootstrapCompleted) {
      return { type: 'commit', reason: 'commit_force_flush' };
    }

    if (!signals.hasBootstrapReadyContext) {
      return { type: 'wait', reason: 'wait_bootstrap_context' };
    }

    if (
      getTranscriptWindowDurationMs(state.transcriptWindow) >= STRUCTURER_BOOTSTRAP_MIN_DURATION_MS ||
      getEffectiveTranscriptWindowCharCount(state.transcriptWindow) >=
        STRUCTURER_BOOTSTRAP_MIN_CHAR_COUNT
    ) {
      return { type: 'commit', reason: 'commit_rule' };
    }
  }

  if (
    buffer.sawTerminalPunctuation &&
    buffer.effectiveChars >= STRUCTURE_UNIT_MIN_EFFECTIVE_CHARS_FOR_COMMIT &&
    !buffer.sawIncompleteTail
  ) {
    return { type: 'commit', reason: 'commit_rule' };
  }

  return null;
}

function scoreBoundary(buffer, waitMs) {
  let score = 0;

  if (buffer.effectiveChars >= STRUCTURE_UNIT_MIN_EFFECTIVE_CHARS_FOR_COMMIT) score += 2;
  if (buffer.effectiveChars >= 40) score += 1;
  if (buffer.sawTerminalPunctuation) score += 2;
  if (buffer.utterances.length >= 2) score += 1;
  if (waitMs >= STRUCTURE_UNIT_SOFT_WAIT_MS) score += 1;

  if (buffer.sawIncompleteTail) score -= 1;
  if (buffer.effectiveChars <= 8) score -= 2;
  if (buffer.utterances.length === 1 && !buffer.sawTerminalPunctuation) score -= 1;

  return score;
}

function decideByScore(score) {
  if (score >= STRUCTURE_UNIT_SCORE_COMMIT_THRESHOLD) {
    return { type: 'commit', reason: 'commit_score', score };
  }

  if (score <= STRUCTURE_UNIT_SCORE_WAIT_THRESHOLD) {
    return { type: 'wait', reason: 'wait_more_context', score };
  }

  return { type: 'wait', reason: 'wait_boundary_uncertain', score };
}

function isMergeWithPrevCandidate(buffer) {
  if (buffer.utterances.length < 2) {
    return false;
  }

  const previous = buffer.utterances[buffer.utterances.length - 2];
  const current = buffer.utterances[buffer.utterances.length - 1];
  return (
    looksLikeIncompleteUtterance(previous) &&
    looksLikeCompletionAfterPrevious(previous, current)
  );
}

function looksLikeIncompleteUtterance(transcript) {
  if (
    isLowInformationTranscript(transcript) ||
    hasTerminalPunctuation(transcript.text) ||
    getEffectiveTranscriptCharCount(transcript) < 6
  ) {
    return false;
  }

  return hasIncompleteTailPattern(transcript.text) || hasWeakSetupTailPattern(transcript.text);
}

function looksLikeCompletionAfterPrevious(previous, current) {
  if (
    isLowInformationTranscript(current) ||
    getEffectiveTranscriptCharCount(current) < 8
  ) {
    return false;
  }

  const combinedText = `${previous.text}\n${current.text}`;
  return (
    hasTerminalPunctuation(combinedText) ||
    (
      getEffectiveTranscriptCharCount(previous) + getEffectiveTranscriptCharCount(current) >=
        STRUCTURE_UNIT_MIN_EFFECTIVE_CHARS_FOR_COMMIT &&
      !hasIncompleteTailPattern(combinedText)
    )
  );
}

function hasEnoughRealtimeBootstrapContext(window) {
  if (window.length < STRUCTURER_BOOTSTRAP_MIN_CHUNKS) {
    return false;
  }

  return (
    getTranscriptWindowDurationMs(window) >= STRUCTURER_BOOTSTRAP_MIN_DURATION_MS ||
    getEffectiveTranscriptWindowCharCount(window) >= STRUCTURER_BOOTSTRAP_MIN_CHAR_COUNT
  );
}

function shouldForceBootstrapForCompletedRealtimeInput(transcript, window, mergedGraph) {
  if (mergedGraph) {
    return false;
  }

  if (
    transcript.finalReason !== 'input_finished' &&
    transcript.finalReason !== 'manual_flush'
  ) {
    return false;
  }

  return getEffectiveTranscriptWindowCharCount(window) > 0;
}

function getTranscriptWindowDurationMs(window) {
  if (window.length === 0) {
    return 0;
  }

  return Math.max(0, (window[window.length - 1]?.endMs ?? 0) - (window[0]?.startMs ?? 0));
}

function getEffectiveTranscriptWindowCharCount(window) {
  return window.reduce((sum, chunk) => sum + getEffectiveTranscriptCharCount(chunk), 0);
}

function getNormalizedTranscriptCharCount(transcript) {
  return transcript.text.replace(/\s+/g, '').trim().length;
}

function getEffectiveTranscriptCharCount(transcript) {
  return isLowInformationTranscript(transcript) ? 0 : getNormalizedTranscriptCharCount(transcript);
}

function isLowInformationTranscript(transcript) {
  const normalizedText = transcript.text.replace(/\s+/g, '').trim();
  return (
    /声音[。！？]?$/u.test(normalizedText) ||
    /^(掌声|谢谢|欢迎|好的|好吧|嗯|啊|诶|哎)[。！？]?$/u.test(normalizedText)
  );
}

function normalizeAssemblerText(text) {
  return text.replace(/\s+/g, ' ').trim();
}

function hasTerminalPunctuation(text) {
  return /[。！？.!?]$/u.test(normalizeAssemblerText(text));
}

function hasIncompleteTailPattern(text) {
  const normalized = normalizeAssemblerText(text);
  if (!normalized || hasTerminalPunctuation(normalized)) {
    return false;
  }

  return getIncompleteTailPattern().test(normalized);
}

function hasWeakSetupTailPattern(text) {
  const normalized = normalizeAssemblerText(text);
  if (!normalized || hasTerminalPunctuation(normalized)) {
    return false;
  }

  return getWeakSetupTailPattern().test(normalized);
}

function getIncompleteTailPattern() {
  return /(因为|所以|但是|然后|就是|我觉得|我的意思是|这个问题|问题在于)$/u;
}

function getWeakSetupTailPattern() {
  return /(在于|核心是|原因是|关键是|比如说|也就是说)$/u;
}

function formatNullable(value) {
  return value == null ? 'n/a' : String(value);
}

function formatRatio(value) {
  return value == null ? 'n/a' : String(value);
}

function buildComparison(withResults, withoutResults) {
  const withFirstLatency = withResults
    .map((r) => r.firstGraphLatencyMs)
    .filter((v) => typeof v === 'number')
    .sort((a, b) => a - b);
  const withoutFirstLatency = withoutResults
    .map((r) => r.firstGraphLatencyMs)
    .filter((v) => typeof v === 'number')
    .sort((a, b) => a - b);

  return {
    firstGraphLatencyMs: {
      withAssembler: summarizeDistribution(withFirstLatency),
      noAssembler: summarizeDistribution(withoutFirstLatency),
    },
    averageStructurerCallsPerMinute: {
      withAssembler: withResults.length > 0
        ? Number((withResults.reduce((s, r) => s + r.structurerCallsPerMinute, 0) / withResults.length).toFixed(2))
        : 0,
      noAssembler: withoutResults.length > 0
        ? Number((withoutResults.reduce((s, r) => s + r.structurerCallsPerMinute, 0) / withoutResults.length).toFixed(2))
        : 0,
    },
    totalCommitCount: {
      withAssembler: withResults.reduce((s, r) => s + r.commitCount, 0),
      noAssembler: withoutResults.reduce((s, r) => s + r.commitCount, 0),
    },
    averageUtterancesPerCommit: {
      withAssembler: withResults.length > 0
        ? Number((withResults.reduce((s, r) => s + r.avgUtterancesPerCommit, 0) / withResults.length).toFixed(2))
        : 0,
      noAssembler: withoutResults.length > 0
        ? Number((withoutResults.reduce((s, r) => s + r.avgUtterancesPerCommit, 0) / withoutResults.length).toFixed(2))
        : 0,
    },
    emptyOutputRatio: {
      withAssembler: summarizeEmptyOutputRatio(withResults),
      noAssembler: summarizeEmptyOutputRatio(withoutResults),
    },
    averageLowInfoSkips: {
      withAssembler: withResults.length > 0
        ? Number((withResults.reduce((s, r) => s + r.lowInfoSkips, 0) / withResults.length).toFixed(2))
        : 0,
      noAssembler: withoutResults.length > 0
        ? Number((withoutResults.reduce((s, r) => s + r.lowInfoSkips, 0) / withoutResults.length).toFixed(2))
        : 0,
    },
  };
}

function printCompareReport(report) {
  const c = report.comparison;
  const fmtLatency = (d) => (d == null ? 'n/a' : `${d.p50} / ${d.p95} / ${d.max}`);
  const fmtRatio = (v) => (v == null ? 'n/a' : String(v));

  console.log(`Assembler 回放对照测试 (${report.fixtureCount} fixtures)`);
  console.log(`Generated at: ${report.generatedAt}`);
  console.log('');
  console.log('┌─────────────────────────────────────────┬───────────────┬───────────────┐');
  console.log('│ Metric                                  │ With Assembler│ No Assembler  │');
  console.log('├─────────────────────────────────────────┼───────────────┼───────────────┤');
  console.log(`│ firstGraphLatencyMs p50/p95/max         │ ${String(fmtLatency(c.firstGraphLatencyMs.withAssembler)).padEnd(13)} │ ${String(fmtLatency(c.firstGraphLatencyMs.noAssembler)).padEnd(13)} │`);
  console.log(`│ avg structurer calls/min                │ ${String(c.averageStructurerCallsPerMinute.withAssembler).padEnd(13)} │ ${String(c.averageStructurerCallsPerMinute.noAssembler).padEnd(13)} │`);
  console.log(`│ total commit count                      │ ${String(c.totalCommitCount.withAssembler).padEnd(13)} │ ${String(c.totalCommitCount.noAssembler).padEnd(13)} │`);
  console.log(`│ avg utterances/commit                   │ ${String(c.averageUtterancesPerCommit.withAssembler).padEnd(13)} │ ${String(c.averageUtterancesPerCommit.noAssembler).padEnd(13)} │`);
  console.log(`│ empty output ratio                      │ ${String(fmtRatio(c.emptyOutputRatio.withAssembler)).padEnd(13)} │ ${String(fmtRatio(c.emptyOutputRatio.noAssembler)).padEnd(13)} │`);
  console.log(`│ avg low-info skips                      │ ${String(c.averageLowInfoSkips.withAssembler).padEnd(13)} │ ${String(c.averageLowInfoSkips.noAssembler).padEnd(13)} │`);
  console.log('└─────────────────────────────────────────┴───────────────┴───────────────┘');
  console.log('');
  console.log('Per-fixture detail:');
  for (let i = 0; i < report.withAssembler.fixtures.length; i++) {
    const w = report.withAssembler.fixtures[i];
    const n = report.noAssembler.fixtures[i];
    console.log(`  ${w.fixtureName}:`);
    console.log(`    commits:       with=${w.commitCount}  without=${n.commitCount}`);
    console.log(`    calls/min:     with=${w.structurerCallsPerMinute}  without=${n.structurerCallsPerMinute}`);
    console.log(`    firstGraphMs:  with=${formatNullable(w.firstGraphLatencyMs)}  without=${formatNullable(n.firstGraphLatencyMs)}`);
    console.log(`    utt/commit:    with=${w.avgUtterancesPerCommit}  without=${n.avgUtterancesPerCommit}`);
  }
}
