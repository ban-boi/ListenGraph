export const CAPTURE_SAMPLE_RATE = 16000;
export const CAPTURE_CHANNELS = 1;
export const CAPTURE_BIT_DEPTH = 16;
export const CAPTURE_AUDIO_MIME_TYPE = 'audio/wav';

export function float32ToPcm16(input: Float32Array): Int16Array {
  const output = new Int16Array(input.length);

  for (let i = 0; i < input.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, input[i] ?? 0));
    output[i] = sample < 0 ? Math.round(sample * 0x8000) : Math.round(sample * 0x7fff);
  }

  return output;
}

export function encodePcm16AsWav(
  pcm16: Int16Array,
  options: { sampleRate: number; channels: number },
): Uint8Array {
  const bytesPerSample = CAPTURE_BIT_DEPTH / 8;
  const blockAlign = options.channels * bytesPerSample;
  const byteRate = options.sampleRate * blockAlign;
  const dataSize = pcm16.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, options.channels, true);
  view.setUint32(24, options.sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, CAPTURE_BIT_DEPTH, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  bytes.set(new Uint8Array(pcm16.buffer), 44);
  return bytes;
}

export function encodeAudioChunkAsWav(
  floatSamples: Float32Array,
  options: { sampleRate?: number; channels?: number } = {},
) {
  const sampleRate = options.sampleRate ?? CAPTURE_SAMPLE_RATE;
  const channels = options.channels ?? CAPTURE_CHANNELS;
  const pcm16 = float32ToPcm16(floatSamples);
  const wavBytes = encodePcm16AsWav(pcm16, { sampleRate, channels });

  return {
    audioData: Array.from(wavBytes),
    audioMimeType: CAPTURE_AUDIO_MIME_TYPE,
    sampleRate,
    channels,
    bitDepth: CAPTURE_BIT_DEPTH,
  };
}

function writeAscii(view: DataView, offset: number, value: string) {
  for (let i = 0; i < value.length; i += 1) {
    view.setUint8(offset + i, value.charCodeAt(i));
  }
}
