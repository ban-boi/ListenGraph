// ---------------------------------------------------------------------------
// 共享样式常量 —— 设置面板及子组件共用
// 提取自 SettingsPanel.tsx 的内联样式，后续所有设置组件统一引用
// 纯常量文件，不依赖 React 或任何其他模块
// ---------------------------------------------------------------------------

// ── 颜色 ──────────────────────────────────────────────────────────────────

export const colors = {
  /** 面板底色 */
  panelBg: '#f8fafc',
  /** 卡片底色 */
  cardBg: 'white',

  /** 面板边框 */
  panelBorder: '#e5e7eb',
  /** 卡片边框 */
  cardBorder: '#dbe4ee',
  /** 输入框边框 */
  inputBorder: '#d1d5db',

  /** 正文文字 */
  text: '#334155',
  /** 次要文字 */
  textSecondary: '#64748b',
  /** 提示 / 信息文字 */
  textHint: '#0369a1',

  /** 成功底色 */
  successBg: '#ecfdf5',
  /** 错误底色 */
  errorBg: '#fef2f2',

  /** 主按钮 */
  primaryButton: '#2563eb',
  /** 危险按钮文字 */
  dangerButton: '#dc2626',
  /** 危险按钮边框 */
  dangerButtonBorder: '#fca5a5',
} as const;

// ── 间距 ──────────────────────────────────────────────────────────────────

export const spacing = {
  /** 面板内边距 */
  panelPadding: 12,
  /** 卡片内边距 */
  cardPadding: 10,
  /** 表单字段间距 */
  fieldGap: 6,
  /** 卡片间距 */
  cardGap: 12,
  /** 通用圆角 */
  borderRadius: 6,
} as const;

// ── 字体 ──────────────────────────────────────────────────────────────────

export const fontSize = {
  /** 基础字号 */
  base: 11,
  /** 小字号 */
  small: 10,
  /** 提示字号 */
  hint: 9,
} as const;

// ── 布局 ──────────────────────────────────────────────────────────────────

export const layout = {
  /** 侧边栏 Tab 宽度 */
  sidebarTabWidth: 88,
  /** 工具栏高度 */
  toolbarHeight: 40,
} as const;

// ── 共享 style 对象 ───────────────────────────────────────────────────────
// 使用 plain object 导出，可直接用于 React inline style 或 spread

export const cardStyle = {
  border: `1px solid ${colors.cardBorder}`,
  borderRadius: spacing.borderRadius,
  padding: spacing.cardPadding,
  backgroundColor: colors.cardBg,
  display: 'grid',
  gap: spacing.fieldGap,
} as const;

export const fieldLabelStyle = {
  display: 'grid',
  gap: 4,
} as const;

export const inputStyle = {
  border: `1px solid ${colors.inputBorder}`,
  borderRadius: 4,
  padding: '4px 6px',
  fontSize: fontSize.base,
  width: '100%',
} as const;

export const selectStyle = {
  ...inputStyle,
} as const;

export const buttonStyle = {
  borderRadius: 4,
  padding: '4px 10px',
  fontSize: fontSize.base,
  cursor: 'pointer',
} as const;

export const primaryButtonStyle = {
  ...buttonStyle,
  backgroundColor: colors.primaryButton,
  color: 'white',
  border: 'none',
} as const;

export const dangerButtonStyle = {
  ...buttonStyle,
  backgroundColor: 'white',
  color: colors.dangerButton,
  border: `1px solid ${colors.dangerButtonBorder}`,
} as const;

export const hintTextStyle = {
  color: colors.textSecondary,
  fontSize: fontSize.small,
  lineHeight: 1.5,
} as const;

export const sectionHeaderStyle = {
  fontWeight: 600,
} as const;
