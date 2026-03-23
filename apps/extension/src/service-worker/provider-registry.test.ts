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
      },
      structurer: {
        type: 'openai',
        mode: 'relay',
        endpoint: 'https://relay.listen-graphic.local/v1',
        model: 'gpt-4.1-mini',
        language: 'zh',
        apiKeyConfigured: false,
        sessionTokenConfigured: true,
      },
    });
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
});
