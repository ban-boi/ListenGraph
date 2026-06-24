// 桌面端转写→图谱管道：消费 LocalAsrEvent，仅处理 final 转写，
// 串行调用 structurer 并用 mergeSegmentGraph 合并，产出递增的 MergedGraph。
// 替代桌面端原本 timer 驱动的 mock 图谱。

import type { LocalAsrEvent } from '@listen-graphic/asr-runtime';
import { mergeSegmentGraph } from '@listen-graphic/domain';
import type {
  MergedGraph,
  SegmentGraph,
  StructurerProvider,
  TranscriptChunk,
} from '@listen-graphic/schema';

export interface DesktopTranscriptPipelineOptions {
  sessionId: string;
  structurer: StructurerProvider;
  onGraph: (graph: MergedGraph) => void;
  onError: (error: Error) => void;
  language?: string;
}

function createEmptyGraph(sessionId: string): MergedGraph {
  return {
    sessionId,
    revision: 0,
    topics: [],
    nodes: [],
    edges: [],
    updatedAt: Date.now(),
  };
}

export class DesktopTranscriptPipeline {
  private graph: MergedGraph;
  private transcriptWindow: TranscriptChunk[] = [];
  private seenFinals = new Set<string>();
  private queue: Promise<void> = Promise.resolve();
  private readonly language?: string;

  constructor(private readonly options: DesktopTranscriptPipelineOptions) {
    this.graph = createEmptyGraph(options.sessionId);
    this.language = options.language;
  }

  /** 当前（最新）合并图谱，供宿主读取。 */
  getGraph(): MergedGraph {
    return this.graph;
  }

  /**
   * 接收一条 ASR 事件。partial 被忽略；final 去重后串行入队处理。
   * 处理是异步的，调用方应在停止前 await drain()。
   */
  accept(event: LocalAsrEvent): void {
    if (event.type !== 'transcript.final') {
      return;
    }
    const key = `${event.utterance.utteranceId}:${event.utterance.revision}`;
    if (this.seenFinals.has(key)) {
      return;
    }
    this.seenFinals.add(key);
    this.queue = this.queue.then(() => this.processFinal(event)).catch((error) => {
      this.options.onError(error instanceof Error ? error : new Error(String(error)));
    });
  }

  /** 等待所有已入队的 final 处理完毕。 */
  drain(): Promise<void> {
    return this.queue;
  }

  private async processFinal(event: Extract<LocalAsrEvent, { type: 'transcript.final' }>): Promise<void> {
    const utterance = event.utterance;
    const chunkId = `${this.options.sessionId}:${utterance.utteranceId}:${utterance.revision}`;
    const chunk: TranscriptChunk = {
      chunkId,
      sessionId: this.options.sessionId,
      utteranceId: utterance.utteranceId,
      kind: 'final',
      text: utterance.text,
      startMs: utterance.startMs,
      endMs: utterance.endMs,
      finalReason: utterance.finalReason,
      transport: 'ws',
      provider: 'local-asr',
    };
    this.transcriptWindow.push(chunk);

    let segment: SegmentGraph;
    try {
      segment = await this.options.structurer.extractSegmentGraph({
        sessionId: this.options.sessionId,
        transcriptWindow: this.transcriptWindow,
        previousGraph: this.graph,
        language: this.language,
      });
    } catch (error) {
      // structurer 失败：移除刚加入的 chunk，避免污染后续窗口；图谱保持不变。
      this.transcriptWindow.pop();
      this.options.onError(error instanceof Error ? error : new Error(String(error)));
      return;
    }

    this.graph = mergeSegmentGraph(this.graph, segment);
    this.options.onGraph(this.graph);
  }
}
