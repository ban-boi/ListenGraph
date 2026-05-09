import type { ProviderConfig, ProviderRuntimeSummary } from '@listen-graphic/schema';
import { normalizeProviderConfig } from '@listen-graphic/providers';
import { ZHIPU_ENDPOINT_CODING_PLAN } from './constants';

export function renderSecretHint(params: {
  configured: boolean;
  label: string;
}) {
  if (!params.configured) {
    return (
      <div style={{ fontSize: 10, color: '#64748b' }}>
        未保存 {params.label}
      </div>
    );
  }

  return (
    <div style={{ fontSize: 10, color: '#0369a1' }}>
      已保存 {params.label}，留空则保持不变
    </div>
  );
}

export function getStageCredentialState(
  summary: ProviderRuntimeSummary,
  stageKey: keyof ProviderConfig,
) {
  const entry = summary[stageKey];
  const isTencentAsr = stageKey === 'asr' && entry.type === 'tencent';
  const isExternalAsr = stageKey === 'asr' && entry.type === 'external';

  return {
    apiKeyConfigured: entry.apiKeyConfigured,
    sessionTokenConfigured: entry.sessionTokenConfigured,
    secretConfigured: isTencentAsr ? Boolean(entry.secretConfigured) : false,
    bridgeAuthTokenConfigured: isExternalAsr ? Boolean(entry.bridgeAuthTokenConfigured) : false,
  };
}

export function pinProviderConfigToDirectMode(config: ProviderConfig): ProviderConfig {
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

export function createExtensionDefaultProviderConfigForUi(): ProviderConfig {
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

export function getProviderTypeSelectValue(
  stage: keyof ProviderConfig,
  entry: ProviderConfig[keyof ProviderConfig],
) {
  if (
    stage === 'structurer' &&
    entry.type === 'zhipu' &&
    entry.endpoint === ZHIPU_ENDPOINT_CODING_PLAN
  ) {
    return 'zhipu-coding-plan';
  }

  return entry.type;
}

export function resetProviderEntryForTypeChange(
  stage: keyof ProviderConfig,
  nextType: ProviderConfig[keyof ProviderConfig]['type'],
  config: ProviderConfig,
): ProviderConfig {
  const nextConfig: ProviderConfig = {
    ...config,
    [stage]: {
      ...config[stage],
      type: nextType as never,
      endpoint: undefined,
      apiKey: undefined,
      sessionToken: undefined,
      model: undefined,
      region: undefined,
      transport: undefined,
      bridgeProtocol: undefined,
      bridgeAuthToken: undefined,
      appId: undefined,
      needVad: undefined,
      vadSilenceTimeMs: undefined,
      maxSpeakTimeMs: undefined,
      hotwordId: undefined,
      hotwordList: undefined,
      wordInfo: undefined,
      secretId: undefined,
      secretKey: undefined,
    },
  };

  return pinProviderConfigToDirectMode(normalizeProviderConfig(nextConfig));
}
