export type ErrorBannerProps = {
  stage: string;
  code: string;
  message: string;
};

export function ErrorBanner({ stage, code, message }: ErrorBannerProps) {
  return (
    <div
      data-testid="error-banner"
      style={{
        padding: '8px 12px',
        borderBottom: '1px solid var(--lg-danger)',
        backgroundColor: 'var(--lg-surface)',
        color: 'var(--lg-danger)',
        fontSize: 'var(--text-xs)',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        flexShrink: 0,
      }}
    >
      <span style={{ fontWeight: 700 }}>最近错误</span>
      <span style={{ fontFamily: 'monospace' }}>{stage} / {code}</span>
      <span style={{ color: 'var(--lg-danger)' }}>{message}</span>
    </div>
  );
}
