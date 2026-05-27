// ---------------------------------------------------------------------------
// StructurerSettings —— 结构化服务配置 Tab 页
// 从 SettingsPanel.tsx 提取的 Structurer 阶段渲染逻辑
// credentialState 由父组件预计算后传入，不在内部调用 getStageCredentialState
// ---------------------------------------------------------------------------

import type { ProviderConfig } from '@listen-graphic/schema';
import {
  LabeledField,
  InputField,
  SelectField,
  SectionHeader,
} from './FormControls';
import { SecretField } from './SecretField';
import { spacing } from './theme';
import { getProviderTypeSelectValue } from '../provider-helpers';

// ── 类型 ──────────────────────────────────────────────────────────────────

export type CredentialState = {
  apiKeyConfigured: boolean;
};

export type StructurerSettingsProps = {
  config: ProviderConfig['structurer'];
  credentialState: CredentialState;
  onUpdateEntry: (
    field: keyof ProviderConfig['structurer'],
    value: string,
  ) => void;
  onProviderTypeChange: (nextType: string) => void;
};

// ── 组件 ──────────────────────────────────────────────────────────────────

/**
 * Structurer 配置 Tab 页。
 *
 * 精确复刻 SettingsPanel.tsx 中 stageKey === 'structurer' 列的全部行为：
 * Provider Type 下拉框 → Endpoint → Model → API Key → Language
 */
export function StructurerSettings({
  config,
  credentialState,
  onUpdateEntry,
  onProviderTypeChange,
}: StructurerSettingsProps) {
  return (
    <div style={{ display: 'grid', gap: spacing.fieldGap }}>
      <SectionHeader>Structurer</SectionHeader>

      {/* Provider Type 下拉框 */}
      <LabeledField label="Structurer Provider Type">
        <SelectField
          ariaLabel="Structurer Provider Type"
          value={getProviderTypeSelectValue('structurer', config)}
          onChange={onProviderTypeChange}
        >
          <option value="mock">Mock (测试)</option>
          <option value="openai">OpenAI</option>
          <option value="aliyun">阿里云百炼</option>
          <option value="baidu">百度千帆</option>
          <option value="zhipu">智谱 GLM</option>
          <option value="zhipu-coding-plan">智谱 GLM（Coding Plan）</option>
        </SelectField>
      </LabeledField>

      {/* Endpoint 输入框 */}
      <LabeledField label="Structurer Endpoint">
        <InputField
          ariaLabel="Structurer Endpoint"
          value={config.endpoint ?? ''}
          onChange={(v) => onUpdateEntry('endpoint', v)}
        />
      </LabeledField>

      {/* Model 输入框 */}
      <LabeledField label="Structurer Model">
        <InputField
          ariaLabel="Structurer Model"
          value={config.model ?? ''}
          onChange={(v) => onUpdateEntry('model', v)}
        />
      </LabeledField>

      {/* API Key 密钥字段 —— Structurer 不会是 tencent/external，总是显示 */}
      <SecretField
        ariaLabel="Structurer API Key"
        label="Structurer API Key"
        value={config.apiKey ?? ''}
        onChange={(v) => onUpdateEntry('apiKey', v)}
        configured={credentialState.apiKeyConfigured}
      />

      {/* Language 输入框 */}
      <LabeledField label="Structurer Language">
        <InputField
          ariaLabel="Structurer Language"
          value={config.language ?? ''}
          onChange={(v) => onUpdateEntry('language', v)}
        />
      </LabeledField>
    </div>
  );
}
