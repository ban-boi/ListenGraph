import type { StructurerProviderConfig } from '@listen-graphic/schema';
import { DEFAULT_RETRY_POLICY } from '../config';
import { OpenAIStructurerProvider } from './openai-structurer';

export class BaiduStructurerProvider extends OpenAIStructurerProvider {
  override name = 'baidu-structurer';

  constructor(config: StructurerProviderConfig) {
    super({
      ...config,
      endpoint: config.endpoint ?? 'https://qianfan.baidubce.com/v2',
      model: config.model ?? 'ernie-speed-8k',
      retry: {
        ...config.retry,
        retryableStatusCodes:
          config.retry?.retryableStatusCodes ?? DEFAULT_RETRY_POLICY.retryableStatusCodes,
      },
    });
  }
}
