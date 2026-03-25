// @ts-nocheck
// AudioWorklet Processor - 在独立音频线程中处理音频数据
// 负责：收集 PCM 数据、按时间分帧、发送到主线程
// 注意：此文件使用 Web Audio API 的 AudioWorklet 类型，TypeScript 无法完全检查

const CHUNK_DURATION_MS = 10_000;
const CHUNK_DURATION_SAMPLES = 16000 * 10; // 10 秒 @ 16kHz

class AudioChunkProcessor extends AudioWorkletProcessor {
  private buffer: Float32Array = new Float32Array(0);
  private startTimeMs: number = 0;
  private chunkIndex: number = 0;

  constructor() {
    super();
    this.startTimeMs = Date.now();
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

    // 检查是否达到 chunk 大小
    while (this.buffer.length >= CHUNK_DURATION_SAMPLES) {
      const chunk = this.buffer.slice(0, CHUNK_DURATION_SAMPLES);
      this.buffer = this.buffer.slice(CHUNK_DURATION_SAMPLES);

      const chunkStartMs = this.startTimeMs + this.chunkIndex * CHUNK_DURATION_MS;
      const chunkEndMs = chunkStartMs + CHUNK_DURATION_MS;

      // 发送 chunk 到主线程
      this.port.postMessage({
        type: 'AUDIO_CHUNK',
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
