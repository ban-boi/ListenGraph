import type { TranscriptChunk, SegmentGraph } from '@listen-graphic/schema';
import { generateId } from '@listen-graphic/shared-utils';
import {
  STRUCTURER_WINDOW_SIZE,
  STRUCTURER_BOOTSTRAP_MIN_CHUNKS,
  STRUCTURER_BOOTSTRAP_MIN_DURATION_MS,
  STRUCTURER_BOOTSTRAP_MIN_CHAR_COUNT,
  STRUCTURE_UNIT_SOFT_WAIT_MS,
  STRUCTURE_UNIT_HARD_WAIT_MS,
  STRUCTURE_UNIT_MIN_EFFECTIVE_CHARS_FOR_COMMIT,
  STRUCTURE_UNIT_MAX_BUFFERED_UTTERANCES,
  STRUCTURE_UNIT_MAX_BUFFERED_CHARS,
  STRUCTURE_UNIT_SCORE_COMMIT_THRESHOLD,
  STRUCTURE_UNIT_SCORE_WAIT_THRESHOLD,
  SCORE_BONUS_CHAR_THRESHOLD,
  SCORE_PENALTY_CHAR_THRESHOLD,
  SCORE_BONUS_UTTERANCE_MIN,
  INCOMPLETE_UTTERANCE_CHAR_LIMIT,
  COMPLETION_AFTER_PREV_CHAR_LIMIT,
  type PendingStructureBuffer,
  type StructureUnit,
  type StructureUnitCommitReason,
  type AssemblerSignals,
  type AssemblerDecision,
} from './assembler-types';

// ===== Bootstrap 上下文判断 =====

export function hasEnoughBootstrapContext(
  window: TranscriptChunk[],
  asrTransport: 'ws' | 'batch',
) {
  if (asrTransport === 'ws') {
    return hasEnoughRealtimeBootstrapContext(window);
  }

  return hasEnoughBatchBootstrapContext(window);
}

export function hasEnoughBatchBootstrapContext(window: TranscriptChunk[]) {
  if (window.length >= STRUCTURER_WINDOW_SIZE) {
    return true;
  }

  if (window.length < STRUCTURER_BOOTSTRAP_MIN_CHUNKS) {
    return false;
  }

  return (
    getTranscriptWindowDurationMs(window) >= STRUCTURER_BOOTSTRAP_MIN_DURATION_MS ||
    getTranscriptWindowCharCount(window) >= STRUCTURER_BOOTSTRAP_MIN_CHAR_COUNT
  );
}

export function hasEnoughRealtimeBootstrapContext(window: TranscriptChunk[]) {
  if (window.length < STRUCTURER_BOOTSTRAP_MIN_CHUNKS) {
    return false;
  }

  return (
    getTranscriptWindowDurationMs(window) >= STRUCTURER_BOOTSTRAP_MIN_DURATION_MS ||
    getEffectiveTranscriptWindowCharCount(window) >= STRUCTURER_BOOTSTRAP_MIN_CHAR_COUNT
  );
}

// ===== Transcript 窗口辅助 =====

export function getTranscriptWindowDurationMs(window: TranscriptChunk[]) {
  if (window.length === 0) {
    return 0;
  }

  return Math.max(0, (window[window.length - 1]?.endMs ?? 0) - (window[0]?.startMs ?? 0));
}

export function getTranscriptWindowCharCount(window: TranscriptChunk[]) {
  return window.reduce((sum, chunk) => sum + chunk.text.length, 0);
}

export function getEffectiveTranscriptWindowCharCount(window: TranscriptChunk[]) {
  return window.reduce((sum, chunk) => sum + getEffectiveTranscriptCharCount(chunk), 0);
}

// ===== Transcript 特征判断 =====

export function shouldSkipIncrementalStructuring(transcript: TranscriptChunk) {
  return isLowInformationTranscript(transcript);
}

