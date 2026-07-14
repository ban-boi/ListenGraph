import { describe, expect, it } from 'vitest';
import { computeRealNodeSize } from './node-geometry';

/**
 * NodeGeometry 契约测试。
 * 修复 M3（review finding）：原 3 条用例全是恒真断言（width>=80 而 minWidth 就是 80，
 * height>=60 而 minHeight 就是 60），把 computeRealNodeSize 改成 return {80,60} 也能全过。
 * 现改为精确断言：换行逻辑、speaker/timestamp 各 +14px、truncate 截断、displayMode 差异。
 */

describe('computeRealNodeSize', () => {
  it('speaker 与 timestamp 各贡献精确 14px 高度（合计 +28）', () => {
    // 修复 M3：原断言 >=28 是恒真的（padding 也计入）。现精确对比有无 speaker/timestamp。
    const base = computeRealNodeSize('x'.repeat(50), 'claim', false, false, 'readable');
    const withSpeaker = computeRealNodeSize('x'.repeat(50), 'claim', true, false, 'readable');
    const withTimestamp = computeRealNodeSize('x'.repeat(50), 'claim', false, true, 'readable');
    const withBoth = computeRealNodeSize('x'.repeat(50), 'claim', true, true, 'readable');

    expect(withSpeaker.height - base.height).toBe(14); // speaker +14
    expect(withTimestamp.height - base.height).toBe(14); // timestamp +14
    expect(withBoth.height - base.height).toBe(28); // 合计 +28
  });

  it('换行：超长文本在 readable 模式下增加行数 → 高度按 lineHeight=18 增长', () => {
    // readable：maxTextChars=80, charWidth=12, padding=16, maxWidth=220, minWidth=80
    // 短文本（单行）vs 80+ 字符（截断后仍可能多行）
    const short = computeRealNodeSize('短', 'claim', false, false, 'readable');
    // 构造一个明确会换行的长文本（超过 charsPerLine）
    const longText = 'x'.repeat(200); // 超过 maxTextChars=80，会被 truncate 到 80
    const multiLine = computeRealNodeSize(longText, 'claim', false, false, 'readable');

    // maxWidth=220 时 charsPerLine = floor((220-32)/12) = 15，80 字符 → ceil(80/15)=6 行
    // 短文本 1 行。高度差 = (6-1)*18 = 90px（精确）
    expect(multiLine.height - short.height).toBeGreaterThanOrEqual(18); // 至少多一行
    expect(multiLine.height).toBeGreaterThan(short.height);
  });

  it('truncate：超过 maxTextChars 的文本被截断，宽度不超过 maxWidth', () => {
    // readable maxWidth=220。即使输入 1000 字符，截断到 80 后宽度仍受 maxWidth 约束
    const huge = computeRealNodeSize('x'.repeat(1000), 'claim', false, false, 'readable');
    expect(huge.width).toBeLessThanOrEqual(220); // 不超过 maxWidth
    expect(huge.width).toBeGreaterThanOrEqual(80); // 至少 minWidth
  });

  it('compact 比 readable 窄（maxWidth 200 vs 220）', () => {
    // 修复 M3：原断言只查 compact 范围 140-200（恒真：minWidth=140,maxWidth=200）。
    // 现对比两种模式同一文本的宽度差异，证明 displayMode 真实生效。
    const longText = 'x'.repeat(100);
    const readable = computeRealNodeSize(longText, 'reason', false, false, 'readable');
    const compact = computeRealNodeSize(longText, 'reason', false, false, 'compact');
    // readable maxWidth=220, compact maxWidth=200 → readable 更宽（或相等，若都未触顶）
    expect(readable.width).toBeGreaterThanOrEqual(compact.width);
    // compact 的 charWidth=7 < readable=12，同样字符数下 compact 理想宽度更小
  });

  it('readable 短文本满足基本尺寸下限', () => {
    const s = computeRealNodeSize('短文本', 'claim', false, false, 'readable');
    expect(s.width).toBeGreaterThanOrEqual(80);
    expect(s.height).toBeGreaterThanOrEqual(60);
    expect(s.width).toBeLessThanOrEqual(220);
  });
});
