/**
 * Signal Design System — ListenGraph TypeScript Token 导出
 *
 * 与 theme.css 的 CSS 变量保持同步。
 * 用于 React inline style 中引用 token 值（因为部分场景无法使用 CSS 变量）。
 *
 * 用法：
 *   import { colors, spacing, typography } from './theme';
 *   <div style={{ color: colors.signal, fontSize: typography.textBase }} />
 */

// ── 色彩 ──────────────────────────────────────────────
export const colors = {
  // Depth — 文字与根基
  ink:        'oklch(19% 0.028 260)',
  inkSoft:    'oklch(32% 0.022 260)',
  muted:      'oklch(56% 0.015 260)',
  mist:       'oklch(80% 0.008 260)',

  // Signal — 信号蓝绿
  signal:        'oklch(62% 0.165 200)',
  signalBright:  'oklch(72% 0.14 195)',
  signalDim:     'oklch(52% 0.10 200)',
  signalGlow:    'oklch(80% 0.08 200)',

  // Insight — 洞察琥珀
  insight:        'oklch(70% 0.155 55)',
  insightBright:  'oklch(75% 0.16 60)',
  insightDim:     'oklch(55% 0.12 50)',
  insightGlow:    'oklch(85% 0.08 65)',

  // Surface — 表面
  calm:    'oklch(97.5% 0.004 260)',
  surface: 'oklch(100% 0 0)',
  rim:     'oklch(93% 0.006 260)',
  line:    'oklch(96% 0.003 260)',

  // 状态语义
  success: 'oklch(65% 0.16 155)',
  warning: 'oklch(72% 0.15 75)',
  danger:  'oklch(60% 0.18 25)',
  info:    'oklch(65% 0.12 240)',

  // 图节点
  nodeClaim:      'oklch(62% 0.165 200)',
  nodeEvidence:   'oklch(68% 0.12 155)',
  nodeQuestion:   'oklch(70% 0.12 300)',
  nodeConcept:    'oklch(70% 0.155 55)',
  nodeConclusion: 'oklch(62% 0.10 140)',
  nodeDraft:      'oklch(75% 0.03 260)',
} as const;

// ── 暗色模式覆盖 ──────────────────────────────────────
export const colorsDark = {
  ink:        'oklch(95% 0.005 260)',
  inkSoft:    'oklch(85% 0.008 260)',
  muted:      'oklch(60% 0.012 260)',
  mist:       'oklch(40% 0.01 260)',
  calm:       'oklch(16% 0.018 260)',
  surface:    'oklch(20% 0.016 260)',
  rim:        'oklch(28% 0.015 260)',
  line:       'oklch(24% 0.014 260)',
  signal:     'oklch(68% 0.14 195)',
  signalDim:  'oklch(48% 0.10 200)',
  insight:    'oklch(72% 0.14 55)',
  nodeDraft:  'oklch(38% 0.02 260)',
} as const;

// ── 字体 ──────────────────────────────────────────────
export const fonts = {
  sans:    "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif",
  mono:    "'JetBrains Mono', 'Fira Code', ui-monospace, 'Cascadia Code', Menlo, monospace",
  display: "'Inter', -apple-system, BlinkMacSystemFont, system-ui, sans-serif",
} as const;

// ── 字号 ──────────────────────────────────────────────
export const typography = {
  text2xs:  '0.625rem',   // 10px
  textXs:   '0.6875rem',  // 11px
  textSm:   '0.8125rem',  // 13px
  textBase: '0.9375rem',  // 15px
  textLg:   '1.0625rem',  // 17px
  textXl:   '1.25rem',    // 20px
  text2xl:  '1.5rem',     // 24px
  text3xl:  '1.875rem',   // 30px
  text4xl:  '2.5rem',     // 40px
} as const;

// ── 字重 ──────────────────────────────────────────────
export const weights = {
  normal: 400,
  medium: 500,
  semi:   600,
  bold:   700,
} as const;

