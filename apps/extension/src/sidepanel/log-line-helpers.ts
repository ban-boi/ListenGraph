/**
 * 腾讯实时 ASR WebSocket 流式进度（slice_type 0/1）在 service worker 中的固定前缀，
 * 用于 sidepanel 日志合并与清除，避免与批量「腾讯 ASR …」、连接状态等混淆。
 */
const TENCENT_REALTIME_PROGRESS_RE = /^腾讯实时 ASR (开始|中间结果)(:|$)/;

/** 与 {@link handleAsrStreamPartial} 下发的 message 一致 */
export function isTencentRealtimeStreamProgressMessage(
  stage: 'asr' | 'structurer',
  message: string,
): boolean {
  return stage === 'asr' && TENCENT_REALTIME_PROGRESS_RE.test(message);
}

const TENCENT_REALTIME_LOG_LINE_RE =
  /\] ASR: 腾讯实时 ASR (开始|中间结果)(:|$)/;

/** 完整日志行，形如 `[12:33:21] ASR: 腾讯实时 ASR 中间结果: …` */
export function isTencentRealtimeStreamLogLine(line: string): boolean {
  return TENCENT_REALTIME_LOG_LINE_RE.test(line);
}

export function stripTencentRealtimeStreamLogs(logs: string[]): string[] {
  return logs.filter((line) => !isTencentRealtimeStreamLogLine(line));
}

export function upsertTencentRealtimeStreamLog(
  prevLogs: string[],
  displayMsg: string,
): string[] {
  const time = new Date().toLocaleTimeString();
  const line = `[${time}] ${displayMsg}`;
  const cleaned = stripTencentRealtimeStreamLogs(prevLogs);
  return [line, ...cleaned].slice(0, 50);
}
