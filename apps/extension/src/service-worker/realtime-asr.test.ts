import { beforeEach, describe, expect, it } from 'vitest';
import {
  setupServiceWorkerTests,
  dispatchMessage,
  appendTranscriptChunkMock,
  extractSegmentGraphMock,
  saveMergedGraphMock,
  getProviderConfigMock,
  startRealtimeSession,
  startExternalRealtimeSession,
  sendStableUtterance,
} from './__test-helpers__/index-test-helpers';

describe('Service Worker - 实时 ASR', () => {
  beforeEach(async () => {
    await setupServiceWorkerTests();
  });

  it('收到腾讯实时稳定句段后会持久化 transcript 并驱动 structurer', async () => {
    const firstUtterance = '第一句稳定话语'.repeat(8);
    const secondUtterance = '第二句稳定话语'.repeat(8);
    const thirdUtterance = '第三句稳定话语'.repeat(8);

    await startRealtimeSession();

    await sendStableUtterance({ text: firstUtterance, startMs: 0, endMs: 10000 });
    await sendStableUtterance({ text: secondUtterance, startMs: 10000, endMs: 20000 });
    await sendStableUtterance({ text: thirdUtterance, startMs: 20000, endMs: 30000 });

    expect(appendTranscriptChunkMock).toHaveBeenCalledWith(
      expect.objectContaining({
        text: thirdUtterance,
        provider: 'tencent-asr',
        raw: expect.objectContaining({
          transport: 'ws',
        }),
      }),
    );
    expect(extractSegmentGraphMock).toHaveBeenCalledTimes(1);
    expect(saveMergedGraphMock).toHaveBeenCalled();
  });

  it('腾讯 realtime 在达到 3 条稳定句段但未达字数或时长阈值时不会 bootstrap', async () => {
    await startRealtimeSession();

    await sendStableUtterance({ text: '第一句稳定话语', startMs: 0, endMs: 10000 });
    await sendStableUtterance({ text: '第二句稳定话语', startMs: 10000, endMs: 20000 });
    await sendStableUtterance({ text: '第三句稳定话语', startMs: 20000, endMs: 30000 });

    expect(extractSegmentGraphMock).not.toHaveBeenCalled();
    expect(saveMergedGraphMock).not.toHaveBeenCalled();
  });

  it('external realtime 在 3 条短稳定句段后会启动首轮 bootstrap', async () => {
    await startExternalRealtimeSession();

    await sendStableUtterance({
      text: '短句一',
      startMs: 0,
      endMs: 3000,
      provider: 'local-asr-bridge',
      finalReason: 'endpoint',
    });
    await sendStableUtterance({
      text: '短句二',
      startMs: 3000,
      endMs: 7000,
      provider: 'local-asr-bridge',
      finalReason: 'endpoint',
    });
    await sendStableUtterance({
      text: '短句三',
      startMs: 7000,
      endMs: 11000,
      provider: 'local-asr-bridge',
      finalReason: 'endpoint',
    });

    expect(extractSegmentGraphMock).toHaveBeenCalledTimes(1);
    expect(extractSegmentGraphMock).toHaveBeenCalledWith(
      expect.objectContaining({
        transcriptWindow: [
          expect.objectContaining({ text: '短句一' }),
          expect.objectContaining({ text: '短句二' }),
          expect.objectContaining({ text: '短句三' }),
        ],
      }),
    );
    expect(saveMergedGraphMock).toHaveBeenCalled();
  });

  it('腾讯 realtime 会在累计时长达到阈值时启动 bootstrap', async () => {
    await startRealtimeSession();

    await sendStableUtterance({ text: '第一句稳定话语', startMs: 0, endMs: 20000 });
    await sendStableUtterance({ text: '第二句稳定话语', startMs: 20000, endMs: 50000 });

    expect(extractSegmentGraphMock).toHaveBeenCalledTimes(1);
    expect(extractSegmentGraphMock).toHaveBeenCalledWith(
      expect.objectContaining({
        transcriptWindow: [
          expect.objectContaining({ text: '第一句稳定话语' }),
          expect.objectContaining({ text: '第二句稳定话语' }),
        ],
      }),
    );
    expect(saveMergedGraphMock).toHaveBeenCalled();
  });

  it('实时输入在 input_finished final 到达时会为短会话兜底 bootstrap', async () => {
    await startExternalRealtimeSession();

    await sendStableUtterance({
      text: '短句一',
      startMs: 0,
      endMs: 4000,
      provider: 'local-asr-bridge',
    });
    await sendStableUtterance({
      text: '短句二',
      startMs: 4000,
      endMs: 8000,
      provider: 'local-asr-bridge',
      finalReason: 'input_finished',
    });

    expect(extractSegmentGraphMock).toHaveBeenCalledTimes(1);
    expect(extractSegmentGraphMock).toHaveBeenCalledWith(
      expect.objectContaining({
        transcriptWindow: [
          expect.objectContaining({ text: '短句一' }),
          expect.objectContaining({ text: '短句二' }),
        ],
      }),
    );
    expect(saveMergedGraphMock).toHaveBeenCalled();
  });

  it('实时输入结束兜底不会为低信息量话语创建 graph', async () => {
    await startExternalRealtimeSession();

    await sendStableUtterance({
      text: '好的',
      startMs: 0,
      endMs: 2000,
      provider: 'local-asr-bridge',
    });
    await sendStableUtterance({
      text: '谢谢',
      startMs: 2000,
      endMs: 4000,
      provider: 'local-asr-bridge',
      finalReason: 'input_finished',
    });

    expect(extractSegmentGraphMock).not.toHaveBeenCalled();
    expect(saveMergedGraphMock).not.toHaveBeenCalled();
  });
});
