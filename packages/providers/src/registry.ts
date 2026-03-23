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
import { OpenAIAsrProvider } from './asr/openai-asr';
import { OpenAIStructurerProvider } from './structurer/openai-structurer';

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

      requireProviderCredential(config, 'ASR provider');
      return new OpenAIAsrProvider(config);
    },
    getStructurerProvider(config) {
      if (config.type === 'mock') {
        return new MockStructurerProvider();
      }

      requireProviderCredential(config, 'Structurer provider');
      return new OpenAIStructurerProvider(config);
    },
  };
}
