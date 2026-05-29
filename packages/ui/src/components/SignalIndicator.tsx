export type SignalIndicatorProps = {
  /** 是否处于活跃状态 */
  active: boolean;
  /** 状态文本，默认 active 时为 "运行中"，否则为 "空闲" */
  label?: string;
};

export function SignalIndicator({ active, label }: SignalIndicatorProps) {
  const displayLabel = label ?? (active ? '运行中' : '空闲');
  return (
    <div className="lg-signal-indicator">
      <div
        data-testid="signal-dot"
        className={`lg-signal-dot ${active ? 'lg-signal-dot--active' : 'lg-signal-dot--idle'}`}
      />
      <span>{displayLabel}</span>
    </div>
  );
}
