// @ts-nocheck
// AudioWorklet Processor - 在独立音频线程中处理音频数据
// 负责：收集 PCM 数据、按时间分帧、发送到主线程
// 注意：此文件使用 Web Audio API 的 AudioWorklet 类型，TypeScript 无法完全检查

const SAMPLE_RATE = 16000;
const DEFAULT_CHUNK_DURATION_MS = 10_000;
const DEFAULT_FRAME_DURATION_MS = 40;

class AudioChunkProcessor extends AudioWorkletProcessor {
  private buffer: Float32Array = new Float32Array(0);
  private startTimeMs: number = 0;
  private chunkIndex: number = 0;
  private readonly mode: 'chunk' | 'frame';
  private readonly emitSampleCount: number;
  private readonly emitDurationMs: number;

  constructor(options?: AudioWorkletNodeOptions) {
    super();
    this.startTimeMs = Date.now();
    const processorOptions = options?.processorOptions ?? {};
    const mode = processorOptions.mode === 'frame' ? 'frame' : 'chunk';
    const emitDurationMs =
      mode === 'frame'
        ? Number(processorOptions.frameDurationMs ?? DEFAULT_FRAME_DURATION_MS)
        : Number(processorOptions.chunkDurationMs ?? DEFAULT_CHUNK_DURATION_MS);

    this.mode = mode;
    this.emitDurationMs = Math.max(1, emitDurationMs);
    this.emitSampleCount = Math.max(
      1,
      Math.round((SAMPLE_RATE * this.emitDurationMs) / 1000),
    );
  }

  process(
    inputs: Float32Array[][],
    _outputs: Float32Array[][],
    _parameters: Record<string, Float32Array>,
  ): boolean {
    const input = inputs[0];

    // 没有输入数据
    if (!input || !input[0]) {
      return true;
    }

    const inputData = input[0];

    // 追加到缓冲区
    const newBuffer = new Float32Array(this.buffer.length + inputData.length);
    newBuffer.set(this.buffer);
    newBuffer.set(inputData, this.buffer.length);
    this.buffer = newBuffer;

    while (this.buffer.length >= this.emitSampleCount) {
      const chunk = this.buffer.slice(0, this.emitSampleCount);
      this.buffer = this.buffer.slice(this.emitSampleCount);
      const chunkStartMs = this.startTimeMs + this.chunkIndex * this.emitDurationMs;
      const chunkEndMs = chunkStartMs + this.emitDurationMs;

      this.port.postMessage({
        type: this.mode === 'frame' ? 'AUDIO_FRAME' : 'AUDIO_CHUNK',
        audioData: chunk.buffer,
        startMs: chunkStartMs,
        endMs: chunkEndMs,
      });

      this.chunkIndex++;
    }

    return true; // 保持处理器运行
  }
}

registerProcessor('audio-chunk-processor', AudioChunkProcessor);