export function getNormalizedTranscriptCharCount(transcript: TranscriptChunk) {
  return transcript.text.replace(/\s+/g, '').trim().length;
}

export function getEffectiveTranscriptCharCount(transcript: TranscriptChunk) {
  return isLowInformationTranscript(transcript) ? 0 : getNormalizedTranscriptCharCount(transcript);
}

export function isLowInformationTranscript(transcript: TranscriptChunk) {
  const normalizedText = transcript.text.replace(/\s+/g, '').trim();
  return (
    /声音[。！？]?$/u.test(normalizedText) ||
    /^(掌声|谢谢|欢迎|好的|好吧|嗯|啊|诶|哎)[。！？]?$/u.test(normalizedText)
  );
}

// ===== Pending Buffer 操作（纯函数，返回新对象） =====

export function appendToPendingStructureBuffer(
  buffer: PendingStructureBuffer | null,
  transcript: TranscriptChunk,
): PendingStructureBuffer {
  const utterances = [...(buffer?.utterances ?? []), transcript].slice(
    -STRUCTURE_UNIT_MAX_BUFFERED_UTTERANCES,
  );
  const startedAt = buffer?.startedAt ?? Date.now();
  return createPendingStructureBuffer(utterances, startedAt);
}

export function createPendingStructureBuffer(
  utterances: TranscriptChunk[],
  startedAt = Date.now(),
): PendingStructureBuffer {
  const combinedText = utterances.map((item) => item.text).join('\n');
  return {
    utterances,
    startedAt,
    updatedAt: Date.now(),
    totalChars: utterances.reduce((sum, item) => sum + getNormalizedTranscriptCharCount(item), 0),
    effectiveChars: utterances.reduce((sum, item) => sum + getEffectiveTranscriptCharCount(item), 0),
    sawTerminalPunctuation: hasTerminalPunctuation(combinedText),
    sawIncompleteTail: hasIncompleteTailPattern(combinedText),
  };
}

// ===== 汇编器评分与决策 =====

export function decideAssemblerByScore(score: number): AssemblerDecision {
  if (score >= STRUCTURE_UNIT_SCORE_COMMIT_THRESHOLD) {
    return { type: 'commit', reason: 'commit_score', score };
  }

  if (score <= STRUCTURE_UNIT_SCORE_WAIT_THRESHOLD) {
    return { type: 'wait', reason: '等待更多上下文', score };
  }

  return { type: 'wait', reason: '边界不确定，继续等待', score };
}

export function scoreAssemblerBoundary(buffer: PendingStructureBuffer) {
  let score = 0;

  if (buffer.effectiveChars >= STRUCTURE_UNIT_MIN_EFFECTIVE_CHARS_FOR_COMMIT) score += 2;
  if (buffer.effectiveChars >= SCORE_BONUS_CHAR_THRESHOLD) score += 1;
  if (buffer.sawTerminalPunctuation) score += 2;
  if (buffer.utterances.length >= SCORE_BONUS_UTTERANCE_MIN) score += 1;
  if (Date.now() - buffer.startedAt >= STRUCTURE_UNIT_SOFT_WAIT_MS) score += 1;

  if (buffer.sawIncompleteTail) score -= 1;
  if (buffer.effectiveChars <= SCORE_PENALTY_CHAR_THRESHOLD) score -= 2;
  if (buffer.utterances.length === 1 && !buffer.sawTerminalPunctuation) score -= 1;

  return score;
}

// ===== Merge-with-prev 判断 =====

export function isMergeWithPrevCandidate(buffer: PendingStructureBuffer) {
  if (buffer.utterances.length < 2) {
    return false;
  }

  const previous = buffer.utterances[buffer.utterances.length - 2]!;
  const current = buffer.utterances[buffer.utterances.length - 1]!;
  return (
    looksLikeIncompleteUtterance(previous) &&
    looksLikeCompletionAfterPrevious(previous, current)
  );
}

