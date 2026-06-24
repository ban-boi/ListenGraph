import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  SegmentGraph,
  StructurerProvider,
  TranscriptChunk,
} from '@listen-graphic/schema';
import type { LocalAsrEvent } from '@listen-graphic/asr-runtime';
import { DesktopTranscriptPipeline } from './desktop-transcript-pipeline';

function segment(segmentId: string, text: string): SegmentGraph {
  return {
    segmentId,
    sessionId: 'desktop-1',
    startMs: 0,
    endMs: 1000,
    provider: 'test',
    edges: [],
    nodes: [
      {
        id: `node-${segmentId}`,
        type: 'claim',
        text,
        timestampMs: 0,
        status: 'confirmed',
        evidenceChunkIds: [`chunk-${segmentId}`],
      },
    ],
  };
}

function partialEvent(utteranceId: string, text: string): LocalAsrEvent {
  return {
    type: 'transcript.partial',
    raw: {},
    utterance: { utteranceId, revision: 1, text, startMs: 0, endMs: 400 },
  };
}

function finalEvent(
  utteranceId: string,
  text: string,
  startMs: number,
  endMs: number,
): LocalAsrEvent {
  return {
    type: 'transcript.final',
    raw: {},
    utterance: {
      utteranceId,
      revision: 2,
      text,
      startMs,
      endMs,
      finalReason: 'endpoint',
      stability: 'stable',
    },
  };
}

function makeStructurer(): StructurerProvider & {
  extractSegmentGraph: ReturnType<typeof vi.fn>;
} {
  const extractSegmentGraph = vi.fn(
    async (): Promise<SegmentGraph> => segment('seg-fallback', '占位'),
  );
  return {
    name: 'test',
    reset() {},
    extractSegmentGraph,
  } as unknown as StructurerProvider & {
    extractSegmentGraph: ReturnType<typeof vi.fn>;
  };
}

describe('DesktopTranscriptPipeline', () => {
  let onGraph: ReturnType<typeof vi.fn>;
  let onError: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onGraph = vi.fn();
    onError = vi.fn();
  });

  it('忽略 partial，按顺序串行化 final 转写图谱更新', async () => {
    const structurer = makeStructurer();
    structurer.extractSegmentGraph
      .mockResolvedValueOnce(segment('seg-1', '第一句'))
      .mockResolvedValueOnce(segment('seg-2', '第二句'));

    const pipeline = new DesktopTranscriptPipeline({
      sessionId: 'desktop-1',
      structurer,
      onGraph,
      onError,
    });

    pipeline.accept(partialEvent('utt-1', '第一'));
    pipeline.accept(finalEvent('utt-1', '第一句', 0, 800));
    pipeline.accept(finalEvent('utt-2', '第二句', 900, 1600));
    await pipeline.drain();

    expect(structurer.extractSegmentGraph).toHaveBeenCalledTimes(2);
    expect(onGraph).toHaveBeenCalledTimes(2);
    expect(onGraph.mock.calls.at(-1)?.[0].nodes.map((n: { text: string }) => n.text)).toEqual([
      '第一句',
      '第二句',
    ]);
  });

  it('忽略重复的 (utteranceId, revision) final', async () => {
    const structurer = makeStructurer();
    structurer.extractSegmentGraph.mockResolvedValue(segment('seg-1', '唯一句'));

    const pipeline = new DesktopTranscriptPipeline({
      sessionId: 'desktop-1',
      structurer,
      onGraph,
      onError,
    });

    pipeline.accept(finalEvent('utt-1', '第一句', 0, 800));
    pipeline.accept(finalEvent('utt-1', '第一句', 0, 800));
    await pipeline.drain();

    expect(structurer.extractSegmentGraph).toHaveBeenCalledTimes(1);
  });

  it('structurer 拒绝时回调 onError，且不破坏既有图谱', async () => {
    const structurer = makeStructurer();
    structurer.extractSegmentGraph
      .mockResolvedValueOnce(segment('seg-1', '好句'))
      .mockRejectedValueOnce(new Error('结构化失败'));

    const pipeline = new DesktopTranscriptPipeline({
      sessionId: 'desktop-1',
      structurer,
      onGraph,
      onError,
    });

    pipeline.accept(finalEvent('utt-1', '好句', 0, 800));
    pipeline.accept(finalEvent('utt-2', '坏句', 900, 1600));
    await pipeline.drain();

    expect(onError).toHaveBeenCalledTimes(1);
    // 上一次成功的图谱仍保留，未被失败破坏。
    expect(onGraph.mock.calls.at(-1)?.[0].nodes.map((n: { text: string }) => n.text)).toEqual([
      '好句',
    ]);
  });

  it('以会话 ID 初始化空图谱（revision 0）', () => {
    const structurer = makeStructurer();
    const pipeline = new DesktopTranscriptPipeline({
      sessionId: 'desktop-1',
      structurer,
      onGraph,
      onError,
    });
    // 初始不应产生图谱回调，直到首个 final 到来。
    expect(onGraph).not.toHaveBeenCalled();
  });

  it('transcriptWindow 传递正确的 TranscriptChunk（含 chunkId）', async () => {
    const structurer = makeStructurer();
    structurer.extractSegmentGraph.mockResolvedValue(segment('seg-1', '文本'));

    const pipeline = new DesktopTranscriptPipeline({
      sessionId: 'desktop-1',
      structurer,
      onGraph,
      onError,
    });

    pipeline.accept(finalEvent('utt-7', '文本', 0, 500));
    await pipeline.drain();

    const callArg = structurer.extractSegmentGraph.mock.calls[0][0] as {
      transcriptWindow: TranscriptChunk[];
    };
    expect(callArg.transcriptWindow).toHaveLength(1);
    expect(callArg.transcriptWindow[0]).toMatchObject({
      sessionId: 'desktop-1',
      utteranceId: 'utt-7',
      text: '文本',
      kind: 'final',
    });
    expect(callArg.transcriptWindow[0].chunkId).toContain('utt-7');
  });
});
