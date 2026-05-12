// assembler-machine.ts — 结构化单元组装器状态机
// 从 index.ts 提取：resetAssemblerState、appendTranscriptToWindow、
// getStructurerInvocationContextFromAssembler、shouldHandleWithStructureUnitAssembler、
// deriveAssemblerSignals、decideAssemblerByHardRules、materializeAssemblerCommitContext、
// flushPendingStructureBuffer、recordAssemblerRunDebug、recordStructureUnitDebug、
// collapseTranscriptWindowWithStructureUnit、shouldForceBootstrapForCompletedRealtimeInput、
// shouldForceBootstrapForExternalRealtimeWindow、getCurrentAsrTransport

import type { TranscriptChunk } from '@listen-graphic/schema';
import type {
  AssemblerRunDebug,
  StructureUnitDebug,
} from '../shared/messages';
import type {
  PendingStructureBuffer,
  StructureUnit,
  StructureUnitCommitReason,
  AssemblerSignals,
  AssemblerDecision,
} from './assembler-types';
import {
  hasEnoughBootstrapContext,
  getTranscriptWindowCharCount,
  getEffectiveTranscriptWindowCharCount,
  shouldSkipIncrementalStructuring,
  getNormalizedTranscriptCharCount,
  getEffectiveTranscriptCharCount,
  isLowInformationTranscript,
  appendToPendingStructureBuffer,
  decideAssemblerByScore,
  scoreAssemblerBoundary,
  isMergeWithPrevCandidate,
  materializeStructureUnit,
  getTranscriptWindowDurationMs,
  hasTerminalPunctuation,
  hasIncompleteTailPattern,
} from './assembler-decision';
import {
  STRUCTURER_WINDOW_SIZE,
  STRUCTURE_UNIT_ASSEMBLER_ENABLED,
  STRUCTURE_UNIT_HARD_WAIT_MS,
  STRUCTURE_UNIT_MAX_BUFFERED_UTTERANCES,
  STRUCTURE_UNIT_MAX_BUFFERED_CHARS,
  STRUCTURE_UNIT_MIN_EFFECTIVE_CHARS_FOR_COMMIT,
  STRUCTURER_BOOTSTRAP_MIN_DURATION_MS,
  STRUCTURER_BOOTSTRAP_MIN_CHAR_COUNT,
} from './assembler-types';
import type { RuntimeStateContainer } from './runtime-state';

export function resetAssemblerState(S: RuntimeStateContainer): void {
  S.pendingStructureBuffer = null;
  S.assemblerRuns = [];
  S.structureUnits = [];
}

export function appendTranscriptToWindow(
  transcript: TranscriptChunk,
  S: RuntimeStateContainer,
) {
  S.transcriptSequence += 1;
  S.transcriptWindow = [...S.transcriptWindow, transcript].slice(-STRUCTURER_WINDOW_SIZE);
}

export function getCurrentAsrTransport(S: RuntimeStateContainer) {
  return S.activeProviderConfig.asr.transport === 'ws' ? 'ws' : 'batch';
}

export function shouldHandleWithStructureUnitAssembler(
  transcript: TranscriptChunk,
  S: RuntimeStateContainer,
) {
  return (
    STRUCTURE_UNIT_ASSEMBLER_ENABLED &&
    getCurrentAsrTransport(S) === 'ws' &&
    transcript.transport === 'ws'
  );
}

