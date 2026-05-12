// provider-management.ts — Provider 配置管理
// 从 index.ts 提取：loadProviderRuntimeFromSettings、applyProviderRuntime、
// applyBootstrapProviderRuntime、commitProviderRuntime、
// handleGetProviderSettings、handleSaveProviderSettings、handleClearProviderSecrets

import {
  createDefaultProviderConfig,
  normalizeProviderConfig,
  ProviderRequestError,
  redactProviderConfig,
  TencentAsrProvider,
} from '@listen-graphic/providers';
import type {
  ProviderConfig,
} from '@listen-graphic/schema';
import type { RuntimeStateContainer } from './runtime-state';
import {
  constrainProviderConfigToDirectMode,
  stripProviderRetryOverrides,
  mergeProviderSecrets,
  stripProviderSecrets,
  createExtensionDefaultProviderConfig,
} from './provider-config';
import { notifyProviderProgress } from './runtime-snapshot';
import type { ServiceWorkerResponse } from './sw-types';

export interface ProviderManagementDeps {
  S: RuntimeStateContainer;
  settingsRepository: {
    getProviderConfig(): Promise<ProviderConfig | null | undefined>;
    saveProviderConfig(config: ProviderConfig): Promise<void>;
    clearProviderSecrets(): Promise<void>;
  };
  providerRegistry: {
    createRuntimeProviders(config: Partial<ProviderConfig> | ProviderConfig): {
      config: ProviderConfig;
      asr: any;
      structurer: any;
    };
  };
  persistRuntimeState: () => Promise<void>;
}

export async function loadProviderRuntimeFromSettings(deps: ProviderManagementDeps) {
  const storedConfig = await deps.settingsRepository.getProviderConfig();
  applyProviderRuntime(
    constrainProviderConfigToDirectMode(
      normalizeProviderConfig(storedConfig ?? createExtensionDefaultProviderConfig()),
    ),
    deps,
  );
}

export function applyProviderRuntime(
  config: Partial<ProviderConfig> | ProviderConfig,
  deps: ProviderManagementDeps,
) {
  const runtime = deps.providerRegistry.createRuntimeProviders(config);
  commitProviderRuntime(runtime, deps);
}

export function applyBootstrapProviderRuntime(deps: ProviderManagementDeps) {
  const runtime = deps.providerRegistry.createRuntimeProviders(createDefaultProviderConfig());
  deps.S.asrProvider = runtime.asr;
  deps.S.structurerProvider = runtime.structurer;
}

export function commitProviderRuntime(
  runtime: ReturnType<ProviderManagementDeps['providerRegistry']['createRuntimeProviders']>,
  deps: ProviderManagementDeps,
) {
  const { S } = deps;
  S.activeProviderConfig = runtime.config;
  S.providerSummary = redactProviderConfig(S.activeProviderConfig);
  S.asrProvider = runtime.asr;
  S.structurerProvider = runtime.structurer;

  if (S.asrProvider instanceof TencentAsrProvider) {
    S.asrProvider.setProgressListener((message) => {
      void notifyProviderProgress('asr', message);
    });
  }
}

export async function handleGetProviderSettings(
  deps: ProviderManagementDeps,
): Promise<ServiceWorkerResponse> {
  const storedConfig = await deps.settingsRepository.getProviderConfig();
  const config = stripProviderSecrets(
    constrainProviderConfigToDirectMode(
      normalizeProviderConfig(
        stripProviderRetryOverrides(storedConfig ?? createExtensionDefaultProviderConfig()),
      ),
    ),
  );
  return {
    success: true,
    config,
  } as ServiceWorkerResponse & { config: ProviderConfig };
}

export async function handleSaveProviderSettings(
  config: ProviderConfig,
  deps: ProviderManagementDeps,
): Promise<ServiceWorkerResponse> {
  const existingConfig = await deps.settingsRepository.getProviderConfig();
  const normalized = stripProviderRetryOverrides(mergeProviderSecrets(
    constrainProviderConfigToDirectMode(normalizeProviderConfig(config)),
    existingConfig
      ? normalizeProviderConfig(stripProviderRetryOverrides(existingConfig))
      : undefined,
  ));
  const runtime = deps.providerRegistry.createRuntimeProviders(normalized);
  await deps.settingsRepository.saveProviderConfig(normalized);
  commitProviderRuntime(runtime, deps);
  await deps.persistRuntimeState();
  return { success: true };
}

export async function handleClearProviderSecrets(
  deps: ProviderManagementDeps,
): Promise<ServiceWorkerResponse> {
  await deps.settingsRepository.clearProviderSecrets();
  const fallbackConfig = stripProviderRetryOverrides(createExtensionDefaultProviderConfig());
  await deps.settingsRepository.saveProviderConfig(fallbackConfig);
  applyBootstrapProviderRuntime(deps);
  deps.S.activeProviderConfig = fallbackConfig;
  deps.S.providerSummary = redactProviderConfig(fallbackConfig);
  await deps.persistRuntimeState();
  return { success: true };
}