// ── 行高 ──────────────────────────────────────────────
export const lineHeights = {
  tight:   1.3,
  normal:  1.5,
  relaxed: 1.65,
} as const;

// ── 间距 (px 值，用于 React style 对象) ────────────────
export const spacing = {
  sp0:  0,
  spPx: 1,
  sp05: 2,
  sp1:  4,
  sp2:  8,
  sp3:  12,
  sp4:  16,
  sp5:  20,
  sp6:  24,
  sp8:  32,
  sp10: 40,
  sp12: 48,
  sp16: 64,
} as const;

// ── 圆角 ──────────────────────────────────────────────
export const radii = {
  sm:   '5px',
  md:   '8px',
  lg:   '12px',
  xl:   '16px',
  full: '9999px',
} as const;

// ── 阴影 ──────────────────────────────────────────────
export const shadows = {
  xs:           '0 1px 2px oklch(0% 0 0 / 0.04)',
  sm:           '0 2px 4px oklch(0% 0 0 / 0.06), 0 1px 2px oklch(0% 0 0 / 0.04)',
  md:           '0 4px 12px oklch(0% 0 0 / 0.06), 0 2px 4px oklch(0% 0 0 / 0.03)',
  lg:           '0 8px 24px oklch(0% 0 0 / 0.08), 0 4px 8px oklch(0% 0 0 / 0.04)',
  glowSignal:   '0 0 0 3px oklch(62% 0.165 200 / 0.15)',
  glowInsight:  '0 0 0 3px oklch(70% 0.155 55 / 0.15)',
} as const;

// ── 过渡 ──────────────────────────────────────────────
export const transitions = {
  easeOut:    'cubic-bezier(0.16, 1, 0.3, 1)',
  easeSpring: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
  durFast:    '120ms',
  durNormal:  '200ms',
  durSlow:    '350ms',
} as const;

// ── 布局常量 ──────────────────────────────────────────
export const layout = {
  toolbarH:    48,
  touchTarget: 44,
  panelMin:    320,
  panelMax:    600,
  cardMinW:    220,
} as const;

// ── z-index ───────────────────────────────────────────
export const zIndex = {
  base:    0,
  card:    10,
  sticky:  100,
  overlay: 1000,
  modal:   2000,
  toast:   9000,
} as const;

// ── 便捷方法：获取当前主题色 ──────────────────────────
export function getThemeColors(isDark: boolean) {
  return isDark
    ? { ...colors, ...colorsDark }
    : colors;
}

// ── CSS 变量引用（用于在 inline style 中引用 CSS 变量）──
export const cssVar = {
  // 用法：style={{ color: cssVar.ink }}  → "var(--lg-ink)"
  ink:             'var(--lg-ink)',
  inkSoft:         'var(--lg-ink-soft)',
  muted:           'var(--lg-muted)',
  mist:            'var(--lg-mist)',
  signal:          'var(--lg-signal)',
  signalBright:    'var(--lg-signal-bright)',
  signalDim:       'var(--lg-signal-dim)',
  signalGlow:      'var(--lg-signal-glow)',
  insight:         'var(--lg-insight)',
  insightBright:   'var(--lg-insight-bright)',
  insightDim:      'var(--lg-insight-dim)',
  insightGlow:     'var(--lg-insight-glow)',
  calm:            'var(--lg-calm)',
  surface:         'var(--lg-surface)',
  rim:             'var(--lg-rim)',
  line:            'var(--lg-line)',
  success:         'var(--lg-success)',
  warning:         'var(--lg-warning)',
  danger:          'var(--lg-danger)',
  info:            'var(--lg-info)',
  nodeClaim:       'var(--lg-node-claim)',
  nodeEvidence:    'var(--lg-node-evidence)',
  nodeQuestion:    'var(--lg-node-question)',
  nodeConcept:     'var(--lg-node-concept)',
  nodeConclusion:  'var(--lg-node-conclusion)',
  nodeDraft:       'var(--lg-node-draft)',
} as const;