export function getStructurerInvocationContextFromAssembler(
  transcript: TranscriptChunk,
  S: RuntimeStateContainer,
  notifyProviderProgress: (stage: 'asr' | 'structurer', message: string) => Promise<void>,
): {
  transcript: TranscriptChunk;
  structurerWindow: TranscriptChunk[];
  evidenceChunkIds?: string[];
} | null {
  if (!shouldHandleWithStructureUnitAssembler(transcript, S)) {
    if (
      !S.mergedGraph &&
      !hasEnoughBootstrapContext(S.transcriptWindow, getCurrentAsrTransport(S)) &&
      !shouldForceBootstrapForExternalRealtimeWindow(S.transcriptWindow, S) &&
      !shouldForceBootstrapForCompletedRealtimeInput(transcript, S.transcriptWindow, S)
    ) {
      void notifyProviderProgress(
        'structurer',
        `等待 30 秒上下文或足够长的稳定话语 (${S.transcriptWindow.length}条/${getTranscriptWindowCharCount(S.transcriptWindow)}字)`,
      );
      return null;
    }

    if (S.mergedGraph && shouldSkipIncrementalStructuring(transcript)) {
      void notifyProviderProgress(
        'structurer',
        `跳过低信息量稳定话语 (${getNormalizedTranscriptCharCount(transcript)}字)`,
      );
      return null;
    }

    return {
      transcript,
      structurerWindow: S.transcriptWindow,
    };
  }

  const lowInformationTranscript = isLowInformationTranscript(transcript);
  if (lowInformationTranscript && !S.pendingStructureBuffer) {
    if (S.mergedGraph || !shouldForceBootstrapForCompletedRealtimeInput(transcript, S.transcriptWindow, S)) {
      recordAssemblerRunDebug(S, {
        transcript,
        decision: 'skip_current',
        reason: `跳过低信息量稳定话语 (${getNormalizedTranscriptCharCount(transcript)}字)`,
      });
      void notifyProviderProgress(
        'structurer',
        `跳过低信息量稳定话语 (${getNormalizedTranscriptCharCount(transcript)}字)`,
      );
      return null;
    }
  }

  if (!lowInformationTranscript) {
    S.pendingStructureBuffer = appendToPendingStructureBuffer(S.pendingStructureBuffer, transcript);
  }

  const buffer = S.pendingStructureBuffer;
  if (!buffer) {
    return null;
  }

  const signals = deriveAssemblerSignals(buffer, transcript, S);
  const hardDecision = decideAssemblerByHardRules(transcript, buffer, signals, S);
  if (hardDecision) {
    if (hardDecision.type === 'skip_current') {
      recordAssemblerRunDebug(S, {
        transcript,
        decision: 'skip_current',
        reason: hardDecision.reason,
      });
      return null;
    }
    if (hardDecision.type === 'wait') {
      recordAssemblerRunDebug(S, {
        transcript,
        decision: 'wait',
        reason: hardDecision.reason,
      });
      void notifyProviderProgress('structurer', hardDecision.reason);
      return null;
    }
    if (hardDecision.type === 'commit') {
      return materializeAssemblerCommitContext(transcript, hardDecision.reason, S);
    }
  }

  const score = scoreAssemblerBoundary(buffer);
  const scoreDecision = decideAssemblerByScore(score);
  if (scoreDecision.type === 'wait') {
    recordAssemblerRunDebug(S, {
      transcript,
      decision: 'wait',
      reason: scoreDecision.reason,
      score,
    });
    void notifyProviderProgress('structurer', `${scoreDecision.reason} (score=${score})`);
    return null;
  }

  if (scoreDecision.type !== 'commit') {
    return null;
  }
  const commitReason = scoreDecision.reason;
  return materializeAssemblerCommitContext(transcript, commitReason, S, score);
}

