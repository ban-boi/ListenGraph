interface AudioWorkletProcessorOptions {
  processorOptions?: Record<string, unknown>;
}

declare const sampleRate: number;

declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: AudioWorkletProcessorOptions);
}

declare function registerProcessor(
  name: string,
  processorCtor: typeof AudioWorkletProcessor,
): void;

const DEFAULT_TARGET_SAMPLE_RATE = 16_000;
const DEFAULT_FRAME_DURATION_MS = 40;

function downsampleLinear(input: Float32Array, sourceRate: number, targetRate: number) {
  if (sourceRate === targetRate) return input;
  const ratio = sourceRate / targetRate;
  const outputLength = Math.max(1, Math.floor(input.length / ratio));
  const output = new Float32Array(outputLength);

  for (let index = 0; index < outputLength; index += 1) {
    const sourceIndex = index * ratio;
    const leftIndex = Math.floor(sourceIndex);
    const rightIndex = Math.min(input.length - 1, leftIndex + 1);
    const fraction = sourceIndex - leftIndex;
    output[index] = input[leftIndex] * (1 - fraction) + input[rightIndex] * fraction;
  }

  return output;
}

class DesktopAudioFrameProcessor extends AudioWorkletProcessor {
  private readonly targetSampleRate: number;
  private readonly frameDurationMs: number;
  private readonly frameSampleCount: number;
  private buffer = new Float32Array(0);
  private frameIndex = 0;

  constructor(options?: AudioWorkletProcessorOptions) {
    super();
    const processorOptions = options?.processorOptions ?? {};
    this.targetSampleRate = Number(processorOptions.targetSampleRate ?? DEFAULT_TARGET_SAMPLE_RATE);
    this.frameDurationMs = Number(processorOptions.frameDurationMs ?? DEFAULT_FRAME_DURATION_MS);
    this.frameSampleCount = Math.max(
      1,
      Math.round((this.targetSampleRate * this.frameDurationMs) / 1000),
    );
  }

  process(inputs: Float32Array[][]) {
    const channels = inputs[0];
    if (!channels || channels.length === 0 || !channels[0]) return true;

    const firstChannel = channels[0];
    const mono = new Float32Array(firstChannel.length);

    for (let sampleIndex = 0; sampleIndex < firstChannel.length; sampleIndex += 1) {
      let sum = 0;
      for (let channelIndex = 0; channelIndex < channels.length; channelIndex += 1) {
        sum += channels[channelIndex][sampleIndex] ?? 0;
      }
      mono[sampleIndex] = sum / channels.length;
    }

    const normalized = downsampleLinear(mono, sampleRate, this.targetSampleRate);
    const nextBuffer = new Float32Array(this.buffer.length + normalized.length);
    nextBuffer.set(this.buffer);
    nextBuffer.set(normalized, this.buffer.length);
    this.buffer = nextBuffer;

    while (this.buffer.length >= this.frameSampleCount) {
      const frame = this.buffer.slice(0, this.frameSampleCount);
      this.buffer = this.buffer.slice(this.frameSampleCount);
      this.emitFrame(frame);
    }

    return true;
  }

  emitFrame(frame: Float32Array) {
    let squareSum = 0;
    let peak = 0;
    for (let index = 0; index < frame.length; index += 1) {
      const value = Math.max(-1, Math.min(1, frame[index]));
      squareSum += value * value;
      peak = Math.max(peak, Math.abs(value));
      frame[index] = value;
    }

    const rms = Math.sqrt(squareSum / frame.length);
    this.port.postMessage(
      {
        type: 'frame',
        frame: frame.buffer,
        frameIndex: this.frameIndex,
        level: { rms, peak },
        sampleRate: this.targetSampleRate,
        timestamp: Date.now(),
      },
      [frame.buffer],
    );
    this.frameIndex += 1;
  }
}

registerProcessor('desktop-audio-frame-processor', DesktopAudioFrameProcessor);
