// ---------------------------------------------------------------------------
// 统一表单控件 —— 设置面板子组件共用
// 从 theme.ts 导入样式常量，避免各 Tab 页重复 inline style
// ---------------------------------------------------------------------------

import React from 'react';
import {
  fieldLabelStyle,
  inputStyle,
  selectStyle,
  buttonStyle,
  primaryButtonStyle,
  dangerButtonStyle,
  sectionHeaderStyle,
} from './theme';

// ── LabeledField ──────────────────────────────────────────────────────────

export type LabeledFieldProps = {
  label: string;
  children: React.ReactNode;
};

/** <label> 包裹 <span>标签 + children，使用 fieldLabelStyle */
export function LabeledField({ label, children }: LabeledFieldProps) {
  return (
    <label style={fieldLabelStyle}>
      <span>{label}</span>
      {children}
    </label>
  );
}

// ── InputField ────────────────────────────────────────────────────────────

export type InputFieldProps = {
  ariaLabel: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** 默认 'text' */
  type?: string;
};

/** 受控 <input>，onChange 简化为 (value: string) => void */
export function InputField({
  ariaLabel,
  value,
  onChange,
  placeholder,
  type = 'text',
}: InputFieldProps) {
  return (
    <input
      aria-label={ariaLabel}
      type={type}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      style={inputStyle}
    />
  );
}

// ── SelectField ───────────────────────────────────────────────────────────

export type SelectFieldProps = {
  ariaLabel: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
};

/** 受控 <select>，onChange 简化为 (value: string) => void */
export function SelectField({
  ariaLabel,
  value,
  onChange,
  children,
}: SelectFieldProps) {
  return (
    <select
      aria-label={ariaLabel}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={selectStyle}
    >
      {children}
    </select>
  );
}

// ── Button ────────────────────────────────────────────────────────────────

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'danger' | 'default';
};

/** 根据 variant 选择 primary / danger / default 样式 */
export function Button({
  variant = 'default',
  style,
  ...rest
}: ButtonProps) {
  const base =
    variant === 'primary'
      ? primaryButtonStyle
      : variant === 'danger'
        ? dangerButtonStyle
        : buttonStyle;

  return <button style={style ? { ...base, ...style } : base} {...rest} />;
}

// ── SectionHeader ─────────────────────────────────────────────────────────

export type SectionHeaderProps = {
  children: React.ReactNode;
};

/** 区块标题，使用 sectionHeaderStyle */
export function SectionHeader({ children }: SectionHeaderProps) {
  return <div style={sectionHeaderStyle}>{children}</div>;
}
