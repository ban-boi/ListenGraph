export type StatusBarSegment = {
  id: string;
  content: string;
};

export type StatusBarProps = {
  segments?: StatusBarSegment[];
  children?: React.ReactNode;
};

export function StatusBar({ segments, children }: StatusBarProps) {
  return (
    <div
      style={{
        padding: '6px 12px',
        borderTop: '1px solid var(--lg-rim)',
        fontSize: 'var(--text-xs)',
        color: 'var(--lg-muted)',
        flexShrink: 0,
        display: 'flex',
        justifyContent: 'space-between',
        gap: 12,
        flexWrap: 'wrap',
      }}
    >
      {segments
        ? segments.map((seg) => <span key={seg.id}>{seg.content}</span>)
        : children}
    </div>
  );
}
