import { describe, expect, it } from 'vitest';
import {
  createDefaultProviderConfig,
  createProviderRegistry,
  normalizeProviderConfig,
  redactProviderConfig,
  type ProviderConfig,
  type ProviderRuntimeSummary,
} from '@listen-graphic/providers';

describe('provider registry contract', () => {
  it('会把不完整配置补齐为可运行的默认 mock 配置', () => {
    const config = normalizeProviderConfig({
      asr: { type: 'openai', apiKey: 'asr-secret' },
      structurer: { type: 'mock' },
    });

    expect(config).toEqual({
      asr: expect.objectContaining({
        type: 'openai',
        mode: 'direct',
        endpoint: 'https://api.openai.com/v1',
        apiKey: 'asr-secret',
        model: 'gpt-4o-mini-transcribe',
        language: 'zh',
      }),
      structurer: expect.objectContaining({
        type: 'mock',
        mode: 'direct',
        model: 'mock-structurer',
      }),
    });
  });

  it('会在运行时摘要里隐藏密钥，但保留 provider 选择信息', () => {
    const config: ProviderConfig = {
      asr: {
        type: 'openai',
        mode: 'direct',
        endpoint: 'https://api.openai.com/v1',
        apiKey: 'asr-secret',
        model: 'gpt-4o-mini-transcribe',
        language: 'zh',
      },
      structurer: {
        type: 'openai',
        mode: 'relay',
        endpoint: 'https://relay.listen-graphic.local/v1',
        sessionToken: 'relay-session-token',
        model: 'gpt-4.1-mini',
        language: 'zh',
      },
    };

    const summary = redactProviderConfig(config);

    expect(summary).toEqual<ProviderRuntimeSummary>({
      asr: {
        type: 'openai',
        mode: 'direct',
        endpoint: 'https://api.openai.com/v1',
        model: 'gpt-4o-mini-transcribe',
        language: 'zh',
        apiKeyConfigured: true,
        sessionTokenConfigured: false,
        secretConfigured: false,
      },
      structurer: {
        type: 'openai',
        mode: 'relay',
        endpoint: 'https://relay.listen-graphic.local/v1',
        model: 'gpt-4.1-mini',
        language: 'zh',
        apiKeyConfigured: false,
        sessionTokenConfigured: true,
        secretConfigured: false,
      },
    });
  });

  it('腾讯 ASR 摘要会反映 secretId/secretKey 已配置状态，但不暴露具体值', () => {
    const summary = redactProviderConfig({
      asr: {
        type: 'tencent',
        mode: 'direct',
        region: 'ap-shanghai',
        secretId: 'secret-id',
        secretKey: 'secret-key',
        language: 'zh',
      },
      structurer: {
        type: 'mock',
        mode: 'direct',
        model: 'mock-structurer',
        language: 'zh',
      },
    });

    expect(summary.asr).toEqual(
      expect.objectContaining({
        type: 'tencent',
        apiKeyConfigured: false,
        sessionTokenConfigured: false,
        secretConfigured: true,
      }),
    );
  });

  it('registry 能根据配置构造 mock 与 openai provider', () => {
    const registry = createProviderRegistry();
    const defaultConfig = createDefaultProviderConfig();
    const mockProviders = registry.createRuntimeProviders(defaultConfig);

    expect(mockProviders.asr.name).toBe('mock-asr');
    expect(mockProviders.structurer.name).toBe('mock-structurer');

    const liveProviders = registry.createRuntimeProviders({
      asr: {
        type: 'openai',
        mode: 'direct',
        endpoint: 'https://api.openai.com/v1',
        apiKey: 'asr-secret',
        model: 'gpt-4o-mini-transcribe',
        language: 'zh',
      },
      structurer: {
        type: 'openai',
        mode: 'direct',
        endpoint: 'https://api.openai.com/v1',
        apiKey: 'structurer-secret',
        model: 'gpt-4.1-mini',
        language: 'zh',
      },
    });

    expect(liveProviders.asr.name).toBe('openai-asr');
    expect(liveProviders.structurer.name).toBe('openai-structurer');
  });

  it('智谱 structurer 会使用独立 provider 类型和默认 endpoint/model', () => {
    const registry = createProviderRegistry();
    const config = normalizeProviderConfig({
      asr: {
        type: 'mock',
      },
      structurer: {
        type: 'zhipu',
        mode: 'direct',
        apiKey: 'zhipu-secret',
      },
    });

    expect(config.structurer).toEqual(
      expect.objectContaining({
        type: 'zhipu',
        mode: 'direct',
        endpoint: 'https://open.bigmodel.cn/api/paas/v4',
        model: 'glm-4.7-flash',
        apiKey: 'zhipu-secret',
        language: 'zh',
      }),
    );

    const providers = registry.createRuntimeProviders(config);
    expect(providers.structurer.name).toBe('zhipu-structurer');
  });

  it('直连真实 provider 缺少密钥时会拒绝构造运行时 provider', () => {
    const registry = createProviderRegistry();

    expect(() =>
      registry.createRuntimeProviders({
        asr: {
          type: 'openai',
          mode: 'direct',
          endpoint: 'https://api.openai.com/v1',
          model: 'gpt-4o-mini-transcribe',
          language: 'zh',
        },
        structurer: {
          type: 'mock',
          mode: 'direct',
          model: 'mock-structurer',
          language: 'zh',
        },
      }),
    ).toThrow(/api key/i);
  });

  it('腾讯 direct 模式只有半套凭证时会拒绝构造运行时 provider', () => {
    const registry = createProviderRegistry();

    expect(() =>
      registry.createRuntimeProviders({
        asr: {
          type: 'tencent',
          mode: 'direct',
          secretId: 'only-secret-id',
          language: 'zh',
        },
        structurer: {
          type: 'mock',
          mode: 'direct',
          model: 'mock-structurer',
          language: 'zh',
        },
      }),
    ).toThrow(/secretId and secretKey/i);

    expect(() =>
      registry.createRuntimeProviders({
        asr: {
          type: 'tencent',
          mode: 'direct',
          secretKey: 'only-secret-key',
          language: 'zh',
        },
        structurer: {
          type: 'mock',
          mode: 'direct',
          model: 'mock-structurer',
          language: 'zh',
        },
      }),
    ).toThrow(/secretId and secretKey/i);

    expect(() =>
      registry.createRuntimeProviders({
        asr: {
          type: 'tencent',
          mode: 'direct',
          apiKey: 'missing-secret-key-part',
          language: 'zh',
        },
        structurer: {
          type: 'mock',
          mode: 'direct',
          model: 'mock-structurer',
          language: 'zh',
        },
      }),
    ).toThrow(/secretId and secretKey/i);
  });

  it('腾讯 direct 模式接受成对密钥或 legacy apiKey', () => {
    const registry = createProviderRegistry();

    expect(
      registry.createRuntimeProviders({
        asr: {
          type: 'tencent',
          mode: 'direct',
          secretId: 'secret-id',
          secretKey: 'secret-key',
          language: 'zh',
        },
        structurer: {
          type: 'mock',
          mode: 'direct',
          model: 'mock-structurer',
          language: 'zh',
        },
      }).asr.name,
    ).toBe('tencent-asr');

    expect(
      registry.createRuntimeProviders({
        asr: {
          type: 'tencent',
          mode: 'direct',
          apiKey: 'secret-id:secret-key',
          language: 'zh',
        },
        structurer: {
          type: 'mock',
          mode: 'direct',
          model: 'mock-structurer',
          language: 'zh',
        },
      }).asr.name,
    ).toBe('tencent-asr');
  });

  it('腾讯 ASR 默认化时不会继承 mock 模型占位值', () => {
    const config = normalizeProviderConfig({
      asr: {
        type: 'tencent',
        mode: 'direct',
        secretId: 'secret-id',
        secretKey: 'secret-key',
        region: 'ap-shanghai',
      },
      structurer: {
        type: 'mock',
      },
    });

    expect(config.asr).toEqual(
      expect.objectContaining({
        type: 'tencent',
        mode: 'direct',
        region: 'ap-shanghai',
        language: 'zh',
      }),
    );
    expect(config.asr.model).toBeUndefined();
    expect(config.asr.endpoint).toBeUndefined();
  });
});
