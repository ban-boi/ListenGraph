import { describe, it, expect } from 'vitest';
import { generateWavePath } from './wave-path';

describe('generateWavePath', () => {
  it('横向波：返回正确的结构', () => {
    const result = generateWavePath(320, 18, 7, 40, 'horizontal');
    expect(result.numWaves).toBe(8);
    expect(result.actualWavelength).toBe(40);
    expect(result.viewBox).toBe('0 0 640 18');
    expect(result.path).toMatch(/^M0 9/);
  });

  it('竖向波：返回正确的结构', () => {
    const result = generateWavePath(80, 18, 7, 40, 'vertical');
    expect(result.numWaves).toBe(2);
    expect(result.actualWavelength).toBe(40);
    expect(result.viewBox).toBe('0 0 18 160');
    expect(result.path).toMatch(/^M9 0/);
  });

  it('非整数波长时四舍五入 wave 数量', () => {
    const result = generateWavePath(300, 18, 7, 40, 'horizontal');
    expect(result.numWaves).toBe(8);
    expect(result.actualWavelength).toBe(37.5);
  });

  it('极短长度至少 1 个 wave', () => {
    const result = generateWavePath(10, 18, 7, 40, 'horizontal');
    expect(result.numWaves).toBe(1);
  });
});
