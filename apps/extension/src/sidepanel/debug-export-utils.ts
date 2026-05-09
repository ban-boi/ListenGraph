import type {
  ViewType,
  MergedGraph,
  ProviderRuntimeSummary,
} from '@listen-graphic/schema';
import type {
  DebugSessionData,
  SessionState,
  StructurerRunDebug,
} from '../shared/messages';
import { BUILD_INFO } from '../shared/build-info';
import type {
  DebugViewArtifact,
  DebugExportMode,
} from './types';

export function summarizeTranscriptUnit(
  transcript: DebugSessionData['transcripts'][number],
  mode: DebugExportMode,
) {
  if (mode === 'full') {
    return transcript;
  }

  return {
    chunkId: transcript.chunkId,
    sessionId: transcript.sessionId,
    text: transcript.text,
    startMs: transcript.startMs,
    endMs: transcript.endMs,
    provider: transcript.provider,
    confidence: transcript.confidence,
    speakerHints: transcript.speakerHints,
    tokenCount: transcript.tokens?.length ?? 0,
    hasRaw: transcript.raw !== undefined,
  };
}

export function summarizeSegment(
  segment: DebugSessionData['segments'][number],
  mode: DebugExportMode,
) {
  if (mode === 'full') {
    return segment;
  }

  return {
    segmentId: segment.segmentId,
    sessionId: segment.sessionId,
    startMs: segment.startMs,
    endMs: segment.endMs,
    topic: segment.topic,
    provider: segment.provider,
    nodes: segment.nodes,
    edges: segment.edges,
    structurerDebug: readStructurerRunDebug(segment),
    hasRaw: segment.raw !== undefined,
  };
}

export function summarizeStructurerRun(
  run: StructurerRunDebug,
  _mode: DebugExportMode,
) {
  return run;
}

export function summarizeDebugData(
  debugData: DebugSessionData | null,
  mode: DebugExportMode,
) {
  if (!debugData) {
    return null;
  }

  if (mode === 'full') {
    return debugData;
  }

  return {
    ...debugData,
    transcripts: debugData.transcripts.map((transcript) =>
      summarizeTranscriptUnit(transcript, mode),
    ),
    segments: debugData.segments.map((segment) =>
      summarizeSegment(segment, mode),
    ),
    traces: debugData.traces.map((trace) => ({
      sequence: trace.sequence,
      transcript: summarizeTranscriptUnit(trace.transcript, mode),
      transcriptWindow: trace.transcriptWindow.map((transcript) =>
        summarizeTranscriptUnit(transcript, mode),
      ),
      segment: trace.segment ? summarizeSegment(trace.segment, mode) : null,
      structurerRun: trace.structurerRun
        ? summarizeStructurerRun(trace.structurerRun, mode)
        : null,
      mergedGraphAfter: trace.mergedGraphAfter,
    })),
    structurerRuns: (debugData.structurerRuns ?? []).map((run) =>
      summarizeStructurerRun(run, mode),
    ),
  };
}

export function buildDebugExportPayload(params: {
  mode: DebugExportMode;
  sessionId: string | null;
  sessionState: SessionState;
  currentView: ViewType;
  workerBuildLabel: string;
  providerSummary: ProviderRuntimeSummary;
  logs: string[];
  debugData: DebugSessionData | null;
  derivedViews: Record<ViewType, DebugViewArtifact>;
}) {
  return {
    exportedAt: new Date().toISOString(),
    exportMode: params.mode,
    sessionId: params.sessionId,
    sessionState: params.sessionState,
    currentView: params.currentView,
    uiBuild: BUILD_INFO,
    workerBuildLabel: params.workerBuildLabel,
    providerSummary: params.providerSummary,
    logCount: params.logs.length,
    logs: params.mode === 'full' ? params.logs : params.logs.slice(0, 20),
    debugData: summarizeDebugData(params.debugData, params.mode),
    derivedViews: params.derivedViews,
  };
}

export function readStructurerRunDebug(segment: DebugSessionData['segments'][number]) {
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

export function downloadTextFile(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function formatGraphDeltaLog(previousGraph: MergedGraph | null, nextGraph: MergedGraph) {
  const previousNodeIds = new Set(previousGraph?.nodes.map((node) => node.id) ?? []);
  const previousEdgeIds = new Set(previousGraph?.edges.map((edge) => edge.id) ?? []);
  const addedNodeCount = nextGraph.nodes.filter((node) => !previousNodeIds.has(node.id)).length;
  const addedEdgeCount = nextGraph.edges.filter((edge) => !previousEdgeIds.has(edge.id)).length;

  if (addedNodeCount === 0 && addedEdgeCount === 0) {
    return `图更新: 无新增节点/连线 | 当前 ${nextGraph.nodes.length} 节点, ${nextGraph.edges.length} 边`;
  }

  if (addedNodeCount === 0) {
    return `图更新: 仅新增连线 +${addedEdgeCount} | 当前 ${nextGraph.nodes.length} 节点, ${nextGraph.edges.length} 边`;
  }

  if (addedEdgeCount === 0) {
    return `图更新: 新增节点 +${addedNodeCount} | 当前 ${nextGraph.nodes.length} 节点, ${nextGraph.edges.length} 边`;
  }

  return `图更新: +${addedNodeCount} 节点, +${addedEdgeCount} 连线 | 当前 ${nextGraph.nodes.length} 节点, ${nextGraph.edges.length} 边`;
}
