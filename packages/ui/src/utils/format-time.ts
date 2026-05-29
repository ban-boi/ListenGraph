/** 将毫秒格式化为 M:SS */
export function formatTime(ms: number): string {
  const totalSeconds = Math.floor(Math.abs(ms) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const sign = ms < 0 ? '-' : '';
  return `${sign}${minutes}:${String(seconds).padStart(2, '0')}`;
}

/** 将时间戳格式化为相对时间文本（如 "刚刚"、"3s 前"、"2m 前"） */
export function formatRelativeAge(
  timestamp: number | null | undefined,
  now = Date.now(),
): string {
  if (!timestamp) return '暂无';
  const diffMs = Math.max(now - timestamp, 0);
  if (diffMs < 1000) return '刚刚';
  if (diffMs < 60_000) return `${Math.floor(diffMs / 1000)}s 前`;
  return `${Math.floor(diffMs / 60_000)}m 前`;
}

/** 格式化时间戳为 HH:MM:SS */
export function formatTimestamp(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString();
}
