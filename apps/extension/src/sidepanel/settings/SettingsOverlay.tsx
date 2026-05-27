// ---------------------------------------------------------------------------
// SettingsOverlay —— 设置页面全页覆盖层
// 包含竖排 Tab 导航、底部操作栏、Toast 反馈、dirty guard
// ---------------------------------------------------------------------------

import { useState, useCallback } from 'react';
import type {
  ProviderConfig,
  ProviderRuntimeSummary,
  GraphDisplaySettings,
} from '@listen-graphic/schema';
import type { BridgeHealth } from '../panel-reducer';
import { AsrSettings } from './AsrSettings';
import { StructurerSettings } from './StructurerSettings';
import { DisplaySettings } from './DisplaySettings';
import { Button } from './FormControls';
import { Toast, useToast } from './Toast';
import { colors, layout } from './theme';
import { getStageCredentialState } from '../provider-helpers';

// ── 类型 ──────────────────────────────────────────────────────────────────

type SaveResult = { ok: true } | { ok: false; error: string };

type SettingsOverlayProps = {
  providerConfig: ProviderConfig;
  providerSummary: ProviderRuntimeSummary;
  settingsSaving: boolean;
  bridgeHealth: BridgeHealth;
  graphDisplaySettings: GraphDisplaySettings;
  isDirty: boolean;
  onUpdateProviderEntry: (
    stage: keyof ProviderConfig,
    field: keyof ProviderConfig['asr'],
    value: string,
  ) => void;
  onProviderTypeChange: (stage: keyof ProviderConfig, nextType: string) => void;
  onUpdateAutoFitMinReadableFontPx: (value: string) => void;
  onSaveSettings: () => Promise<SaveResult>;
  onClearSecrets: () => void;
  onClose: () => void;
};

type TabKey = 'asr' | 'structurer' | 'display';

const tabs: { key: TabKey; label: string }[] = [
  { key: 'asr', label: '语音识别' },
  { key: 'structurer', label: '结构化' },
  { key: 'display', label: '显示' },
];

// ── 组件 ──────────────────────────────────────────────────────────────────

export function SettingsOverlay({
  providerConfig,
  providerSummary,
  settingsSaving,
  bridgeHealth,
  graphDisplaySettings,
  isDirty,
  onUpdateProviderEntry,
  onProviderTypeChange,
  onUpdateAutoFitMinReadableFontPx,
  onSaveSettings,
  onClearSecrets,
  onClose,
}: SettingsOverlayProps) {
  const [activeTab, setActiveTab] = useState<TabKey>('asr');
  const { toast, showSuccess, showError, dismiss } = useToast();

  // 预计算 credential states
  const asrCredentialState = getStageCredentialState(providerSummary, 'asr');
  const structurerCredentialState = getStageCredentialState(providerSummary, 'structurer');

  // ── 处理函数 ────────────────────────────────────────────────────────────

  const handleSave = useCallback(async () => {
    const result = await onSaveSettings();
    if (result.ok) {
      showSuccess('设置已保存');
    } else {
      showError(result.error);
    }
  }, [onSaveSettings, showSuccess, showError]);

  const handleClear = useCallback(() => {
    if (!window.confirm('确定要清除所有已保存的密钥吗？此操作不可撤销。')) return;
    onClearSecrets();
    showSuccess('密钥已清除');
  }, [onClearSecrets, showSuccess]);

  const handleClose = useCallback(() => {
    if (isDirty && !window.confirm('有未保存的修改，确定离开？')) return;
    onClose();
  }, [isDirty, onClose]);

  // ── 渲染 ────────────────────────────────────────────────────────────────

  return (
    <div
      data-testid="settings-panel"
      style={{
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: colors.panelBg,
      }}
    >
      {/* 顶栏 */}
      <div
        style={{
          padding: '8px 12px',
          borderBottom: `1px solid ${colors.panelBorder}`,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <span
          style={{ cursor: 'pointer', fontSize: 12 }}
          onClick={handleClose}
        >
          {'<-'} 返回
        </span>
        <span style={{ fontWeight: 600, fontSize: 13 }}>设置</span>
      </div>

      {/* Toast */}
      <Toast
        message={toast.message}
        type={toast.type}
        onDismiss={dismiss}
      />

      {/* 主体：左侧 Tab + 右侧内容 */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* 左侧 Tab 导航 */}
        <div
          style={{
            width: layout.sidebarTabWidth,
            flexShrink: 0,
            borderRight: `1px solid ${colors.panelBorder}`,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {tabs.map((tab) => {
            const isActive = tab.key === activeTab;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                style={{
                  padding: '12px 8px',
                  fontSize: 11,
                  fontWeight: isActive ? 600 : 400,
                  color: isActive ? colors.primaryButton : colors.textSecondary,
                  backgroundColor: isActive ? 'white' : 'transparent',
                  borderLeft: isActive
                    ? `3px solid ${colors.primaryButton}`
                    : '3px solid transparent',
                  cursor: 'pointer',
                  textAlign: 'left' as const,
                }}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* 右侧内容区 */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 12px' }}>
          {activeTab === 'asr' && (
            <AsrSettings
              config={providerConfig.asr}
              credentialState={asrCredentialState}
              bridgeHealth={bridgeHealth}
              onUpdateEntry={(field, value) =>
                onUpdateProviderEntry('asr', field, value)
              }
              onProviderTypeChange={(nextType) =>
                onProviderTypeChange('asr', nextType)
              }
            />
          )}
          {activeTab === 'structurer' && (
            <StructurerSettings
              config={providerConfig.structurer}
              credentialState={structurerCredentialState}
              onUpdateEntry={(field, value) =>
                onUpdateProviderEntry('structurer', field, value)
              }
              onProviderTypeChange={(nextType) =>
                onProviderTypeChange('structurer', nextType)
              }
            />
          )}
          {activeTab === 'display' && (
            <DisplaySettings
              settings={graphDisplaySettings}
              onUpdateAutoFitMinReadableFontPx={onUpdateAutoFitMinReadableFontPx}
            />
          )}
        </div>
      </div>

      {/* 底部操作栏 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 12px',
          borderTop: `1px solid ${colors.panelBorder}`,
        }}
      >
        <div style={{ fontSize: 11 }}>
          {isDirty ? (
            <span style={{ color: '#dc2626' }}>有未保存的修改</span>
          ) : (
            <span style={{ color: colors.textSecondary }}>
              ASR: {providerSummary.asr.type} / Structurer:{' '}
              {providerSummary.structurer.type}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button variant="danger" onClick={handleClear}>
            清除密钥
          </Button>
          <Button
            variant="primary"
            onClick={handleSave}
            disabled={settingsSaving}
          >
            保存设置
          </Button>
        </div>
      </div>
    </div>
  );
}
