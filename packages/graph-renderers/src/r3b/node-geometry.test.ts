import { describe, expect, it } from 'vitest';
import { computeRealNodeSize } from './node-geometry';

describe('computeRealNodeSize', () => {
  it('readable 短文本不包含 speaker/timestamp', () => {
    const s = computeRealNodeSize('短文本', 'claim', false, false, 'readable');
    expect(s.width).toBeGreaterThanOrEqual(80);
    expect(s.height).toBeGreaterThanOrEqual(60);
  });

  it('speaker + timestamp 增加高度 ≥28px', () => {
    const noExtra = computeRealNodeSize('x'.repeat(50), 'claim', false, false, 'readable');
    const withExtra = computeRealNodeSize('x'.repeat(50), 'claim', true, true, 'readable');
    expect(withExtra.height - noExtra.height).toBeGreaterThanOrEqual(28);
  });

  it('compact 宽度范围 140-200', () => {
    const s = computeRealNodeSize('x'.repeat(30), 'reason', false, false, 'compact');
    expect(s.width).toBeGreaterThanOrEqual(140);
    expect(s.width).toBeLessThanOrEqual(200);
  });
});
