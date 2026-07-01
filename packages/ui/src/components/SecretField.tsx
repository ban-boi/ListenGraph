import { useState } from 'react';
import { LabeledField } from './FormControls';

export type SecretFieldProps = {
  ariaLabel: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  configured: boolean;
  placeholder?: string;
};

function EyeIcon({ hidden }: { hidden: boolean }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="lg-secret-field__icon">
      <path
        d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle
        cx="12"
        cy="12"
        r="2.8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      {hidden ? null : (
        <path
          d="M4 20 20 4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      )}
    </svg>
  );
}

export function SecretField({
  ariaLabel,
  label,
  value,
  onChange,
  configured,
  placeholder,
}: SecretFieldProps) {
  const [revealed, setRevealed] = useState(false);
  const resolvedPlaceholder = configured
    ? '已保存，留空保持不变'
    : (placeholder ?? `请输入${label}`);

  return (
    <LabeledField label={label}>
      <span className="lg-secret-field">
        <input
          className="lg-input lg-secret-field__input"
          aria-label={ariaLabel}
          type={revealed ? 'text' : 'password'}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={resolvedPlaceholder}
        />
        <button
          type="button"
          className="lg-secret-field__toggle"
          aria-label={`${revealed ? '隐藏' : '显示'} ${label}`}
          onClick={() => setRevealed((current) => !current)}
        >
          <EyeIcon hidden={!revealed} />
        </button>
      </span>
      {configured ? (
        <span className="lg-form-hint">已保存{label}，留空则保持不变</span>
      ) : null}
    </LabeledField>
  );
}
