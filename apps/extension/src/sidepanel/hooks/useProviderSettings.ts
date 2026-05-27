/**
 * useProviderSettings.ts
 *
 * 从 App.tsx 提取的 provider 设置逻辑：
 * - providerConfig / providerSummary / settingsOpen / settingsSaving 状态
 * - provider settings 回调函数
 */

import { useState, useCallback, useRef } from 'react';
import type { ProviderConfig } from '@listen-graphic/schema';
import { normalizeProviderConfig, redactProviderConfig } from '@listen-graphic/providers';
import type { AppMessage } from '../../shared/messages';
import {
  pinProviderConfigToDirectMode,
  createExtensionDefaultProviderConfigForUi,
  resetProviderEntryForTypeChange,
} from '../provider-helpers';
import { ZHIPU_ENDPOINT_CODING_PLAN } from '../constants';
import type { PanelAction, BridgeHealth } from '../panel-reducer';

interface UseProviderSettingsOptions {
  addLog: (msg: string) => void;
  dispatch: React.Dispatch<PanelAction>;
}

export function useProviderSettings({ addLog, dispatch }: UseProviderSettingsOptions) {
  const [providerConfig, setProviderConfig] = useState<ProviderConfig>(() =>
    createExtensionDefaultProviderConfigForUi(),
  );
  const [providerSummary, setProviderSummary] = useState(() =>
    redactProviderConfig(createExtensionDefaultProviderConfigForUi()),
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);

  // bridgeHealth 通过 reducer 管理，此处仅提供本地辅助方法
  const [localBridgeHealth, setLocalBridgeHealth] = useState<BridgeHealth>({
    status: 'idle',
  });

  // dirty 追踪：记录最近一次已保存（或已加载）的快照
  const initialConfigRef = useRef<ProviderConfig | null>(null);

  const updateProviderEntry = useCallback(
    (
      stage: keyof ProviderConfig,
      field: keyof ProviderConfig['asr'],
      value: string,
    ) => {
      let normalizedValue: unknown = value === '' ? undefined : value;
      if (field === 'needVad') {
        normalizedValue = value === '' ? undefined : value === 'true';
      } else if (
        field === 'vadSilenceTimeMs' ||
        field === 'maxSpeakTimeMs' ||
        field === 'wordInfo'
      ) {
        normalizedValue =
          value === ''
            ? undefined
            : Number.isFinite(Number(value))
              ? Number(value)
              : undefined;
      }

      setProviderConfig((prev) => ({
        ...prev,
        [stage]: {
          ...prev[stage],
          [field]: normalizedValue,
        },
      }));
    },
    [],
  );

  const handleProviderTypeChange = useCallback(
    (stage: keyof ProviderConfig, nextType: string) => {
      setProviderConfig((prev) => {
        if (stage === 'structurer' && nextType === 'zhipu-coding-plan') {
          const nextConfig = resetProviderEntryForTypeChange(stage, 'zhipu', prev);
          return {
            ...nextConfig,
            structurer: {
              ...nextConfig.structurer,
              endpoint: ZHIPU_ENDPOINT_CODING_PLAN,
            },
          };
        }

        return resetProviderEntryForTypeChange(
          stage,
          nextType as ProviderConfig[keyof ProviderConfig]['type'],
          prev,
        );
      });
      if (stage === 'asr' && nextType !== 'external') {
        setLocalBridgeHealth({ status: 'idle' });
      }
    },
    [],
  );

  const handleToggleSettings = useCallback(async () => {
    const nextOpen = !settingsOpen;
    setSettingsOpen(nextOpen);

    if (!nextOpen) {
      return;
    }

    try {
      const response = (await chrome.runtime.sendMessage({
        type: 'GET_PROVIDER_SETTINGS',
        target: 'service-worker',
        payload: {},
      } as AppMessage)) as
        | { success: true; config: ProviderConfig }
        | { success: false; error?: string };

      if (!response?.success) {
        addLog(`加载设置失败: ${response?.error || '未知错误'}`);
        return;
      }

      const loaded = pinProviderConfigToDirectMode(normalizeProviderConfig(response.config));
      setProviderConfig(loaded);
      initialConfigRef.current = loaded;
      if (response.config.asr.type !== 'external') {
        setLocalBridgeHealth({ status: 'idle' });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '读取 provider 设置失败';
      addLog(`加载设置失败: ${message}`);
    }
  }, [addLog, settingsOpen]);

  type SaveResult = { ok: true } | { ok: false; error: string };

  const handleSaveSettings = useCallback(async (): Promise<SaveResult> => {
    setSettingsSaving(true);
    try {
      const normalized = pinProviderConfigToDirectMode(
        normalizeProviderConfig(providerConfig),
      );
      const response = await chrome.runtime.sendMessage({
        type: 'SAVE_PROVIDER_SETTINGS',
        target: 'service-worker',
        payload: {
          config: normalized,
        },
      } as AppMessage);

      if (!response?.success) {
        const error = response?.error || '保存失败';
        addLog(`保存设置失败: ${error}`);
        if (normalized.asr.type === 'external') {
          setLocalBridgeHealth({
            status: 'error',
            detail: error,
          });
        }
        return { ok: false, error };
      }

      setProviderConfig(normalized);
      setProviderSummary(redactProviderConfig(normalized));
      initialConfigRef.current = normalized; // 更新快照，清除 dirty
      if (normalized.asr.type === 'external') {
        setLocalBridgeHealth({
          status: 'idle',
          detail: 'Local ASR Bridge 设置已保存，开始会话后可检查连接状态',
        });
      } else {
        setLocalBridgeHealth({ status: 'idle' });
      }
      addLog('provider 设置已保存');
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : '保存 provider 设置失败';
      if (providerConfig.asr.type === 'external') {
        setLocalBridgeHealth({ status: 'error', detail: message });
      }
      addLog(`保存设置失败: ${message}`);
      return { ok: false, error: message };
    } finally {
      setSettingsSaving(false);
    }
  }, [addLog, providerConfig]);

  const handleClearSecrets = useCallback(async () => {
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'CLEAR_PROVIDER_SECRETS',
        target: 'service-worker',
        payload: {},
      } as AppMessage);

      if (!response?.success) {
        addLog(`清除密钥失败: ${response?.error || '未知错误'}`);
        return;
      }

      const fallbackConfig = createExtensionDefaultProviderConfigForUi();
      setProviderConfig(fallbackConfig);
      setProviderSummary(redactProviderConfig(fallbackConfig));
      addLog('provider 密钥已清除');
    } catch (error) {
      const message = error instanceof Error ? error.message : '清除 provider 密钥失败';
      addLog(`清除密钥失败: ${message}`);
    }
  }, [addLog]);

  return {
    providerConfig,
    providerSummary,
    setProviderSummary,
    settingsOpen,
    settingsSaving,
    localBridgeHealth,
    setLocalBridgeHealth,
    initialConfigRef,
    updateProviderEntry,
    handleProviderTypeChange,
    handleToggleSettings,
    handleSaveSettings,
    handleClearSecrets,
  };
}
