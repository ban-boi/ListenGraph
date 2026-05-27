// ---------------------------------------------------------------------------
// SecretField —— 密钥字段复合组件
// 统一替代 SettingsPanel 中密码输入框 + renderSecretHint 的组合模式
// ---------------------------------------------------------------------------

import type { CSSProperties, ChangeEvent, ReactNode } from 'react';
import { LabeledField } from './FormControls';
import { inputStyle, hintTextStyle, colors } from './theme';

// ── 类型 ──────────────────────────────────────────────────────────────────

export type SecretFieldProps = {
  /** 英文 aria-label，保持测试兼容性，如 'Tencent Secret ID' */
  ariaLabel: string;
  /** 用户可见的中文标签，如 'Secret ID' */
  label: string;
  /** 当前输入值 */
  value: string;
  /** 值变更回调 */
  onChange: (value: string) => void;
  /** 是否已保存过密钥（决定 placeholder 和提示文案） */
  configured: boolean;
  /** 未配置时的占位文字，默认为 '请输入{label}' */
  placeholder?: string;
};

// ── 样式 ──────────────────────────────────────────────────────────────────

const configuredHintStyle: CSSProperties = {
  ...hintTextStyle,
  color: colors.textHint,
};

// ── 组件 ──────────────────────────────────────────────────────────────────

/**
 * 密钥字段复合组件。
 *
 * - configured=true  → placeholder 显示「已保存，留空保持不变」，下方提示「已保存{label}，留空则保持不变」
 * - configured=false → 使用传入 placeholder 或默认「请输入{label}」
 */
export function SecretField({
  ariaLabel,
  label,
  value,
  onChange,
  configured,
  placeholder,
}: SecretFieldProps): ReactNode {
  const resolvedPlaceholder = configured
    ? '已保存，留空保持不变'
    : (placeholder ?? `请输入${label}`);

  const hint: ReactNode = configured ? (
    <div style={configuredHintStyle}>
      已保存{label}，留空则保持不变
    </div>
  ) : null;

  return (
    <LabeledField label={label}>
      <input
        aria-label={ariaLabel}
        type="password"
        value={value}
        onChange={(event: ChangeEvent<HTMLInputElement>) =>
          onChange(event.target.value)
        }
        placeholder={resolvedPlaceholder}
        style={inputStyle}
      />
      {hint}
    </LabeledField>
  );
}
