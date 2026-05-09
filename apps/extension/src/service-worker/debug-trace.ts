import type { SegmentGraph } from '@listen-graphic/schema';
import type { StructurerRunDebug } from '../shared/messages';

// ===== Structurer 运行调试（纯函数） =====

export function createStructurerRunDebug(params: {
  sessionId: string;
  sequence: number;
  transcript: import('@listen-graphic/schema').TranscriptChunk;
  transcriptWindow: import('@listen-graphic/schema').TranscriptChunk[];
  previousGraph: import('@listen-graphic/schema').MergedGraph | null;
}): Omit<StructurerRunDebug, 'completedAt' | 'durationMs' | 'status'> {
  return {
    sessionId: params.sessionId,
    sequence: params.sequence,
    mode: params.previousGraph ? 'incremental' : 'bootstrap',
    transcriptEndMs: params.transcript.endMs,
    latestTranscriptId: params.transcript.chunkId,
    latestChunkId: params.transcript.chunkId,
    windowStartMs: params.transcriptWindow[0]?.startMs ?? params.transcript.startMs,
    windowEndMs:
      params.transcriptWindow[params.transcriptWindow.length - 1]?.endMs ?? params.transcript.endMs,
    windowTranscriptCount: params.transcriptWindow.length,
    windowChunkCount: params.transcriptWindow.length,
    windowCharCount: params.transcriptWindow.reduce((sum, chunk) => sum + chunk.text.length, 0),
    latestTranscriptCharCount: params.transcript.text.length,
    latestChunkCharCount: params.transcript.text.length,
    recentNodeCount: params.previousGraph?.nodes.length ?? 0,
    recentEdgeCount: params.previousGraph?.edges.length ?? 0,
    startedAt: Date.now(),
  };
}

export function finalizeStructurerRunDebug(
  run: Omit<StructurerRunDebug, 'completedAt' | 'durationMs' | 'status'>,
  result: Pick<
    StructurerRunDebug,
    | 'status'
    | 'segmentId'
    | 'topic'
    | 'nodeCount'
    | 'edgeCount'
    | 'fallbackUsed'
    | 'errorCode'
    | 'errorMessage'
    | 'structurerDiagnostics'
  >,
): StructurerRunDebug {
  const completedAt = Date.now();
  return {
    ...run,
    ...result,
    completedAt,
    durationMs: completedAt - run.startedAt,
  };
}

export function attachStructurerRunDebug(segment: SegmentGraph, run: StructurerRunDebug): SegmentGraph {
  return {
    ...segment,
    raw: {
      providerResponse: segment.raw,
      debug: run,
    },
  };
}

export function readStructurerRunDebug(segment: SegmentGraph): StructurerRunDebug | null {
  if (!segment.raw || typeof segment.raw !== 'object') {
    return null;
  }

  const debug = (segment.raw as { debug?: Partial<StructurerRunDebug> }).debug;
  if (!debug) {
    return null;
  }

  return {
    ...debug,
    latestTranscriptId: debug.latestTranscriptId ?? debug.latestChunkId ?? '',
    latestChunkId: debug.latestChunkId ?? debug.latestTranscriptId ?? '',
    windowTranscriptCount: debug.windowTranscriptCount ?? debug.windowChunkCount ?? 0,
    windowChunkCount: debug.windowChunkCount ?? debug.windowTranscriptCount ?? 0,
    latestTranscriptCharCount:
      debug.latestTranscriptCharCount ?? debug.latestChunkCharCount ?? 0,
    latestChunkCharCount:
      debug.latestChunkCharCount ?? debug.latestTranscriptCharCount ?? 0,
  } as StructurerRunDebug;
}