export function shouldForceBootstrapForCompletedRealtimeInput(
  transcript: TranscriptChunk,
  window: TranscriptChunk[],
  S: RuntimeStateContainer,
) {
  if (getCurrentAsrTransport(S) !== 'ws' || S.mergedGraph) {
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

export function shouldForceBootstrapForExternalRealtimeWindow(
  window: TranscriptChunk[],
  S: RuntimeStateContainer,
) {
  if (getCurrentAsrTransport(S) !== 'ws' || S.mergedGraph) {
    return false;
  }

  if (S.activeProviderConfig.asr.type !== 'external') {
    return false;
  }

  return (
    window.length >= STRUCTURER_WINDOW_SIZE &&
    getEffectiveTranscriptWindowCharCount(window) > 0
  );
}

export function deriveAssemblerSignals(
  buffer: PendingStructureBuffer,
  transcript: TranscriptChunk,
  S: RuntimeStateContainer,
): AssemblerSignals {
  return {
    waitMs: Math.max(0, Date.now() - buffer.startedAt),
    hasBootstrapReadyContext: hasEnoughBootstrapContext(S.transcriptWindow, getCurrentAsrTransport(S)),
    forceBootstrapExternal: shouldForceBootstrapForExternalRealtimeWindow(S.transcriptWindow, S),
    forceBootstrapCompleted: shouldForceBootstrapForCompletedRealtimeInput(
      transcript,
      S.transcriptWindow,
      S,
    ),
    hitHardWait: Date.now() - buffer.startedAt >= STRUCTURE_UNIT_HARD_WAIT_MS,
    hitMaxBufferedUtterances:
      buffer.utterances.length >= STRUCTURE_UNIT_MAX_BUFFERED_UTTERANCES,
    hitMaxBufferedChars: buffer.effectiveChars >= STRUCTURE_UNIT_MAX_BUFFERED_CHARS,
  };
}

export function decideAssemblerByHardRules(
  transcript: TranscriptChunk,
  buffer: PendingStructureBuffer,
  signals: AssemblerSignals,
  S: RuntimeStateContainer,
): AssemblerDecision | null {
  if (signals.hitHardWait) {
    return { type: 'commit', reason: 'commit_timeout' };
  }

  if (
    transcript.finalReason === 'input_finished' ||
    transcript.finalReason === 'manual_flush'
  ) {
    return { type: 'commit', reason: 'commit_force_flush' };
  }

  if (S.mergedGraph && (signals.hitMaxBufferedUtterances || signals.hitMaxBufferedChars)) {
    return { type: 'commit', reason: 'commit_force_flush' };
  }

  if (S.mergedGraph && isMergeWithPrevCandidate(buffer)) {
    return { type: 'commit', reason: 'merge_with_prev' };
  }

  if (!S.mergedGraph) {
    if (signals.forceBootstrapExternal || signals.forceBootstrapCompleted) {
      return { type: 'commit', reason: 'commit_force_flush' };
    }

    if (!signals.hasBootstrapReadyContext) {
      return {
        type: 'wait',
        reason: `等待 30 秒上下文或足够长的稳定话语 (${S.transcriptWindow.length}条/${getTranscriptWindowCharCount(S.transcriptWindow)}字)`,
      };
    }

    if (
      getTranscriptWindowDurationMs(S.transcriptWindow) >= STRUCTURER_BOOTSTRAP_MIN_DURATION_MS ||
      getEffectiveTranscriptWindowCharCount(S.transcriptWindow) >=
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

export function materializeAssemblerCommitContext(
  transcript: TranscriptChunk,
  reason: StructureUnitCommitReason,
  S: RuntimeStateContainer,
  score?: number,
) {
  const buffer = S.pendingStructureBuffer;
  if (!buffer || buffer.utterances.length === 0) {
    return null;
  }

  S.pendingStructureBuffer = null;
  if (!S.mergedGraph || buffer.utterances.length === 1) {
    const latestTranscript = buffer.utterances[buffer.utterances.length - 1]!;
    recordAssemblerRunDebug(S, {
      transcript,
      decision: 'commit',
      reason,
      score,
    });
    return {
      transcript: latestTranscript,
      structurerWindow: S.transcriptWindow,
    };
  }

  const unit = materializeStructureUnit(buffer, reason);
  recordStructureUnitDebug(S, unit);
  recordAssemblerRunDebug(S, {
    transcript,
    decision: 'commit',
    reason,
    score,
    committedUnitId: unit.unitId,
    committedChunkIds: unit.sourceChunkIds,
    committedText: unit.text,
  });
  return {
    transcript: unit.transcript,
    structurerWindow: collapseTranscriptWindowWithStructureUnit(unit, S),
    evidenceChunkIds: unit.sourceChunkIds,
  };
}

export function recordAssemblerRunDebug(
  S: RuntimeStateContainer,
  params: {
    transcript: TranscriptChunk;
    decision: AssemblerRunDebug['decision'];
    reason: string;
    score?: number;
    committedUnitId?: string;
    committedChunkIds?: string[];
    committedText?: string;
  },
) {
  const buffer = S.pendingStructureBuffer;
  const bufferUtterances = buffer?.utterances ?? [params.transcript];
  S.assemblerRuns = [
    ...S.assemblerRuns,
    {
      sessionId: S.currentSession?.sessionId ?? params.transcript.sessionId,
      sequence: S.transcriptSequence,
      latestTranscriptId: params.transcript.chunkId,
      latestTranscriptEndMs: params.transcript.endMs,
      decision: params.decision,
      reason: params.reason,
      bufferTranscriptIds: bufferUtterances.map((item) => item.chunkId),
      bufferTranscriptCount: bufferUtterances.length,
      bufferStartMs: bufferUtterances[0]?.startMs ?? params.transcript.startMs,
      bufferEndMs: bufferUtterances[bufferUtterances.length - 1]?.endMs ?? params.transcript.endMs,
      totalCharCount:
        buffer?.totalChars ?? getNormalizedTranscriptCharCount(params.transcript),
      effectiveCharCount:
        buffer?.effectiveChars ?? getEffectiveTranscriptCharCount(params.transcript),
      waitMs: buffer ? Math.max(0, Date.now() - buffer.startedAt) : 0,
      sawTerminalPunctuation: buffer?.sawTerminalPunctuation ?? hasTerminalPunctuation(params.transcript.text),
      sawIncompleteTail: buffer?.sawIncompleteTail ?? hasIncompleteTailPattern(params.transcript.text),
      score: params.score,
      committedUnitId: params.committedUnitId,
      committedChunkIds: params.committedChunkIds,
      committedText: params.committedText,
      createdAt: Date.now(),
    },
  ].slice(-200);
}

export function recordStructureUnitDebug(
  S: RuntimeStateContainer,
  unit: StructureUnit,
) {
  S.structureUnits = [
    ...S.structureUnits,
    {
      unitId: unit.unitId,
      sessionId: S.currentSession?.sessionId ?? unit.transcript.sessionId,
      startMs: unit.startMs,
      endMs: unit.endMs,
      text: unit.text,
      sourceChunkIds: unit.sourceChunkIds,
      reason: unit.reason,
      createdAt: Date.now(),
    },
  ].slice(-100);
}

export function collapseTranscriptWindowWithStructureUnit(
  unit: StructureUnit,
  S: RuntimeStateContainer,
) {
  const collapsedPrefix = S.transcriptWindow.slice(
    0,
    Math.max(0, S.transcriptWindow.length - unit.sourceChunkIds.length),
  );
  return [...collapsedPrefix, unit.transcript];
}

export function getAssemblerRunsForDebugSession(
  sessionId: string,
  S: RuntimeStateContainer,
) {
  return S.assemblerRuns
    .filter((run) => run.sessionId === sessionId)
    .sort((a, b) => a.latestTranscriptEndMs - b.latestTranscriptEndMs || a.createdAt - b.createdAt);
}

export function getStructureUnitsForDebugSession(
  sessionId: string,
  S: RuntimeStateContainer,
) {
  return S.structureUnits
    .filter((unit) => unit.sessionId === sessionId)
    .sort((a, b) => a.endMs - b.endMs || a.createdAt - b.createdAt);
}

export async function flushPendingStructureBuffer(
  S: RuntimeStateContainer,
  reason: StructureUnitCommitReason,
  runStructurerForTranscriptContext: (params: {
    chunkSessionId: string;
    transcript: TranscriptChunk;
    structurerWindow: TranscriptChunk[];
    evidenceChunkIds?: string[];
  }) => Promise<{ success: boolean; error?: string; [key: string]: any }>,
): Promise<{ success: boolean; error?: string; [key: string]: any } | null> {
  if (!S.pendingStructureBuffer || !S.currentSession) {
    return null;
  }

  if (S.pendingStructureBuffer.effectiveChars <= 0) {
    S.pendingStructureBuffer = null;
    return { success: true };
  }

  const latestTranscript =
    S.pendingStructureBuffer.utterances[S.pendingStructureBuffer.utterances.length - 1]!;
  const context = materializeAssemblerCommitContext(latestTranscript, reason, S);
  if (!context) {
    return { success: true };
  }

  return await runStructurerForTranscriptContext({
    chunkSessionId: S.currentSession.sessionId,
    transcript: context.transcript,
    structurerWindow: context.structurerWindow,
    evidenceChunkIds: context.evidenceChunkIds,
  });
}
