import { describe, expect, it } from 'vitest';
import { encodeAudioChunkAsWav, float32ToPcm16 } from './audio';

describe('audio chunk encoding', () => {
  it('converts float32 samples to signed 16-bit PCM', () => {
    const pcm = float32ToPcm16(new Float32Array([-1, -0.5, 0, 0.5, 1]));

    expect(Array.from(pcm)).toEqual([-32768, -16384, 0, 16384, 32767]);
  });

  it('wraps PCM16 samples into a wav file payload', () => {
    const wav = encodeAudioChunkAsWav(new Float32Array([0, 0.5, -0.5, 1]), {
      sampleRate: 16000,
      channels: 1,
    });

    const header = String.fromCharCode(...wav.audioData.slice(0, 4));
    const wave = String.fromCharCode(...wav.audioData.slice(8, 12));
    const dataLength = new DataView(Uint8Array.from(wav.audioData).buffer).getUint32(40, true);

    expect(header).toBe('RIFF');
    expect(wave).toBe('WAVE');
    expect(wav.audioMimeType).toBe('audio/wav');
    expect(wav.sampleRate).toBe(16000);
    expect(wav.channels).toBe(1);
    expect(wav.bitDepth).toBe(16);
    expect(dataLength).toBe(8);
  });
});
