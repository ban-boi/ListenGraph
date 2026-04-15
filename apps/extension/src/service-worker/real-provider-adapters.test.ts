import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AliyunStructurerProvider,
  BaiduStructurerProvider,
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
        id: expect.stringMatching(/^segment_/),
        type: 'reason',
        text: '这是结构化节点',
        timestampMs: 1_000,
        evidenceChunkIds: ['chunk_1'],
      }),
    );
  });

  it('OpenAIStructurerProvider 会规范化 answer 包装、content 字段、canonical id 与跨段边', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                answer: {
                  topic: '增量主题',
                  nodes: [
                    {
                      id: 'n1',
                      type: 'claim',
                      content: '最新观点',
                    },
                  ],
                  edges: [
                    {
                      source: 'existing_node_1',
                      target: 'n1',
                      type: 'supports',
                    },
                  ],
                },
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
          text: '[0:0.000,0:10.000] 第一段',
          startMs: 0,
          endMs: 10_000,
          provider: 'openai-asr',
        },
        {
          chunkId: 'chunk_2',
          sessionId: 'session_live',
          text: '[0:10.000,0:20.000] 第二段',
          startMs: 10_000,
          endMs: 20_000,
          provider: 'openai-asr',
        },
        {
          chunkId: 'chunk_3',
          sessionId: 'session_live',
          text: '[0:20.000,0:30.000] 第三段',
          startMs: 20_000,
          endMs: 30_000,
          provider: 'openai-asr',
        },
      ],
      previousGraph: {
        sessionId: 'session_live',
        revision: 1,
        topics: [],
        nodes: [
          {
            id: 'existing_node_1',
            type: 'claim',
            text: '既有节点',
            timestampMs: 0,
            status: 'confirmed',
          },
        ],
        edges: [],
        updatedAt: 1,
      },
      language: 'zh',
    });

    const requestCalls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
    const requestInit = requestCalls[0]?.[1];
    const parsedBody = JSON.parse(String(requestInit?.body ?? '{}'));
    const systemPrompt = String(parsedBody.messages?.[0]?.content ?? '');
    const userPayload = JSON.parse(String(parsedBody.messages?.[1]?.content ?? '{}'));

    expect(userPayload.mode).toBe('incremental');
    expect(userPayload.windowTranscript).not.toContain('[0:0.000,0:10.000]');
    expect(userPayload.latestChunkTranscript).toContain('[20000-30000] 第三段');
    expect(userPayload.recentGraphContext.nodes).toEqual([
      expect.objectContaining({
        id: 'existing_node_1',
        text: '既有节点',
      }),
    ]);
    expect(userPayload.recentGraphContext.edges).toEqual([]);
    expect(systemPrompt).toContain('Treat recentGraphContext as frozen semantics');
    expect(systemPrompt).toContain('Do not restate, paraphrase, or rename semantics');
    expect(systemPrompt).toContain('append to history instead of revising history');
    expect(systemPrompt).toContain('Do not rewrite, broaden, narrow, or replace the text or node type');
    expect(systemPrompt).toContain('prefer adding an edge instead of repeating the claim');

    expect(segment.startMs).toBe(20_000);
    expect(segment.endMs).toBe(30_000);
    expect(segment.nodes).toEqual([
      expect.objectContaining({
        id: expect.stringMatching(/^segment_.*:n1$/),
        text: '最新观点',
      }),
    ]);
    expect(segment.edges).toEqual([
      expect.objectContaining({
        source: 'existing_node_1',
        target: segment.nodes[0]?.id,
        type: 'supports',
      }),
    ]);
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
    expect(parsedBody.thinking).toEqual({ type: 'disabled' });
    expect(segment).toEqual(
      expect.objectContaining({
        sessionId: 'session_zhipu',
        topic: '智谱主题',
        provider: 'zhipu-structurer',
      }),
    );
  });

  it('ZhipuStructurerProvider 遇到 429 会直接返回而不重试', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => 'rate limit',
    });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new ZhipuStructurerProvider({
      type: 'zhipu',
      mode: 'direct',
      apiKey: 'zhipu-secret',
      language: 'zh',
      retry: {
        maxAttempts: 3,
        baseDelayMs: 1,
        maxDelayMs: 1,
        timeoutMs: 1_000,
      },
    });

    await expect(
      provider.extractSegmentGraph({
        sessionId: 'session_zhipu_rate_limit',
        transcriptWindow: [
          {
            chunkId: 'chunk_zhipu_rate_limit_1',
            sessionId: 'session_zhipu_rate_limit',
            text: '智谱限流 transcript',
            startMs: 2_000,
            endMs: 5_000,
            provider: 'openai-asr',
          },
        ],
        language: 'zh',
      }),
    ).rejects.toMatchObject({
      code: 'RATE_LIMIT_ERROR',
      status: 429,
      attemptCount: 1,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('BaiduStructurerProvider 会使用百度默认 endpoint/model，并省略 response_format', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                topic: '百度主题',
                nodes: [
                  {
                    type: 'claim',
                    text: '百度结构化节点',
                  },
                ],
              }),
            },
          },
        ],
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const provider = new BaiduStructurerProvider({
      type: 'baidu',
      mode: 'direct',
      apiKey: 'baidu-secret',
      language: 'zh',
    });

    const segment = await provider.extractSegmentGraph({
      sessionId: 'session_baidu',
      transcriptWindow: [
        {
          chunkId: 'chunk_baidu_1',
          sessionId: 'session_baidu',
          text: '百度 transcript',
          startMs: 1_000,
          endMs: 4_000,
          provider: 'openai-asr',
        },
      ],
      language: 'zh',
    });

    const requestCalls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
    const requestInit = requestCalls[0]?.[1];
    const parsedBody = JSON.parse(String(requestInit?.body ?? '{}'));

    expect(fetchMock).toHaveBeenCalledWith(
      'https://qianfan.baidubce.com/v2/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer baidu-secret',
        }),
      }),
    );
    expect(parsedBody.model).toBe('ernie-speed-8k');
    expect(parsedBody.response_format).toBeUndefined();
    expect(parsedBody.temperature).toBe(0.1);
    expect(segment).toEqual(
      expect.objectContaining({
        sessionId: 'session_baidu',
        topic: '百度主题',
        provider: 'baidu-structurer',
      }),
    );
  });

  it('BaiduStructurerProvider 遇到 429 会按策略重试', async () => {
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
          choices: [
            {
              message: {
                content: JSON.stringify({
                  topic: '百度重试主题',
                  nodes: [],
                  edges: [],
                }),
              },
            },
          ],
        }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const provider = new BaiduStructurerProvider({
      type: 'baidu',
      mode: 'direct',
      apiKey: 'baidu-secret',
      language: 'zh',
      retry: {
        maxAttempts: 2,
        baseDelayMs: 1,
        maxDelayMs: 1,
        timeoutMs: 1_000,
      },
    });

    const segmentPromise = provider.extractSegmentGraph({
      sessionId: 'session_baidu_retry',
      transcriptWindow: [
        {
          chunkId: 'chunk_baidu_retry_1',
          sessionId: 'session_baidu_retry',
          text: '百度限流 transcript',
          startMs: 0,
          endMs: 10_000,
          provider: 'openai-asr',
        },
      ],
      language: 'zh',
    });
    await vi.runAllTimersAsync();
    const segment = await segmentPromise;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(segment.provider).toBe('baidu-structurer');
  });

  it('AliyunStructurerProvider 会使用阿里云默认 endpoint/model 并保留 OpenAI 兼容请求体', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                topic: '阿里云主题',
                nodes: [
                  {
                    type: 'claim',
                    text: '阿里云结构化节点',
                  },
                ],
              }),
            },
          },
        ],
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const provider = new AliyunStructurerProvider({
      type: 'aliyun',
      mode: 'direct',
      apiKey: 'aliyun-secret',
      language: 'zh',
    });

    const segment = await provider.extractSegmentGraph({
      sessionId: 'session_aliyun',
      transcriptWindow: [
        {
          chunkId: 'chunk_aliyun_1',
          sessionId: 'session_aliyun',
          text: '阿里云 transcript',
          startMs: 1_000,
          endMs: 4_000,
          provider: 'openai-asr',
        },
      ],
      language: 'zh',
    });

    const requestCalls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
    const requestInit = requestCalls[0]?.[1];
    const parsedBody = JSON.parse(String(requestInit?.body ?? '{}'));

    expect(fetchMock).toHaveBeenCalledWith(
      'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer aliyun-secret',
        }),
      }),
    );
    expect(parsedBody.model).toBe('qwen-plus');
    expect(parsedBody.response_format).toEqual({ type: 'json_object' });
    expect(segment).toEqual(
      expect.objectContaining({
        sessionId: 'session_aliyun',
        topic: '阿里云主题',
        provider: 'aliyun-structurer',
      }),
    );
  });

  it('AliyunStructurerProvider 会修复 nodes 数组里缺失对象起始符的近似 JSON 响应', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content:
                '{"topic":"三人对话","nodes":[{"id":"n1","type":"claim","text":"说话者也是两位嘉宾的粉丝"},"id":"n2","type":"claim","text":"三人来自不同年代"}],"edges":[]}',
            },
          },
        ],
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const provider = new AliyunStructurerProvider({
      type: 'aliyun',
      mode: 'direct',
      apiKey: 'aliyun-secret',
      language: 'zh',
    });

    const segment = await provider.extractSegmentGraph({
      sessionId: 'session_aliyun_repair',
      transcriptWindow: [
        {
          chunkId: 'chunk_aliyun_repair_1',
          sessionId: 'session_aliyun_repair',
          text: '我也是他们两位的粉丝，我们属于不同年代。',
          startMs: 1_000,
          endMs: 4_000,
          provider: 'openai-asr',
        },
      ],
      language: 'zh',
    });

    expect(segment.topic).toBe('三人对话');
    expect(segment.nodes).toEqual([
      expect.objectContaining({
        id: expect.stringMatching(/^segment_.*:n1$/),
        text: '说话者也是两位嘉宾的粉丝',
      }),
      expect.objectContaining({
        id: expect.stringMatching(/^segment_.*:n2$/),
        text: '三人来自不同年代',
      }),
    ]);
  });

  it('AliyunStructurerProvider 遇到 nodes 数组里的带引号对象片段时，仍会保留其余合法节点', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content:
                '{"topic":"测试策略决策","nodes":[{"id":"n1","type":"claim","text":"日常调试默认应使用 Structure-focused 测试"},"{\\"id\\":\\"n2\\",\\"type\\":\\"reason\\",\\"text\\":\\"ASR 额度有限\\"}",{"id":"n3","type":"claim","text":"全流程 E2E 应保留作为低频验收层"}],"edges":[{"source":"n2","target":"n1","type":"causes"}]}',
            },
          },
        ],
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const provider = new AliyunStructurerProvider({
      type: 'aliyun',
      mode: 'direct',
      apiKey: 'aliyun-secret',
      language: 'zh',
    });

    const segment = await provider.extractSegmentGraph({
      sessionId: 'session_aliyun_quoted_object',
      transcriptWindow: [
        {
          chunkId: 'chunk_aliyun_quoted_object_1',
          sessionId: 'session_aliyun_quoted_object',
          text: '日常调试默认应使用 Structure-focused 测试，因为 ASR 额度有限。',
          startMs: 1_000,
          endMs: 4_000,
          provider: 'openai-asr',
        },
      ],
      language: 'zh',
    });

    expect(segment.topic).toBe('测试策略决策');
    expect(segment.nodes).toEqual([
      expect.objectContaining({
        id: expect.stringMatching(/^segment_.*:n1$/),
        text: '日常调试默认应使用 Structure-focused 测试',
      }),
      expect.objectContaining({
        id: expect.stringMatching(/^segment_.*:n3$/),
        text: '全流程 E2E 应保留作为低频验收层',
      }),
    ]);
  });

  it('AliyunStructurerProvider 会从 JSON 后附带解释文本的 content 中提取第一个完整 JSON 对象', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content:
                '{"topic":"辩论风格互补","nodes":[{"id":"n1","type":"claim","text":"两人辩论风格互补"}],"edges":[]}\n\n补充说明：这里的核心是风格互补。',
            },
          },
        ],
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const provider = new AliyunStructurerProvider({
      type: 'aliyun',
      mode: 'direct',
      apiKey: 'aliyun-secret',
      language: 'zh',
    });

    const segment = await provider.extractSegmentGraph({
      sessionId: 'session_aliyun_extracted',
      transcriptWindow: [
        {
          chunkId: 'chunk_aliyun_extracted_1',
          sessionId: 'session_aliyun_extracted',
          text: '两个人组队之后风格互补。',
          startMs: 1_000,
          endMs: 4_000,
          provider: 'openai-asr',
        },
      ],
      language: 'zh',
    });

    expect(segment.topic).toBe('辩论风格互补');
    expect(segment.nodes).toEqual([
      expect.objectContaining({
        id: expect.stringMatching(/^segment_.*:n1$/),
        text: '两人辩论风格互补',
      }),
    ]);
  });

  it('OpenAIStructurerProvider 遇到超时会直接失败而不重试', async () => {
    const timeoutError = new Error('aborted');
    timeoutError.name = 'AbortError';
    const fetchMock = vi.fn().mockRejectedValue(timeoutError);
    vi.stubGlobal('fetch', fetchMock);

    const provider = new OpenAIStructurerProvider({
      type: 'openai',
      mode: 'direct',
      endpoint: 'https://api.openai.com/v1',
      apiKey: 'secret',
      model: 'gpt-4.1-mini',
      language: 'zh',
      retry: {
        maxAttempts: 3,
        baseDelayMs: 1,
        maxDelayMs: 1,
        timeoutMs: 123,
      },
    });

    await expect(
      provider.extractSegmentGraph({
        sessionId: 'session_timeout',
        transcriptWindow: [
          {
            chunkId: 'chunk_timeout_1',
            sessionId: 'session_timeout',
            text: '超时 transcript',
            startMs: 0,
            endMs: 10_000,
            provider: 'openai-asr',
          },
        ],
        language: 'zh',
      }),
    ).rejects.toMatchObject({
      code: 'TIMEOUT_ERROR',
      stage: 'structurer',
      attemptCount: 1,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
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
