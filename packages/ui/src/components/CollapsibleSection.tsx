import { useState, type ReactNode } from 'react';

export type CollapsibleSectionProps = {
  title: string;
  defaultCollapsed?: boolean;
  children: ReactNode;
};

export function CollapsibleSection({
  title,
  defaultCollapsed = true,
  children,
}: CollapsibleSectionProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  return (
    <section className="lg-collapsible-section">
      <button
        type="button"
        className="lg-collapsible-section__header"
        aria-expanded={!collapsed}
        onClick={() => setCollapsed((current) => !current)}
      >
        <span>{title}</span>
        <span aria-hidden="true" className="lg-collapsible-section__chevron">
          {collapsed ? '>' : 'v'}
        </span>
      </button>
      {collapsed ? null : (
        <div className="lg-collapsible-section__body">{children}</div>
      )}
    </section>
  );
}
