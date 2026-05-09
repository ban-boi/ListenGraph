import { mergeSegmentGraph, pickDefaultView, scoreViews, stabilizeGraph } from '@listen-graphic/domain';
import { generateId } from '@listen-graphic/shared-utils';
import type { MergedGraph, SegmentGraph } from '@listen-graphic/schema';
import type { AssemblerRunDebug, DebugSessionData, StructurerRunDebug } from '../shared/messages';
import type { TranscriptChunk } from '@listen-graphic/schema';

// ===== 图谱合并与主题合并（纯函数） =====

export function mergeTopics(graph: MergedGraph, segment: SegmentGraph): MergedGraph {
  const hasSameTopic =
    segment.topic &&
    graph.topics.some((topic) => topic.title === segment.topic);

  if (!segment.topic || hasSameTopic) {
    return {
      ...graph,
      topics: graph.topics.map((topic, index) =>
        index === graph.topics.length - 1
          ? { ...topic, endMs: Math.max(topic.endMs, segment.endMs) }
          : topic,
      ),
    };
  }

  return {
    ...graph,
    topics: [
      ...graph.topics,
      {
        topicId: generateId('topic'),
        title: segment.topic,
        startMs: segment.startMs,
        endMs: segment.endMs,
      },
    ],
  };
}

export function buildMergedGraphFromState(
  previousGraph: MergedGraph | null,
  segment: SegmentGraph,
): MergedGraph {
  const baseGraph =
    previousGraph === null
      ? {
          sessionId: segment.sessionId,
          revision: 1,
          topics: segment.topic
            ? [
                {
                  topicId: generateId('topic'),
                  title: segment.topic,
                  startMs: segment.startMs,
                  endMs: segment.endMs,
                },
              ]
            : [],
          nodes: segment.nodes,
          edges: segment.edges,
          updatedAt: Date.now(),
        }
      : mergeSegmentGraph(mergeTopics(previousGraph, segment), segment);

  const stabilizedGraph = stabilizeGraph(baseGraph);
  const scores = scoreViews(stabilizedGraph);
  const defaultView = pickDefaultView(stabilizedGraph);

  return {
    ...stabilizedGraph,
    topics: mergeTopics(stabilizedGraph, segment).topics,
    viewHints: {
      defaultView,
      scores,
    },
    updatedAt: Date.now(),
  };
}

// ===== 调试追踪构建（纯函数） =====

export function buildDebugTranscriptTraces(
  transcripts: TranscriptChunk[],
  segments: SegmentGraph[],
  structurerRuns: StructurerRunDebug[],
  assemblerRuns: AssemblerRunDebug[],
): DebugSessionData['traces'] {
  const remainingSegments = [...segments].sort(
    (a, b) => a.startMs - b.startMs || a.endMs - b.endMs,
  );
  const remainingRuns = [...structurerRuns].sort(
    (a, b) => a.transcriptEndMs - b.transcriptEndMs || a.startedAt - b.startedAt,
  );
  let mergedAfter: MergedGraph | null = null;

  return transcripts.map((transcript, index) => {
    const transcriptWindow = transcripts.slice(Math.max(0, index - 2), index + 1);
    const matchedSegmentIndex = remainingSegments.findIndex(
      (segment) =>
        segment.endMs === transcript.endMs,
    );
    const segment =
      matchedSegmentIndex >= 0
        ? remainingSegments.splice(matchedSegmentIndex, 1)[0]
        : null;
    const matchedRunIndex = remainingRuns.findIndex(
      (run) => run.transcriptEndMs === transcript.endMs,
    );
    const structurerRun =
      matchedRunIndex >= 0
        ? remainingRuns.splice(matchedRunIndex, 1)[0]
        : null;
    const assemblerRun =
      assemblerRuns.find(
        (run) =>
          run.latestTranscriptId === transcript.chunkId ||
          run.latestTranscriptEndMs === transcript.endMs,
      ) ?? null;

    if (segment) {
      mergedAfter = buildMergedGraphFromState(mergedAfter, segment);
    }

    return {
      sequence: index + 1,
      transcript,
      transcriptWindow,
      segment,
      structurerRun,
      assemblerRun,
      mergedGraphAfter: mergedAfter,
    };
  });
}
