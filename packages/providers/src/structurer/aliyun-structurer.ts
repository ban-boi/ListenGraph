import type { StructurerProviderConfig } from '@listen-graphic/schema';
import { OpenAIStructurerProvider } from './openai-structurer';

export class AliyunStructurerProvider extends OpenAIStructurerProvider {
  override name = 'aliyun-structurer';

  constructor(config: StructurerProviderConfig) {
    super({
      ...config,
      endpoint: config.endpoint ?? 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      model: config.model ?? 'qwen-plus',
    });
  }
}
