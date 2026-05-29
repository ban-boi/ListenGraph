import { describe, it, expect } from 'vitest';
import { formatTime, formatRelativeAge, formatTimestamp } from './format-time';

describe('formatTime', () => {
  it('格式化 0 为 0:00', () => {
    expect(formatTime(0)).toBe('0:00');
  });
  it('格式化 65000 为 1:05', () => {
    expect(formatTime(65_000)).toBe('1:05');
  });
  it('格式化 3599000 为 59:59', () => {
    expect(formatTime(3_599_000)).toBe('59:59');
  });
  it('负数显示负号', () => {
    expect(formatTime(-5000)).toBe('-0:05');
  });
});

describe('formatRelativeAge', () => {
  it('null/undefined 返回 "暂无"', () => {
    expect(formatRelativeAge(null)).toBe('暂无');
    expect(formatRelativeAge(undefined)).toBe('暂无');
  });
  it('刚刚发生的返回 "刚刚"', () => {
    const now = Date.now();
    expect(formatRelativeAge(now - 500, now)).toBe('刚刚');
  });
  it('30 秒前返回 "30s 前"', () => {
    const now = Date.now();
    expect(formatRelativeAge(now - 30_000, now)).toBe('30s 前');
  });
  it('120 秒前返回 "2m 前"', () => {
    const now = Date.now();
    expect(formatRelativeAge(now - 120_000, now)).toBe('2m 前');
  });
});

describe('formatTimestamp', () => {
  it('返回字符串', () => {
    const result = formatTimestamp(Date.now());
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });
});
