import type { ButtonHTMLAttributes, ReactNode } from 'react';

export type LabeledFieldProps = {
  label: string;
  hint?: string;
  children: ReactNode;
};

export function LabeledField({ label, hint, children }: LabeledFieldProps) {
  return (
    <label className="lg-form-field">
      <span className="lg-form-label">{label}</span>
      {children}
      {hint ? <span className="lg-form-hint">{hint}</span> : null}
    </label>
  );
}

export type InputFieldProps = {
  ariaLabel: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  error?: boolean;
};

export function InputField({
  ariaLabel,
  value,
  onChange,
  placeholder,
  type = 'text',
  error = false,
}: InputFieldProps) {
  return (
    <input
      className={`lg-input${error ? ' lg-input--error' : ''}`}
      aria-label={ariaLabel}
      type={type}
      value={value}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

export type SelectFieldProps = {
  ariaLabel: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
};

export function SelectField({
  ariaLabel,
  value,
  onChange,
  children,
}: SelectFieldProps) {
  return (
    <select
      className="lg-input"
      aria-label={ariaLabel}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      {children}
    </select>
  );
}

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'danger' | 'default';
};

export function Button({ variant = 'default', className, ...rest }: ButtonProps) {
  const variantClass =
    variant === 'primary'
      ? 'lg-btn-primary'
      : variant === 'danger'
        ? 'lg-btn-danger'
        : 'lg-btn-secondary';
  return (
    <button
      className={['lg-btn', variantClass, className ?? ''].filter(Boolean).join(' ')}
      {...rest}
    />
  );
}

export type SectionHeaderProps = {
  children: ReactNode;
};

export function SectionHeader({ children }: SectionHeaderProps) {
  return <div className="lg-form-section-header">{children}</div>;
}
