import {
  normalizeProviderConfig,
  ProviderRequestError,
} from '@listen-graphic/providers';
import type {
  ProviderConfig,
  SerializableProviderError,
} from '@listen-graphic/schema';

// ===== Provider 错误类型守卫 =====

export function isTimeoutProviderError(error: unknown) {
  return error instanceof ProviderRequestError && error.code === 'TIMEOUT_ERROR';
}

export function isSerializableProviderRequestError(
  error: unknown,
): error is SerializableProviderError & Error {
  if (!error || typeof error !== 'object' || !(error instanceof Error)) {
    return false;
  }
  const e = error as unknown as Record<string, unknown>;
  return (
    typeof e.code === 'string' &&
    typeof e.provider === 'string' &&
    typeof e.stage === 'string' &&
    typeof e.retriable === 'boolean'
  );
}

// ===== Provider 错误序列化 =====

export type SerializeErrorFallbackContext = {
  stage?: 'asr' | 'structurer';
  providerName?: string;
};

export function serializeProviderError(
  error: unknown,
  fallback?: SerializeErrorFallbackContext,
): SerializableProviderError {
  if (error instanceof ProviderRequestError) {
    return sanitizeProviderError(error.toJSON());
  }

  if (isSerializableProviderRequestError(error)) {
    return sanitizeProviderError({
      code: error.code,
      message: error.message,
      provider: error.provider,
      stage: error.stage,
      retriable: error.retriable,
      status: error.status,
      attemptCount: error.attemptCount,
      structurerDiagnostics: error.structurerDiagnostics,
    });
  }

  const stage = fallback?.stage ?? 'asr';
  const provider = fallback?.providerName ?? 'unknown-provider';
  const code = stage === 'structurer' ? 'STRUCTURE_ERROR' : 'TRANSCRIBE_ERROR';

  return sanitizeProviderError({
    code,
    message:
      error instanceof Error ? error.message : 'Provider 请求发生未知错误',
    provider,
    stage,
    retriable: false,
  });
}

export function createProviderConfigError(message: string): SerializableProviderError {
  const normalizedMessage = message || '读取 provider 配置失败';
  const normalizedLowerMessage = normalizedMessage.toLowerCase();
  const stage =
    normalizedLowerMessage.includes('asr') || normalizedLowerMessage.includes('transcrib')
      ? 'asr'
      : 'structurer';

  return sanitizeProviderError({
    code: 'CONFIG_ERROR',
    message: normalizedMessage,
    provider: 'provider-config',
    stage,
    retriable: false,
  });
}

export function sanitizeProviderError(error: SerializableProviderError): SerializableProviderError {
  return {
    ...error,
    message: error.message || 'Provider request failed',
  };
}

export function normalizeAsrErrorCode(code: string): SerializableProviderError['code'] {
  switch (code) {
    case 'AUTH_ERROR':
    case 'RATE_LIMIT_ERROR':
    case 'NETWORK_ERROR':
    case 'TIMEOUT_ERROR':
    case 'INVALID_RESPONSE':
    case 'CONFIG_ERROR':
    case 'TRANSCRIBE_ERROR':
      return code;
    default:
      return 'TRANSCRIBE_ERROR';
  }
}

// ===== Provider 配置纯函数 =====

export function mergeProviderSecrets(
  nextConfig: ProviderConfig,
  existingConfig?: ProviderConfig,
): ProviderConfig {
  if (!existingConfig) {
    return nextConfig;
  }

  return {
    asr: {
      ...nextConfig.asr,
      apiKey:
        nextConfig.asr.apiKey ??
        (nextConfig.asr.type === existingConfig.asr.type ? existingConfig.asr.apiKey : undefined),
      sessionToken:
        nextConfig.asr.sessionToken ??
        (nextConfig.asr.type === existingConfig.asr.type &&
        nextConfig.asr.mode === existingConfig.asr.mode
          ? existingConfig.asr.sessionToken
          : undefined),
      bridgeAuthToken:
        nextConfig.asr.bridgeAuthToken ??
        (nextConfig.asr.type === existingConfig.asr.type &&
        nextConfig.asr.type === 'external' &&
        nextConfig.asr.mode === existingConfig.asr.mode
          ? existingConfig.asr.bridgeAuthToken
          : undefined),
      secretId:
        nextConfig.asr.secretId ??
        (nextConfig.asr.type === existingConfig.asr.type &&
        nextConfig.asr.type === 'tencent' &&
        nextConfig.asr.mode === 'direct'
          ? existingConfig.asr.secretId
          : undefined),
      secretKey:
        nextConfig.asr.secretKey ??
        (nextConfig.asr.type === existingConfig.asr.type &&
        nextConfig.asr.type === 'tencent' &&
        nextConfig.asr.mode === 'direct'
          ? existingConfig.asr.secretKey
          : undefined),
    },
    structurer: {
      ...nextConfig.structurer,
      apiKey:
        nextConfig.structurer.apiKey ??
        (nextConfig.structurer.type === existingConfig.structurer.type
          ? existingConfig.structurer.apiKey
          : undefined),
      sessionToken:
        nextConfig.structurer.sessionToken ??
        (nextConfig.structurer.type === existingConfig.structurer.type &&
        nextConfig.structurer.mode === existingConfig.structurer.mode
          ? existingConfig.structurer.sessionToken
          : undefined),
    },
  };
}

export function constrainProviderConfigToDirectMode(config: ProviderConfig): ProviderConfig {
  return {
    asr: {
      ...config.asr,
      mode: 'direct',
      sessionToken: undefined,
    },
    structurer: {
      ...config.structurer,
      mode: 'direct',
      sessionToken: undefined,
    },
  };
}

export function stripProviderRetryOverrides(config: ProviderConfig): ProviderConfig {
  return {
    asr: {
      ...config.asr,
      retry: undefined,
    },
    structurer: {
      ...config.structurer,
      retry: undefined,
    },
  };
}

export function hasProviderRetryOverrides(config: Partial<ProviderConfig> | null | undefined) {
  return Boolean(config?.asr?.retry || config?.structurer?.retry);
}

export function stripProviderSecrets(config: ProviderConfig): ProviderConfig {
  return {
    asr: {
      ...config.asr,
      apiKey: undefined,
      sessionToken: undefined,
      bridgeAuthToken: undefined,
      secretId: undefined,
      secretKey: undefined,
    },
    structurer: {
      ...config.structurer,
      apiKey: undefined,
      sessionToken: undefined,
    },
  };
}

export function createExtensionDefaultProviderConfig(): ProviderConfig {
  return normalizeProviderConfig({
    asr: {
      type: 'tencent',
      mode: 'direct',
      transport: 'ws',
      model: '16k_zh',
      needVad: true,
      language: 'zh',
    },
    structurer: {
      type: 'aliyun',
      mode: 'direct',
      language: 'zh',
    },
  });
}

// ===== 类型转换辅助 =====

export function toRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
}
