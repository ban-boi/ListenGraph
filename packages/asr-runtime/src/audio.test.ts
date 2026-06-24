import { describe, expect, it } from 'vitest';
import { bytesToBase64, float32ToPcm16 } from './audio';

describe('float32ToPcm16', () => {
  it('钳位并转换完整的 Float32 范围', () => {
    expect(Array.from(float32ToPcm16(new Float32Array([-2, -1, -0.5, 0, 0.5, 1, 2])))).toEqual([
      -32768, -32768, -16384, 0, 16384, 32767, 32767,
    ]);
  });

  it('不依赖 Node Buffer 编码字节', () => {
    expect(bytesToBase64(new Uint8Array([0, 1, 2, 253, 254, 255]))).toBe('AAEC/f7/');
  });
});