export function looksLikeIncompleteUtterance(transcript: TranscriptChunk) {
  if (
    isLowInformationTranscript(transcript) ||
    hasTerminalPunctuation(transcript.text) ||
    getEffectiveTranscriptCharCount(transcript) < INCOMPLETE_UTTERANCE_CHAR_LIMIT
  ) {
    return false;
  }

  return hasIncompleteTailPattern(transcript.text) || hasWeakSetupTailPattern(transcript.text);
}

export function looksLikeCompletionAfterPrevious(
  previous: TranscriptChunk,
  current: TranscriptChunk,
) {
  if (
    isLowInformationTranscript(current) ||
    getEffectiveTranscriptCharCount(current) < COMPLETION_AFTER_PREV_CHAR_LIMIT
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

// ===== Structure Unit 物化 =====

export function materializeStructureUnit(
  buffer: PendingStructureBuffer,
  reason: StructureUnitCommitReason,
): StructureUnit {
  const sourceChunkIds = buffer.utterances.map((item) => item.chunkId);
  const firstTranscript = buffer.utterances[0]!;
  const latestTranscript = buffer.utterances[buffer.utterances.length - 1]!;
  const text = buffer.utterances
    .map((item) => item.text.trim())
    .filter(Boolean)
    .join('\n');
  const transcript: TranscriptChunk = {
    ...latestTranscript,
    chunkId: generateId('structure_unit'),
    text,
    startMs: firstTranscript.startMs,
    endMs: latestTranscript.endMs,
    raw: {
      type: 'structure-unit',
      sourceChunkIds,
      reason,
    },
  };

  return {
    unitId: transcript.chunkId,
    sourceChunkIds,
    startMs: transcript.startMs,
    endMs: transcript.endMs,
    text,
    reason,
    transcript,
  };
}

// ===== Evidence Chunk ID 展开 =====

export function expandSegmentEvidenceChunkIds(
  segment: SegmentGraph,
  structureUnitChunkId: string,
  sourceChunkIds: string[],
): SegmentGraph {
  const expandEvidenceIds = (evidenceChunkIds?: string[]) => {
    if (!evidenceChunkIds?.includes(structureUnitChunkId)) {
      return evidenceChunkIds;
    }

    return [...new Set(evidenceChunkIds.flatMap((chunkId) => (
      chunkId === structureUnitChunkId ? sourceChunkIds : [chunkId]
    )))];
  };

  return {
    ...segment,
    nodes: segment.nodes.map((node) => ({
      ...node,
      evidenceChunkIds: expandEvidenceIds(node.evidenceChunkIds),
    })),
    edges: segment.edges.map((edge) => ({
      ...edge,
      evidenceChunkIds: expandEvidenceIds(edge.evidenceChunkIds),
    })),
  };
}

// ===== 文本分析辅助 =====

export function normalizeAssemblerText(text: string) {
  return text.replace(/\s+/g, ' ').trim();
}

export function hasTerminalPunctuation(text: string) {
  return /[。！？.!?]$/u.test(normalizeAssemblerText(text));
}

export function hasIncompleteTailPattern(text: string) {
  const normalized = normalizeAssemblerText(text);
  if (!normalized || hasTerminalPunctuation(normalized)) {
    return false;
  }

  return INCOMPLETE_TAIL_RE.test(normalized);
}

export function hasWeakSetupTailPattern(text: string) {
  const normalized = normalizeAssemblerText(text);
  if (!normalized || hasTerminalPunctuation(normalized)) {
    return false;
  }

  return WEAK_SETUP_TAIL_RE.test(normalized);
}

const INCOMPLETE_TAIL_RE = /(因为|所以|但是|然后|就是|我觉得|我的意思是|这个问题|问题在于)$/u;
const WEAK_SETUP_TAIL_RE = /(在于|核心是|原因是|关键是|比如说|也就是说)$/u;
