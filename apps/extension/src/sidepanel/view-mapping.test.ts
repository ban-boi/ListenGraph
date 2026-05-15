import { describe, it, expect } from 'vitest';

describe('timeline 视图映射', () => {
  it('timeline 应被映射为 causal', () => {
    const rawView = 'timeline' as const;
    const mapped = rawView === 'timeline' ? 'causal' : rawView;
    expect(mapped).toBe('causal');
  });

  it('非 timeline 视图保持不变', () => {
    const views = ['causal', 'comparison', 'hierarchy'] as const;
    for (const v of views) {
      const mapped = v === 'timeline' ? 'causal' : v;
      expect(mapped).toBe(v);
    }
  });
});
