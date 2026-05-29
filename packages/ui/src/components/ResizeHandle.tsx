export type ResizeHandleProps = {
  /** 拖拽开始的回调（mousedown） */
  onResizeStart: (event: React.MouseEvent<HTMLDivElement>) => void;
  /** aria-label 文本，默认 "调整面板高度" */
  ariaLabel?: string;
};

export function ResizeHandle({
  onResizeStart,
  ariaLabel = '调整面板高度',
}: ResizeHandleProps) {
  return (
    <div
      data-testid="resize-handle"
      onMouseDown={onResizeStart}
      style={{
        height: 8,
        flexShrink: 0,
        cursor: 'row-resize',
        background:
          'linear-gradient(to bottom, var(--lg-rim) 0, var(--lg-rim) 1px, var(--lg-calm) 1px, var(--lg-calm) 100%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
      aria-label={ariaLabel}
      role="separator"
    >
      <div
        style={{
          width: 48,
          height: 4,
          borderRadius: 999,
          backgroundColor: 'var(--lg-mist)',
        }}
      />
    </div>
  );
}
