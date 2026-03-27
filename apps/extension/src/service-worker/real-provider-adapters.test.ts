import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  OpenAIAsrProvider,
  OpenAIStructurerProvider,
  ProviderRequestError,
  retryAsync,
  ZhipuStructurerProvider,
} from '@listen-graphic/providers';

describe('real provider adapters', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('OpenAIAsrProvider 会调用转写接口并映射 transcript chunk', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        text: '真实转写结果',
        segments: [
          {
            text: '真实',
            start: 0,
            end: 0.5,
            confidence: 0.9,
          },
        ],
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const provider = new OpenAIAsrProvider({
      type: 'openai',
      mode: 'direct',
      endpoint: 'https://api.openai.com/v1',
      apiKey: 'secret',
      model: 'gpt-4o-mini-transcribe',
      language: 'zh',
    });

    const transcript = await provider.transcribeChunk({
      sessionId: 'session_live',
      audio: new ArrayBuffer(8),
      startMs: 0,
      endMs: 30_000,
      language: 'zh',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.openai.com/v1/audio/transcriptions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer secret',
        }),
        body: expect.any(FormData),
      }),
    );
    expect(transcript).toEqual(
      expect.objectContaining({
        sessionId: 'session_live',
        text: '真实转写结果',
        provider: 'openai-asr',
      }),
    );
    expect(transcript.tokens?.[0]).toEqual(
      expect.objectContaining({
        text: '真实',
        startMs: 0,
      }),
    );
  });

  it('OpenAIAsrProvider 会在 429 后按策略重试', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        text: async () => 'rate limit',
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          text: '重试后成功',
        }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new OpenAIAsrProvider({
      type: 'openai',
      mode: 'direct',
      endpoint: 'https://api.openai.com/v1',
      apiKey: 'secret',
      model: 'gpt-4o-mini-transcribe',
      language: 'zh',
      retry: {
        maxAttempts: 2,
        baseDelayMs: 1,
        maxDelayMs: 1,
        timeoutMs: 1_000,
      },
    });

    const transcriptPromise = provider.transcribeChunk({
      sessionId: 'session_live',
      audio: new ArrayBuffer(8),
      startMs: 0,
      endMs: 30_000,
    });
    await vi.runAllTimersAsync();
    const transcript = await transcriptPromise;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(transcript.text).toBe('重试后成功');
  });

  it('OpenAIStructurerProvider 会解析 JSON 并补齐缺失节点字段', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                topic: '真实主题',
                nodes: [
                  {
                    type: 'reason',
                    text: '这是结构化节点',
                  },
                ],
              }),
            },
          },
        ],
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const provider = new OpenAIStructurerProvider({
      type: 'openai',
      mode: 'direct',
      endpoint: 'https://api.openai.com/v1',
      apiKey: 'secret',
      model: 'gpt-4.1-mini',
      language: 'zh',
    });

    const segment = await provider.extractSegmentGraph({
      sessionId: 'session_live',
      transcriptWindow: [
        {
          chunkId: 'chunk_1',
          sessionId: 'session_live',
          text: '最近一段 transcript',
          startMs: 1_000,
          endMs: 3_000,
          provider: 'openai-asr',
        },
      ],
      language: 'zh',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.openai.com/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
      }),
    );
    expect(segment).toEqual(
      expect.objectContaining({
        sessionId: 'session_live',
        topic: '真实主题',
        provider: 'openai-structurer',
      }),
    );
    expect(segment.nodes[0]).toEqual(
      expect.objectContaining({
        type: 'reason',
        text: '这是结构化节点',
        timestampMs: 1_000,
        evidenceChunkIds: ['chunk_1'],
      }),
    );
  });

  it('ZhipuStructurerProvider 会使用智谱默认 endpoint/model 并保留独立 provider 名称', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                topic: '智谱主题',
                nodes: [
                  {
                    type: 'claim',
                    text: '智谱结构化节点',
                  },
                ],
              }),
            },
          },
        ],
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const provider = new ZhipuStructurerProvider({
      type: 'zhipu',
      mode: 'direct',
      apiKey: 'zhipu-secret',
      language: 'zh',
    });

    const segment = await provider.extractSegmentGraph({
      sessionId: 'session_zhipu',
      transcriptWindow: [
        {
          chunkId: 'chunk_zhipu_1',
          sessionId: 'session_zhipu',
          text: '智谱 transcript',
          startMs: 2_000,
          endMs: 5_000,
          provider: 'openai-asr',
        },
      ],
      language: 'zh',
    });

    const requestCalls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
    const requestInit = requestCalls[0]?.[1];
    const parsedBody = JSON.parse(String(requestInit?.body ?? '{}'));

    expect(fetchMock).toHaveBeenCalledWith(
      'https://open.bigmodel.cn/api/paas/v4/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer zhipu-secret',
        }),
      }),
    );
    expect(parsedBody.model).toBe('glm-4.7-flash');
    expect(parsedBody.response_format).toEqual({ type: 'json_object' });
    expect(segment).toEqual(
      expect.objectContaining({
        sessionId: 'session_zhipu',
        topic: '智谱主题',
        provider: 'zhipu-structurer',
      }),
    );
  });

  it('relay 模式会使用 session token 而不是 api key', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        text: 'relay transcript',
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const provider = new OpenAIAsrProvider({
      type: 'openai',
      mode: 'relay',
      endpoint: 'https://relay.listen-graphic.local/v1',
      sessionToken: 'relay-token',
      apiKey: 'should-not-be-used',
      model: 'gpt-4o-mini-transcribe',
      language: 'zh',
    });

    await provider.transcribeChunk({
      sessionId: 'session_live',
      audio: new ArrayBuffer(8),
      startMs: 0,
      endMs: 30_000,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://relay.listen-graphic.local/v1/audio/transcriptions',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer relay-token',
        }),
      }),
    );
  });

  it('retryAsync 在达到最大重试次数后会保留最后一次 provider 错误', async () => {
    vi.useFakeTimers();

    const promise = retryAsync(
      async (attempt) => {
        throw new ProviderRequestError({
          code: 'RATE_LIMIT_ERROR',
          message: `attempt ${attempt}`,
          provider: 'openai-asr',
          stage: 'asr',
          retriable: true,
          status: 429,
        });
      },
      {
        maxAttempts: 2,
        baseDelayMs: 1,
        maxDelayMs: 1,
        timeoutMs: 1_000,
        retryableStatusCodes: [429],
      },
    );
    const rejection = expect(promise).rejects.toMatchObject({
      code: 'RATE_LIMIT_ERROR',
      attemptCount: 2,
    });

    await vi.runAllTimersAsync();
    await rejection;
  });
});
