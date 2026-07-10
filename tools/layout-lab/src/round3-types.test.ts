import { describe, expect, it } from 'vitest';
import { computeNodeSize, truncateText } from './round3-types';

describe('computeNodeSize', () => {
  it('空文本：最小尺寸', () => {
    const s = computeNodeSize('');
    expect(s.width).toBe(80);
    expect(s.height).toBe(50);
  });

  it('21 字（P50）：宽 200，高 76（2 行）', () => {
    const s = computeNodeSize('x'.repeat(21));
    expect(s.width).toBe(200);
    expect(s.height).toBe(76);
  });

  it('42 字（P90）：宽 200，高 94（3 行）', () => {
    const s = computeNodeSize('x'.repeat(42));
    expect(s.width).toBe(200);
    expect(s.height).toBe(94);
  });

  it('超长文本（184 字）截断到 60+… 后算尺寸', () => {
    const s = computeNodeSize('x'.repeat(184));
    expect(s.width).toBe(200);
    expect(s.height).toBe(130);
  });

  it('10 字：宽 144，高 58（1 行）', () => {
    const s = computeNodeSize('x'.repeat(10));
    expect(s.width).toBe(144);
    expect(s.height).toBe(58);
  });
});

describe('truncateText', () => {
  it('超 60 字截断加 …', () => {
    expect(truncateText('x'.repeat(70)).length).toBe(61);
  });
  it('不超 60 字不截断', () => {
    expect(truncateText('x'.repeat(50))).toBe('x'.repeat(50));
  });
});
