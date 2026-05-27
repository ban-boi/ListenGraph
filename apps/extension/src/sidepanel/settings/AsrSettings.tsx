// ---------------------------------------------------------------------------
// AsrSettings —— ASR 配置 Tab 页
// 从 SettingsPanel.tsx 提取的 ASR（stageKey === 'asr'）渲染逻辑
// ---------------------------------------------------------------------------

import type { ProviderConfig } from '@listen-graphic/schema';
import {
  LabeledField,
  InputField,
  SelectField,
  SectionHeader,
} from './FormControls';
import { SecretField } from './SecretField';
import { CollapsibleSection } from './CollapsibleSection';
import { cardStyle, hintTextStyle, colors, spacing } from './theme';
import { getProviderTypeSelectValue } from '../provider-helpers';

// ── 类型 ──────────────────────────────────────────────────────────────────

export type CredentialState = {
  apiKeyConfigured: boolean;
  secretConfigured: boolean;
  bridgeAuthTokenConfigured: boolean;
};

export type AsrSettingsProps = {
  config: ProviderConfig['asr'];
  /** 由父组件（SettingsOverlay）预计算后传入 */
  credentialState: CredentialState;
  bridgeHealth: { status: string; detail?: string };
  onUpdateEntry: (field: keyof ProviderConfig['asr'], value: string) => void;
  onProviderTypeChange: (nextType: string) => void;
};

// ── 样式常量 ──────────────────────────────────────────────────────────────

/** 腾讯云信息卡片底色 */
const tencentInfoCardStyle = {
  padding: 8,
  backgroundColor: '#f0f9ff',
  borderRadius: 4,
  fontSize: 10,
  color: '#0369a1',
  lineHeight: 1.5,
} as const;

/** External bridge 信息卡片底色 */
const externalInfoCardStyle = {
  padding: 8,
  backgroundColor: '#ecfeff',
  borderRadius: 4,
  fontSize: 10,
  color: '#155e75',
  lineHeight: 1.5,
} as const;

/** Bridge 状态卡样式 */
const bridgeHealthCardStyle = (status: string) => ({
  padding: 8,
  backgroundColor:
    status === 'error'
      ? '#fef2f2'
      : status === 'listening'
        ? '#ecfdf5'
        : '#f8fafc',
  border: `1px solid ${colors.cardBorder}`,
  borderRadius: 4,
  fontSize: 10,
  color: colors.text,
});

// ── 组件 ──────────────────────────────────────────────────────────────────

