import { useTheme } from '../hooks/useTheme';

export type ToolbarPrimaryAction = {
  label: string;
  onClick: () => void;
  /** 是否处于活跃状态（运行中） */
  active?: boolean;
  /** 是否禁用 */
  disabled?: boolean;
};

export type GraphToolbarProps = {
  /** 品牌名称 */
  brandName: string;
  /** 主操作按钮（开始/停止） */
  primaryAction: ToolbarPrimaryAction;
  /** 右侧操作区 slot（设置、overflow 等） */
  actions?: React.ReactNode;
  /** 品牌区与操作区之间的信息 slot（fixture 状态等） */
  info?: React.ReactNode;
  /** 覆盖主题切换，默认显示内置主题按钮 */
  themeToggle?: React.ReactNode;
};

export function GraphToolbar({
  brandName,
  primaryAction,
  actions,
  info,
  themeToggle,
}: GraphToolbarProps) {
  const { theme, toggleTheme } = useTheme();

  return (
    <div className="lg-toolbar" style={{ gap: 8 }}>
      <div className="lg-toolbar__brand">
        <span style={{ fontWeight: 'var(--weight-bold)', fontSize: 'var(--text-base)' }}>
          {brandName}
        </span>
      </div>
      {info}
      <div className="lg-toolbar__actions">
        {themeToggle ?? (
          <button
            className="lg-btn lg-btn-ghost lg-btn-sm"
            onClick={toggleTheme}
            title="切换主题"
          >
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>
        )}
        {actions}
      </div>
      <button
        className={
          primaryAction.active
            ? 'lg-btn lg-btn-danger lg-btn-sm'
            : 'lg-btn lg-btn-primary lg-btn-sm'
        }
        onClick={primaryAction.onClick}
        disabled={primaryAction.disabled}
        style={{ marginLeft: 'auto' }}
      >
        {primaryAction.label}
      </button>
    </div>
  );
}
