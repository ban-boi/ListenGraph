import type { StructurerProviderConfig } from '@listen-graphic/schema';
import { OpenAIStructurerProvider } from './openai-structurer';

export class ZhipuStructurerProvider extends OpenAIStructurerProvider {
  override name = 'zhipu-structurer';

  constructor(config: StructurerProviderConfig) {
    super({
      ...config,
      endpoint: config.endpoint ?? 'https://open.bigmodel.cn/api/paas/v4',
      model: config.model ?? 'glm-4.7-flash',
    });
  }
}