export function AsrSettings({
  config,
  credentialState,
  bridgeHealth,
  onUpdateEntry,
  onProviderTypeChange,
}: AsrSettingsProps) {
  const type = config.type;

  return (
    <div style={{ display: 'grid', gap: spacing.fieldGap }}>
      {/* 1. Provider Type 下拉框 */}
      <LabeledField label="ASR Provider Type">
        <SelectField
          ariaLabel="ASR Provider Type"
          value={getProviderTypeSelectValue('asr', config)}
          onChange={onProviderTypeChange}
        >
          <option value="mock">Mock (测试)</option>
          <option value="openai">OpenAI</option>
          <option value="tencent">腾讯云</option>
          <option value="external">Local ASR Bridge</option>
        </SelectField>
      </LabeledField>

      {/* 2. 腾讯云信息卡片 */}
      {type === 'tencent' && (
        <div style={tencentInfoCardStyle}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>腾讯云 ASR 配置</div>
          <div>免费额度：10小时/月</div>
          <div>价格：0.7-1.5元/小时</div>
          <div>推荐区域：华东地区(上海)</div>
          <div style={{ marginTop: 4, fontSize: 9, color: '#0c4a6e' }}>
            获取密钥：console.cloud.tencent.com/cam/capi
          </div>
        </div>
      )}

      {/* 3. Transport 下拉框 —— 腾讯云 */}
      {type === 'tencent' && (
        <LabeledField label="Tencent Transport">
          <SelectField
            ariaLabel="Tencent Transport"
            value={config.transport ?? 'ws'}
            onChange={(v) => onUpdateEntry('transport', v)}
          >
            <option value="batch">Batch</option>
            <option value="ws">Realtime WebSocket</option>
          </SelectField>
        </LabeledField>
      )}

      {/* 3. Transport 下拉框 —— External */}
      {type === 'external' && (
        <LabeledField label="Local Bridge Transport">
          <SelectField
            ariaLabel="Local Bridge Transport"
            value={config.transport ?? 'ws'}
            onChange={(v) => onUpdateEntry('transport', v)}
          >
            <option value="ws">WebSocket</option>
          </SelectField>
        </LabeledField>
      )}

      {/* 4. Endpoint 输入框（非 tencent 时显示） */}
      {type !== 'tencent' && (
        <LabeledField label="ASR Endpoint">
          <InputField
            ariaLabel="ASR Endpoint"
            value={config.endpoint ?? ''}
            onChange={(v) => onUpdateEntry('endpoint', v)}
          />
        </LabeledField>
      )}

      {/* 5. Model 输入框 */}
      <LabeledField
        label={type === 'tencent' ? 'Engine Model' : 'ASR Model'}
      >
        <InputField
          ariaLabel={type === 'tencent' ? 'Tencent Engine Model' : 'ASR Model'}
          value={config.model ?? ''}
          onChange={(v) => onUpdateEntry('model', v)}
        />
      </LabeledField>

      {/* 6. External 专有字段 */}
      {type === 'external' && (
        <>
          {/* Bridge Protocol */}
          <LabeledField label="Bridge Protocol">
            <InputField
              ariaLabel="Local Bridge Protocol"
              value={config.bridgeProtocol ?? ''}
              onChange={(v) => onUpdateEntry('bridgeProtocol', v)}
              placeholder="lg-asr-ws-v1"
            />
          </LabeledField>

          {/* Bridge Auth Token */}
          <SecretField
            ariaLabel="Local Bridge Auth Token"
            label="Bridge Auth Token"
            value={config.bridgeAuthToken ?? ''}
            onChange={(v) => onUpdateEntry('bridgeAuthToken', v)}
            configured={credentialState.bridgeAuthTokenConfigured}
            placeholder="可选"
          />

          {/* Local Bridge Health 状态卡 */}
          <div
            data-testid="local-bridge-health"
            style={bridgeHealthCardStyle(bridgeHealth.status)}
          >
            <div style={{ fontWeight: 600 }}>
              Bridge 状态: {bridgeHealth.status}
            </div>
            <div style={{ marginTop: 4 }}>
              {bridgeHealth.detail ?? '保存设置后开始会话，可看到连接/握手状态'}
            </div>
          </div>
        </>
      )}

      {/* 7. 腾讯云密钥字段 */}
      {type === 'tencent' && (
        <>
          {/* App ID */}
          <LabeledField label="Tencent App ID">
            <InputField
              ariaLabel="Tencent App ID"
              value={config.appId ?? ''}
              onChange={(v) => onUpdateEntry('appId', v)}
              placeholder="例如 1250000000"
            />
          </LabeledField>

          {/* Secret ID */}
          <SecretField
            ariaLabel="Tencent Secret ID"
            label="Secret ID"
            value={config.secretId ?? ''}
            onChange={(v) => onUpdateEntry('secretId', v)}
            configured={credentialState.secretConfigured}
            placeholder="AKIDxxxxxxxxxxxx"
          />

          {/* Secret Key */}
          <SecretField
            ariaLabel="Tencent Secret Key"
            label="Secret Key"
            value={config.secretKey ?? ''}
            onChange={(v) => onUpdateEntry('secretKey', v)}
            configured={credentialState.secretConfigured}
            placeholder="xxxxxxxxxxxxxxxx"
          />

          {/* Region */}
          <LabeledField label="Region (区域)">
            <SelectField
              ariaLabel="Tencent Region"
              value={config.region ?? 'ap-shanghai'}
              onChange={(v) => onUpdateEntry('region', v)}
            >
              <option value="ap-shanghai">华东地区(上海) - 推荐</option>
              <option value="ap-guangzhou">华南地区(广州)</option>
              <option value="ap-beijing">华北地区(北京)</option>
              <option value="ap-chengdu">西南地区(成都)</option>
            </SelectField>
          </LabeledField>

          {/* 8. 腾讯云 WebSocket 高级参数 */}
          {config.transport === 'ws' && (
            <CollapsibleSection title="高级参数" defaultCollapsed={true}>
              {/* Need VAD */}
              <LabeledField label="Need VAD">
                <SelectField
                  ariaLabel="Tencent Need VAD"
                  value={String(config.needVad ?? true)}
                  onChange={(v) => onUpdateEntry('needVad', v)}
                >
                  <option value="true">开启</option>
                  <option value="false">关闭</option>
                </SelectField>
              </LabeledField>

              {/* VAD Silence Time */}
              <LabeledField label="VAD Silence Time (ms)">
                <InputField
                  ariaLabel="Tencent VAD Silence Time"
                  type="number"
                  value={config.vadSilenceTimeMs != null ? String(config.vadSilenceTimeMs) : ''}
                  onChange={(v) => onUpdateEntry('vadSilenceTimeMs', v)}
                  placeholder="1000"
                />
              </LabeledField>

              {/* Max Speak Time */}
              <LabeledField label="Max Speak Time (ms)">
                <InputField
                  ariaLabel="Tencent Max Speak Time"
                  type="number"
                  value={config.maxSpeakTimeMs != null ? String(config.maxSpeakTimeMs) : ''}
                  onChange={(v) => onUpdateEntry('maxSpeakTimeMs', v)}
                  placeholder="60000"
                />
              </LabeledField>

              {/* Hotword ID */}
              <LabeledField label="Hotword ID">
                <InputField
                  ariaLabel="Tencent Hotword ID"
                  value={config.hotwordId ?? ''}
                  onChange={(v) => onUpdateEntry('hotwordId', v)}
                />
              </LabeledField>

              {/* Hotword List */}
              <LabeledField label="Hotword List">
                <InputField
                  ariaLabel="Tencent Hotword List"
                  value={config.hotwordList ?? ''}
                  onChange={(v) => onUpdateEntry('hotwordList', v)}
                  placeholder="腾讯云|10,语音识别|5"
                />
              </LabeledField>

              {/* Word Info */}
              <LabeledField label="Word Info">
                <InputField
                  ariaLabel="Tencent Word Info"
                  type="number"
                  value={config.wordInfo != null ? String(config.wordInfo) : ''}
                  onChange={(v) => onUpdateEntry('wordInfo', v)}
                  placeholder="0"
                />
              </LabeledField>
            </CollapsibleSection>
          )}
        </>
      )}

      {/* 9. 通用 API Key（非 tencent、非 external 时） */}
      {type !== 'tencent' && type !== 'external' && (
        <SecretField
          ariaLabel="ASR API Key"
          label="ASR API Key"
          value={config.apiKey ?? ''}
          onChange={(v) => onUpdateEntry('apiKey', v)}
          configured={credentialState.apiKeyConfigured}
          placeholder="请输入 API Key"
        />
      )}

      {/* 10. Language 输入框 */}
      <LabeledField label="ASR Language">
        <InputField
          ariaLabel="ASR Language"
          value={config.language ?? ''}
          onChange={(v) => onUpdateEntry('language', v)}
        />
      </LabeledField>
    </div>
  );
}
