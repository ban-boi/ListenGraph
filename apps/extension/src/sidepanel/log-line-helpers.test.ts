import { describe, expect, it } from 'vitest';
import {
  isTencentRealtimeStreamLogLine,
  isTencentRealtimeStreamProgressMessage,
  stripTencentRealtimeStreamLogs,
  upsertTencentRealtimeStreamLog,
} from './log-line-helpers';

describe('log-line-helpers (腾讯实时流式日志)', () => {
  it('识别流式 progress message', () => {
    expect(
      isTencentRealtimeStreamProgressMessage('asr', '腾讯实时 ASR 中间结果: 你好'),
    ).toBe(true);
    expect(
      isTencentRealtimeStreamProgressMessage('asr', '腾讯实时 ASR 开始: 你好'),
    ).toBe(true);
    expect(isTencentRealtimeStreamProgressMessage('asr', '腾讯实时 ASR 开始')).toBe(
      true,
    );
    expect(
      isTencentRealtimeStreamProgressMessage('asr', '腾讯 ASR 任务已创建'),
    ).toBe(false);
    expect(
      isTencentRealtimeStreamProgressMessage('asr', '腾讯实时 ASR 已连接'),
    ).toBe(false);
    expect(
      isTencentRealtimeStreamProgressMessage(
        'structurer',
        '腾讯实时 ASR 中间结果: x',
      ),
    ).toBe(false);
  });

  it('识别完整日志行', () => {
    expect(
      isTencentRealtimeStreamLogLine(
        '[12:00:00] ASR: 腾讯实时 ASR 中间结果: 当然了',
      ),
    ).toBe(true);
    expect(
      isTencentRealtimeStreamLogLine('[12:00:00] ASR: 腾讯实时 ASR 开始'),
    ).toBe(true);
    expect(
      isTencentRealtimeStreamLogLine(
        '[12:00:00] ASR: 腾讯 ASR 任务已创建，TaskId=1',
      ),
    ).toBe(false);
  });

  it('stripTencentRealtimeStreamLogs 移除所有流式行', () => {
    const logs = [
      '[t1] ASR: 腾讯实时 ASR 中间结果: a',
      '[t2] 图更新: 3 个节点',
      '[t3] ASR: 腾讯 ASR 任务已创建',
    ];
    expect(stripTencentRealtimeStreamLogs(logs)).toEqual([
      '[t2] 图更新: 3 个节点',
      '[t3] ASR: 腾讯 ASR 任务已创建',
    ]);
  });

  it('upsertTencentRealtimeStreamLog 覆盖旧流式行并置顶', () => {
    const prev = [
      '[t0] ASR: 腾讯实时 ASR 中间结果: old',
      '[t1] 图更新: 2 个节点',
    ];
    const next = upsertTencentRealtimeStreamLog(
      prev,
      'ASR: 腾讯实时 ASR 中间结果: new',
    );
    expect(next[0]).toMatch(/^\[[^\]]+\] ASR: 腾讯实时 ASR 中间结果: new$/);
    expect(next).toHaveLength(2);
    expect(next[1]).toBe('[t1] 图更新: 2 个节点');
  });
});
