import type {
  ViewType,
  MergedGraph,
  ProviderRuntimeSummary,
} from '@listen-graphic/schema';
import type {
  DebugSessionData,
  SessionState,
  AssemblerRunDebug,
  StructureUnitDebug,
  StructurerRunDebug,
} from '../shared/messages';
import { BUILD_INFO } from '../shared/build-info';
import type {
  DebugViewArtifact,
  DebugExportMode,
} from './types';
import type { AutoTourTraceEvent } from './auto-tour-trace';

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

// 扩展点：未来 slim 模式可裁剪字段，当前全量透传
export function summarizeAssemblerRun(
  run: AssemblerRunDebug,
  _mode: DebugExportMode,
) {
  return run;
}

// 扩展点：同上
export function summarizeStructureUnit(
  unit: StructureUnitDebug,
  _mode: DebugExportMode,
) {
  return unit;
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
      assemblerRun: trace.assemblerRun
        ? summarizeAssemblerRun(trace.assemblerRun, mode)
        : null,
      mergedGraphAfter: trace.mergedGraphAfter,
    })),
    structurerRuns: (debugData.structurerRuns ?? []).map((run) =>
      summarizeStructurerRun(run, mode),
    ),
    assemblerRuns: (debugData.assemblerRuns ?? []).map((run) =>
      summarizeAssemblerRun(run, mode),
    ),
    structureUnits: (debugData.structureUnits ?? []).map((unit) =>
      summarizeStructureUnit(unit, mode),
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
  autoTourTrace?: AutoTourTraceEvent[];
  debugData: DebugSessionData | null;
  derivedViews: Record<ViewType, DebugViewArtifact>;
}) {
  const debugData = summarizeDebugData(params.debugData, params.mode);

  return {
    // 导出格式版本——变更时需同步更新消费端解析逻辑
    schemaVersion: 2,
    meta: {
      exportedAt: new Date().toISOString(),
      mode: params.mode,
    },
    session: {
      sessionId: debugData?.session?.sessionId ?? params.sessionId,
      state: params.sessionState,
      record: debugData?.session ?? null,
    },
    runtime: {
      currentView: params.currentView,
      builds: {
        ui: BUILD_INFO,
        worker: {
          label: params.workerBuildLabel,
        },
      },
      // 优先使用 debugData 中的运行时 provider 信息，回退到调用方传入的快照
      providerSummary: debugData?.providerSummary ?? params.providerSummary,
      lastProviderError: debugData?.lastProviderError ?? null,
    },
    data: {
      transcripts: debugData?.transcripts ?? [],
      segments: debugData?.segments ?? [],
      traces: debugData?.traces ?? [],
      graph: debugData?.graph ?? null,
      structurerRuns: debugData?.structurerRuns ?? [],
      assemblerRuns: debugData?.assemblerRuns ?? [],
      structureUnits: debugData?.structureUnits ?? [],
      traceSource: debugData?.traceSource ?? 'empty',
    },
    ui: {
      logs: params.mode === 'full' ? params.logs : params.logs.slice(0, 20),
      autoTourTrace: params.mode === 'full'
        ? params.autoTourTrace ?? []
        : (params.autoTourTrace ?? []).slice(-50),
      derivedViews: params.derivedViews,
    },
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

// ===== Assembler Decision Log 导出 =====

export interface AssemblerDecisionLogRun {
  seq: number;
  triggerText: string;
  decision: 'skip_current' | 'wait' | 'commit';
  reason: string;
  score: number | null;
}

export interface AssemblerDecisionLogUnit {
  text: string;
  reason: string;
}

export interface AssemblerDecisionLogExport {
  schemaVersion: 1;
  meta: {
    exportedAt: string;
    sessionId: string;
    traceSource: 'memory' | 'indexeddb' | 'empty';
  };
  summary: {
    totalRuns: number;
    decisions: Record<string, number>;
    totalUnits: number;
    commitReasons: Record<string, number>;
  };
  runs: AssemblerDecisionLogRun[];
  units: AssemblerDecisionLogUnit[];
}

export function buildAssemblerLogPayload(params: {
  assemblerRuns: AssemblerRunDebug[];
  structureUnits: StructureUnitDebug[];
  sessionId: string;
  traceSource: 'memory' | 'indexeddb' | 'empty';
}): AssemblerDecisionLogExport {
  const { assemblerRuns, structureUnits, sessionId, traceSource } = params;

  const runs: AssemblerDecisionLogRun[] = assemblerRuns.map((run) => ({
    seq: run.sequence,
    triggerText: run.latestTranscriptText ?? '',
    decision: run.decision,
    reason: run.reason,
    score: run.score ?? null,
  }));

  const units: AssemblerDecisionLogUnit[] = structureUnits.map((unit) => ({
    text: unit.text,
    reason: unit.reason,
  }));

  const decisions: Record<string, number> = {};
  for (const run of assemblerRuns) {
    decisions[run.decision] = (decisions[run.decision] ?? 0) + 1;
  }

  const commitReasons: Record<string, number> = {};
  for (const run of assemblerRuns) {
    if (run.decision === 'commit') {
      commitReasons[run.reason] = (commitReasons[run.reason] ?? 0) + 1;
    }
  }

  return {
    schemaVersion: 1,
    meta: {
      exportedAt: new Date().toISOString(),
      sessionId,
      traceSource,
    },
    summary: {
      totalRuns: assemblerRuns.length,
      decisions,
      totalUnits: structureUnits.length,
      commitReasons,
    },
    runs,
    units,
  };
}
