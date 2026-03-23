import type {
  AsrProviderConfig,
  ProviderConfig,
  ProviderRetryPolicy,
  ProviderRuntimeEntrySummary,
  ProviderRuntimeSummary,
  StructurerProviderConfig,
} from '@listen-graphic/schema';

export type PartialProviderConfig = {
  asr?: Partial<AsrProviderConfig>;
  structurer?: Partial<StructurerProviderConfig>;
};

const DEFAULT_RETRY_POLICY: ProviderRetryPolicy = {
  maxAttempts: 3,
  baseDelayMs: 400,
  maxDelayMs: 2_000,
  timeoutMs: 15_000,
  retryableStatusCodes: [408, 409, 425, 429, 500, 502, 503, 504],
};

const DEFAULT_ASR_CONFIG: AsrProviderConfig = {
  type: 'mock',
  mode: 'direct',
  model: 'mock-asr',
  language: 'zh',
  retry: DEFAULT_RETRY_POLICY,
};

const DEFAULT_STRUCTURER_CONFIG: StructurerProviderConfig = {
  type: 'mock',
  mode: 'direct',
  model: 'mock-structurer',
  language: 'zh',
  retry: DEFAULT_RETRY_POLICY,
};

export function createDefaultProviderConfig(): ProviderConfig {
  return {
    asr: { ...DEFAULT_ASR_CONFIG, retry: { ...DEFAULT_RETRY_POLICY } },
    structurer: {
      ...DEFAULT_STRUCTURER_CONFIG,
      retry: { ...DEFAULT_RETRY_POLICY },
    },
  };
}

export function normalizeProviderConfig(
  input?: PartialProviderConfig | null,
): ProviderConfig {
  const defaults = createDefaultProviderConfig();
  return {
    asr: normalizeEntry({
      defaults: defaults.asr,
      input: input?.asr,
      openAiDefaults: {
        endpoint: 'https://api.openai.com/v1',
        model: 'gpt-4o-mini-transcribe',
      },
    }),
    structurer: normalizeEntry({
      defaults: defaults.structurer,
      input: input?.structurer,
      openAiDefaults: {
        endpoint: 'https://api.openai.com/v1',
        model: 'gpt-4.1-mini',
      },
    }),
  };
}

export function redactProviderConfig(config: ProviderConfig): ProviderRuntimeSummary {
  return {
    asr: summarizeEntry(config.asr),
    structurer: summarizeEntry(config.structurer),
  };
}

function normalizeEntry<T extends AsrProviderConfig | StructurerProviderConfig>(params: {
  defaults: T;
  input?: Partial<T>;
  openAiDefaults: {
    endpoint: string;
    model: string;
  };
}): T {
  const merged = {
    ...params.defaults,
    ...params.input,
  } as T;

  merged.language = merged.language ?? params.defaults.language ?? 'zh';
  merged.mode = merged.mode ?? 'direct';
  merged.retry = {
    ...DEFAULT_RETRY_POLICY,
    ...params.defaults.retry,
    ...params.input?.retry,
  };

  if (merged.type === 'openai') {
    merged.endpoint = merged.endpoint ?? params.openAiDefaults.endpoint;
    if (!params.input?.model || params.input.type === 'openai') {
      merged.model = params.input?.model ?? params.openAiDefaults.model;
    }
  } else {
    merged.model = merged.model ?? params.defaults.model;
  }

  return merged;
}

function summarizeEntry(
  config: AsrProviderConfig | StructurerProviderConfig,
): ProviderRuntimeEntrySummary {
  return {
    type: config.type,
    mode: config.mode,
    endpoint: config.endpoint,
    model: config.model,
    language: config.language,
    apiKeyConfigured: Boolean(config.apiKey),
    sessionTokenConfigured: Boolean(config.sessionToken),
  };
}

export function clearProviderSecrets(config: ProviderConfig): ProviderConfig {
  return {
    asr: {
      ...config.asr,
      apiKey: undefined,
      sessionToken: undefined,
    },
    structurer: {
      ...config.structurer,
      apiKey: undefined,
      sessionToken: undefined,
    },
  };
}

export function requireProviderCredential(
  config: AsrProviderConfig | StructurerProviderConfig,
  label: string,
) {
  if (config.type === 'mock') {
    return;
  }

  if (config.mode === 'direct' && !config.apiKey) {
    throw new Error(`${label} requires an API key for direct mode`);
  }

  if (config.mode === 'relay' && !config.sessionToken) {
    throw new Error(`${label} requires a session token for relay mode`);
  }
}

export { DEFAULT_RETRY_POLICY };
