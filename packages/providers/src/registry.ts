import type {
  AsrProvider,
  AsrProviderConfig,
  ProviderConfig,
  StructurerProvider,
  StructurerProviderConfig,
} from '@listen-graphic/schema';
import {
  createDefaultProviderConfig,
  normalizeProviderConfig,
  type PartialProviderConfig,
  requireProviderCredential,
} from './config';
import { MockAsrProvider } from './mock/mock-asr';
import { MockStructurerProvider } from './mock/mock-structurer';
import { ExternalBridgeAsrProvider } from './asr/external-bridge-asr';
import { OpenAIAsrProvider } from './asr/openai-asr';
import { TencentAsrProvider } from './asr/tencent-asr';
import { AliyunStructurerProvider } from './structurer/aliyun-structurer';
import { BaiduStructurerProvider } from './structurer/baidu-structurer';
import { OpenAIStructurerProvider } from './structurer/openai-structurer';
import { ZhipuStructurerProvider } from './structurer/zhipu-structurer';

export interface ProviderRegistry {
  createRuntimeProviders(config?: PartialProviderConfig | null): {
    config: ProviderConfig;
    asr: AsrProvider;
    structurer: StructurerProvider;
  };
  getAsrProvider(config: AsrProviderConfig): AsrProvider;
  getStructurerProvider(config: StructurerProviderConfig): StructurerProvider;
}

export function createProviderRegistry(): ProviderRegistry {
  return {
    createRuntimeProviders(config) {
      const normalized = normalizeProviderConfig(config ?? createDefaultProviderConfig());
      return {
        config: normalized,
        asr: this.getAsrProvider(normalized.asr),
        structurer: this.getStructurerProvider(normalized.structurer),
      };
    },
    getAsrProvider(config) {
      if (config.type === 'mock') {
        return new MockAsrProvider();
      }

      if (config.type === 'tencent') {
        requireProviderCredential(config, 'Tencent ASR provider');
        return new TencentAsrProvider(config);
      }

      if (config.type === 'external') {
        requireProviderCredential(config, 'External ASR bridge');
        return new ExternalBridgeAsrProvider(config);
      }

      requireProviderCredential(config, 'ASR provider');
      return new OpenAIAsrProvider(config);
    },
    getStructurerProvider(config) {
      if (config.type === 'mock') {
        return new MockStructurerProvider();
      }

      if (config.type === 'zhipu') {
        requireProviderCredential(config, 'Zhipu structurer provider');
        return new ZhipuStructurerProvider(config);
      }

      if (config.type === 'baidu') {
        requireProviderCredential(config, 'Baidu structurer provider');
        return new BaiduStructurerProvider(config);
      }

      if (config.type === 'aliyun') {
        requireProviderCredential(config, 'Aliyun structurer provider');
        return new AliyunStructurerProvider(config);
      }

      requireProviderCredential(config, 'Structurer provider');
      return new OpenAIStructurerProvider(config);
    },
  };
}
