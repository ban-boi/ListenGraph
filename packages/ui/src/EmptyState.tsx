export type EmptyStateProps = {
  title?: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
};

export function EmptyState({
  title = '开始记录',
  description = '点击「开始」按钮，实时语音将被转化为结构化知识图谱',
  actionLabel,
  onAction,
}: EmptyStateProps) {
  return (
    <div className="lg-empty-state">
      <div className="lg-empty-state__icon">&#127908;&#65039;</div>
      <div className="lg-empty-state__title">{title}</div>
      <div className="lg-empty-state__desc">{description}</div>
      {actionLabel && onAction && (
        <button
          className="lg-btn lg-btn-primary"
          style={{ marginTop: 'var(--sp-4)' }}
          onClick={onAction}
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}
