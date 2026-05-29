import { useState, type ReactNode } from 'react';
import { sectionHeaderStyle, colors, spacing } from './theme';

// ---------------------------------------------------------------------------
// 可折叠分组 —— 用于高级参数的渐进式披露
// ---------------------------------------------------------------------------

type CollapsibleSectionProps = {
  title: string;
  /** 默认 true（折叠） */
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
    <div>
      {/* 标题行 */}
      <div
        onClick={() => setCollapsed((prev) => !prev)}
        style={{
          ...sectionHeaderStyle,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          cursor: 'pointer',
          userSelect: 'none',
          padding: `${spacing.fieldGap}px 0`,
          color: colors.text,
          fontSize: 'var(--text-xs)',
          borderRadius: 2,
          transition: 'background-color 0.15s',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.backgroundColor = colors.panelBg;
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = 'transparent';
        }}
      >
        <span>{title}</span>
        <span style={{ fontSize: 'var(--text-2xs)', lineHeight: 1 }}>
          {collapsed ? '▶' : '▼'}
        </span>
      </div>

      {/* 内容区 —— 折叠时不渲染 */}
      {!collapsed && children}
    </div>
  );
}
