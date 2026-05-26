import type { ProviderConfig, ProviderRuntimeSummary } from '@listen-graphic/schema';
import type { GraphDisplaySettings } from '../shared/messages';
import type { StatusCardData } from './types';
import {
  renderSecretHint,
  getStageCredentialState,
  getProviderTypeSelectValue,
} from './provider-helpers';

export type SettingsPanelProps = {
  providerConfig: ProviderConfig;
  providerSummary: ProviderRuntimeSummary;
  settingsSaving: boolean;
  bridgeHealth: {
    status: 'idle' | 'connecting' | 'connected' | 'listening' | 'closing' | 'closed' | 'error';
    detail?: string;
  };
  graphDisplaySettings: GraphDisplaySettings;
  onUpdateProviderEntry: (
    stage: keyof ProviderConfig,
    field: keyof ProviderConfig['asr'],
    value: string,
  ) => void;
  onProviderTypeChange: (
    stage: keyof ProviderConfig,
    nextType: string,
  ) => void;
  onUpdateAutoFitMinReadableFontPx: (value: string) => void;
  onSaveSettings: () => void;
  onClearSecrets: () => void;
};

export function SettingsPanel({
  providerConfig,
  providerSummary,
  settingsSaving,
  bridgeHealth,
  graphDisplaySettings,
  onUpdateProviderEntry,
  onProviderTypeChange,
  onUpdateAutoFitMinReadableFontPx,
  onSaveSettings,
  onClearSecrets,
}: SettingsPanelProps) {
  return (
    <div
      data-testid="settings-panel"
      style={{
        borderBottom: '1px solid #e5e7eb',
        backgroundColor: '#f8fafc',
        padding: '10px 12px',
        display: 'grid',
        gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
        gap: 12,
        fontSize: 11,
      }}
    >
      {(
        [
          ['asr', 'ASR'],
          ['structurer', 'Structurer'],
        ] as const
      ).map(([stageKey, label]) => {
        const credentialState = getStageCredentialState(providerSummary, stageKey);

        return <div
          key={stageKey}
          style={{
            border: '1px solid #dbe4ee',
            borderRadius: 6,
            padding: 10,
            backgroundColor: 'white',
            display: 'grid',
            gap: 6,
          }}
        >
          <div style={{ fontWeight: 600 }}>{label}</div>
          <label style={{ display: 'grid', gap: 4 }}>
            <span>{label} Provider Type</span>
            <select
              aria-label={`${label} Provider Type`}
              value={getProviderTypeSelectValue(stageKey, providerConfig[stageKey])}
              onChange={(event) =>
                onProviderTypeChange(stageKey, event.target.value)
              }
            >
              <option value="mock">Mock (测试)</option>
              <option value="openai">OpenAI</option>
              {stageKey === 'asr' && <option value="tencent">腾讯云</option>}
              {stageKey === 'asr' && <option value="external">Local ASR Bridge</option>}
              {stageKey === 'structurer' && <option value="aliyun">阿里云百炼</option>}
              {stageKey === 'structurer' && <option value="baidu">百度千帆</option>}
              {stageKey === 'structurer' && <option value="zhipu">智谱 GLM</option>}
              {stageKey === 'structurer' && (
                <option value="zhipu-coding-plan">智谱 GLM（Coding Plan）</option>
              )}
            </select>
          </label>
          {providerConfig[stageKey].type === 'tencent' && stageKey === 'asr' && (
            <div style={{
              padding: '8px',
              backgroundColor: '#f0f9ff',
              borderRadius: 4,
              fontSize: 10,
              color: '#0369a1',
              lineHeight: 1.5
            }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>腾讯云 ASR 配置</div>
              <div>免费额度：10小时/月</div>
              <div>价格：0.7-1.5元/小时</div>
              <div>推荐区域：华东地区(上海)</div>
              <div style={{ marginTop: 4, fontSize: 9, color: '#0c4a6e' }}>
                获取密钥：console.cloud.tencent.com/cam/capi
              </div>
            </div>
          )}
          {providerConfig[stageKey].type === 'external' && stageKey === 'asr' && (
            <div style={{
              padding: '8px',
              backgroundColor: '#ecfeff',
              borderRadius: 4,
              fontSize: 10,
              color: '#155e75',
              lineHeight: 1.5,
            }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>Local ASR Bridge</div>
              <div>通过本地 WebSocket bridge 接入任意本地 ASR</div>
              <div>当前协议：LG-ASR-WS v1</div>
              <div>推荐地址：ws://127.0.0.1:15377/ws</div>
            </div>
          )}
          {providerConfig[stageKey].type === 'tencent' && stageKey === 'asr' && (
            <label style={{ display: 'grid', gap: 4 }}>
              <span>Tencent Transport</span>
              <select
                aria-label="Tencent Transport"
                value={providerConfig.asr.transport ?? 'ws'}
                onChange={(event) =>
                  onUpdateProviderEntry(stageKey, 'transport', event.target.value)
                }
              >
                <option value="batch">Batch</option>
                <option value="ws">Realtime WebSocket</option>
              </select>
            </label>
          )}
          {providerConfig[stageKey].type === 'external' && stageKey === 'asr' && (
            <label style={{ display: 'grid', gap: 4 }}>
              <span>Local Bridge Transport</span>
              <select
                aria-label="Local Bridge Transport"
                value={providerConfig.asr.transport ?? 'ws'}
                onChange={(event) =>
                  onUpdateProviderEntry(stageKey, 'transport', event.target.value)
                }
              >
                <option value="ws">WebSocket</option>
              </select>
            </label>
          )}
          {!(stageKey === 'asr' && providerConfig[stageKey].type === 'tencent') && (
            <label style={{ display: 'grid', gap: 4 }}>
              <span>{label} Endpoint</span>
              <input
                aria-label={`${label} Endpoint`}
                value={providerConfig[stageKey].endpoint ?? ''}
                onChange={(event) =>
                  onUpdateProviderEntry(stageKey, 'endpoint', event.target.value)
                }
              />
            </label>
          )}
          <label style={{ display: 'grid', gap: 4 }}>
            <span>{stageKey === 'asr' && providerConfig[stageKey].type === 'tencent' ? 'Engine Model' : `${label} Model`}</span>
            <input
              aria-label={stageKey === 'asr' && providerConfig[stageKey].type === 'tencent' ? 'Tencent Engine Model' : `${label} Model`}
              value={providerConfig[stageKey].model ?? ''}
              onChange={(event) =>
                onUpdateProviderEntry(stageKey, 'model', event.target.value)
              }
            />
          </label>
          {providerConfig[stageKey].type === 'external' && stageKey === 'asr' && (
            <>
              <label style={{ display: 'grid', gap: 4 }}>
                <span>Bridge Protocol</span>
                <input
                  aria-label="Local Bridge Protocol"
                  value={providerConfig.asr.bridgeProtocol ?? ''}
                  onChange={(event) =>
                    onUpdateProviderEntry(stageKey, 'bridgeProtocol', event.target.value)
                  }
                  placeholder="lg-asr-ws-v1"
                />
              </label>
              <label style={{ display: 'grid', gap: 4 }}>
                <span>Bridge Auth Token</span>
                <input
                  aria-label="Local Bridge Auth Token"
                  type="password"
                  value={providerConfig.asr.bridgeAuthToken ?? ''}
                  onChange={(event) =>
                    onUpdateProviderEntry(stageKey, 'bridgeAuthToken', event.target.value)
                  }
                  placeholder={
                    credentialState.bridgeAuthTokenConfigured
                      ? '已保存，留空保持不变'
                      : '可选'
                  }
                />
                {renderSecretHint({
                  configured: credentialState.bridgeAuthTokenConfigured,
                  label: 'Bridge Auth Token',
                })}
              </label>
              <div
                data-testid="local-bridge-health"
                style={{
                  padding: '8px',
                  backgroundColor:
                    bridgeHealth.status === 'error'
                      ? '#fef2f2'
                      : bridgeHealth.status === 'listening'
                        ? '#ecfdf5'
                        : '#f8fafc',
                  border: '1px solid #dbe4ee',
                  borderRadius: 4,
                  fontSize: 10,
                  color: '#334155',
                }}
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
          {/* 腾讯云：独立的 Secret ID 和 Secret Key 输入框 */}
          {providerConfig[stageKey].type === 'tencent' && stageKey === 'asr' ? (
            <>
              <label style={{ display: 'grid', gap: 4 }}>
                <span>Tencent App ID</span>
                <input
                  aria-label="Tencent App ID"
                  value={providerConfig[stageKey].appId ?? ''}
                  onChange={(event) =>
                    onUpdateProviderEntry(stageKey, 'appId', event.target.value)
                  }
                  placeholder="例如 1250000000"
                />
              </label>
              <label style={{ display: 'grid', gap: 4 }}>
                <span>Secret ID</span>
                <input
                  aria-label="Tencent Secret ID"
                  type="password"
                  value={providerConfig[stageKey].secretId ?? ''}
                  onChange={(event) =>
                    onUpdateProviderEntry(stageKey, 'secretId', event.target.value)
                  }
                  placeholder={
                    credentialState.secretConfigured
                      ? '已保存，留空保持不变'
                      : 'AKIDxxxxxxxxxxxx'
                  }
                />
                {renderSecretHint({
                  configured: credentialState.secretConfigured,
                  label: 'Secret ID / Secret Key',
                })}
              </label>
              <label style={{ display: 'grid', gap: 4 }}>
                <span>Secret Key</span>
                <input
                  aria-label="Tencent Secret Key"
                  type="password"
                  value={providerConfig[stageKey].secretKey ?? ''}
                  onChange={(event) =>
                    onUpdateProviderEntry(stageKey, 'secretKey', event.target.value)
                  }
                  placeholder={
                    credentialState.secretConfigured
                      ? '已保存，留空保持不变'
                      : 'xxxxxxxxxxxxxxxx'
                  }
                />
              </label>
              <label style={{ display: 'grid', gap: 4 }}>
                <span>Region (区域)</span>
                <select
                  aria-label="Tencent Region"
                  value={providerConfig[stageKey].region ?? 'ap-shanghai'}
                  onChange={(event) =>
                    onUpdateProviderEntry(stageKey, 'region', event.target.value)
                  }
                >
                  <option value="ap-shanghai">华东地区(上海) - 推荐</option>
                  <option value="ap-guangzhou">华南地区(广州)</option>
                  <option value="ap-beijing">华北地区(北京)</option>
                  <option value="ap-chengdu">西南地区(成都)</option>
                </select>
              </label>
              {providerConfig.asr.transport === 'ws' && (
                <>
                  <label style={{ display: 'grid', gap: 4 }}>
                    <span>Need VAD</span>
                    <select
                      aria-label="Tencent Need VAD"
                      value={String(providerConfig.asr.needVad ?? true)}
                      onChange={(event) =>
                        onUpdateProviderEntry(stageKey, 'needVad', event.target.value)
                      }
                    >
                      <option value="true">开启</option>
                      <option value="false">关闭</option>
                    </select>
                  </label>
                  <label style={{ display: 'grid', gap: 4 }}>
                    <span>VAD Silence Time (ms)</span>
                    <input
                      aria-label="Tencent VAD Silence Time"
                      type="number"
                      value={providerConfig.asr.vadSilenceTimeMs ?? ''}
                      onChange={(event) =>
                        onUpdateProviderEntry(stageKey, 'vadSilenceTimeMs', event.target.value)
                      }
                      placeholder="1000"
                    />
                  </label>
                  <label style={{ display: 'grid', gap: 4 }}>
                    <span>Max Speak Time (ms)</span>
                    <input
                      aria-label="Tencent Max Speak Time"
                      type="number"
                      value={providerConfig.asr.maxSpeakTimeMs ?? ''}
                      onChange={(event) =>
                        onUpdateProviderEntry(stageKey, 'maxSpeakTimeMs', event.target.value)
                      }
                      placeholder="60000"
                    />
                  </label>
                  <label style={{ display: 'grid', gap: 4 }}>
                    <span>Hotword ID</span>
                    <input
                      aria-label="Tencent Hotword ID"
                      value={providerConfig.asr.hotwordId ?? ''}
                      onChange={(event) =>
                        onUpdateProviderEntry(stageKey, 'hotwordId', event.target.value)
                      }
                    />
                  </label>
                  <label style={{ display: 'grid', gap: 4 }}>
                    <span>Hotword List</span>
                    <input
                      aria-label="Tencent Hotword List"
                      value={providerConfig.asr.hotwordList ?? ''}
                      onChange={(event) =>
                        onUpdateProviderEntry(stageKey, 'hotwordList', event.target.value)
                      }
                      placeholder="腾讯云|10,语音识别|5"
                    />
                  </label>
                  <label style={{ display: 'grid', gap: 4 }}>
                    <span>Word Info</span>
                    <input
                      aria-label="Tencent Word Info"
                      type="number"
                      value={providerConfig.asr.wordInfo ?? ''}
                      onChange={(event) =>
                        onUpdateProviderEntry(stageKey, 'wordInfo', event.target.value)
                      }
                      placeholder="0"
                    />
                  </label>
                </>
              )}
            </>
          ) : providerConfig[stageKey].type === 'external' && stageKey === 'asr' ? null : (
            /* 其他 provider：通用的 API Key 输入框 */
            <label style={{ display: 'grid', gap: 4 }}>
              <span>{label} API Key</span>
              <input
                aria-label={`${label} API Key`}
                type="password"
                value={providerConfig[stageKey].apiKey ?? ''}
                onChange={(event) =>
                  onUpdateProviderEntry(stageKey, 'apiKey', event.target.value)
                }
                placeholder={
                  credentialState.apiKeyConfigured
                    ? '已保存，留空保持不变'
                    : '请输入 API Key'
                }
              />
              {renderSecretHint({
                configured: credentialState.apiKeyConfigured,
                label: 'API Key',
              })}
            </label>
          )}
          <label style={{ display: 'grid', gap: 4 }}>
            <span>{label} Language</span>
            <input
              aria-label={`${label} Language`}
              value={providerConfig[stageKey].language ?? ''}
              onChange={(event) =>
                onUpdateProviderEntry(stageKey, 'language', event.target.value)
              }
            />
          </label>
        </div>;
      })}
      <div
        style={{
          gridColumn: '1 / -1',
          border: '1px solid #dbe4ee',
          borderRadius: 6,
          padding: 10,
          backgroundColor: 'white',
          display: 'grid',
          gap: 6,
        }}
      >
        <div style={{ fontWeight: 600 }}>图谱显示</div>
        <label style={{ display: 'grid', gap: 4 }}>
          <span>自动适配最小字号</span>
          <select
            aria-label="自动适配最小字号"
            value={String(graphDisplaySettings.autoFitMinReadableFontPx)}
            onChange={(event) =>
              onUpdateAutoFitMinReadableFontPx(event.target.value)
            }
          >
            <option value="10">10px</option>
            <option value="12">12px</option>
            <option value="14">14px</option>
            <option value="16">16px</option>
          </select>
        </label>
        <div style={{ color: '#64748b', fontSize: 10, lineHeight: 1.5 }}>
          只影响首次自动适配和手动适配视图；鼠标滚轮、触控板和 React Flow 控件缩放不受限制。
        </div>
      </div>
      <div
        style={{
          gridColumn: '1 / -1',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        <div style={{ color: '#64748b' }}>
          当前摘要:
          {` ASR=${providerSummary.asr.type} `}
          {`Structurer=${providerSummary.structurer.type}`}
          {providerSummary.asr.type === 'tencent'
            ? ` | ASR 密钥=${providerSummary.asr.secretConfigured ? '已保存' : '未保存'}`
            : providerSummary.asr.type === 'external'
              ? ` | Bridge Token=${providerSummary.asr.bridgeAuthTokenConfigured ? '已保存' : '未保存'}`
            : ` | ASR Key=${providerSummary.asr.apiKeyConfigured ? '已保存' : '未保存'}`}
          {` | Structurer Key=${providerSummary.structurer.apiKeyConfigured ? '已保存' : '未保存'}`}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => onClearSecrets()}>清除密钥</button>
          <button onClick={() => onSaveSettings()} disabled={settingsSaving}>
            {settingsSaving ? '保存中...' : '保存设置'}
          </button>
        </div>
      </div>
    </div>
  );
}
