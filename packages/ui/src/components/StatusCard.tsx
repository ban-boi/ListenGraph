export type StatusCardTone =
  | 'neutral'
  | 'waiting'
  | 'active'
  | 'success'
  | 'warning'
  | 'congested'
  | 'error';

export type StatusCardProps = {
  label: string;
  status: string;
  detail: string;
  tone: StatusCardTone;
  isRunning?: boolean;
};

function getStatusCardStyles(tone: StatusCardTone) {
  switch (tone) {
    case 'active':
      return {
        backgroundColor: 'var(--lg-signal-glow)',
        borderColor: 'var(--lg-signal-dim)',
        titleColor: 'var(--lg-signal-dim)',
        statusColor: 'var(--lg-signal)',
        detailColor: 'var(--lg-signal)',
      };
    case 'waiting':
      return {
        backgroundColor: 'var(--lg-signal-glow)',
        borderColor: 'var(--lg-mist)',
        titleColor: 'var(--lg-signal-dim)',
        statusColor: 'var(--lg-signal-dim)',
        detailColor: 'var(--lg-signal)',
      };
    case 'success':
      return {
        backgroundColor: 'var(--lg-surface)',
        borderColor: 'var(--lg-success)',
        titleColor: 'var(--lg-success)',
        statusColor: 'var(--lg-success)',
        detailColor: 'var(--lg-success)',
      };
    case 'warning':
      return {
        backgroundColor: 'var(--lg-insight-glow)',
        borderColor: 'var(--lg-warning)',
        titleColor: 'var(--lg-insight-dim)',
        statusColor: 'var(--lg-insight-dim)',
        detailColor: 'var(--lg-insight)',
      };
    case 'congested':
      return {
        backgroundColor: 'var(--lg-insight-glow)',
        borderColor: 'var(--lg-insight)',
        titleColor: 'var(--lg-insight-dim)',
        statusColor: 'var(--lg-insight)',
        detailColor: 'var(--lg-insight)',
      };
    case 'error':
      return {
        backgroundColor: 'var(--lg-surface)',
        borderColor: 'var(--lg-danger)',
        titleColor: 'var(--lg-danger)',
        statusColor: 'var(--lg-danger)',
        detailColor: 'var(--lg-danger)',
      };
    case 'neutral':
    default:
      return {
        backgroundColor: 'var(--lg-calm)',
        borderColor: 'var(--lg-rim)',
        titleColor: 'var(--lg-muted)',
        statusColor: 'var(--lg-muted)',
        detailColor: 'var(--lg-muted)',
      };
  }
}

function toneToCssModifier(tone: StatusCardTone): string {
  if (tone === 'active' || tone === 'waiting' || tone === 'success') return '--signal';
  if (tone === 'warning' || tone === 'congested') return '--insight';
  return '';
}

export function StatusCard({ label, status, detail, tone, isRunning }: StatusCardProps) {
  const styles = getStatusCardStyles(tone);
  const modifier = toneToCssModifier(tone);

  return (
    <div
      className={`lg-status-card${modifier ? ` lg-status-card${modifier}` : ''}`}
      style={{
        position: 'relative',
        overflow: 'hidden',
        padding: '4px 8px',
        display: 'grid',
        gap: 2,
        minWidth: 0,
      }}
    >
      <div
        style={{
          fontSize: 'var(--text-xs)',
          fontWeight: 700,
          color: styles.statusColor,
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          minWidth: 0,
        }}
      >
        <span style={{ color: styles.titleColor, fontSize: 'var(--text-2xs)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
          {label}
        </span>
        <span style={{ color: 'var(--lg-mist)' }}>·</span>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {status}
        </span>
      </div>
      <div
        title={detail}
        style={{
          fontSize: 'var(--text-2xs)',
          color: styles.detailColor,
          lineHeight: 1.3,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {detail}
      </div>
      <div
        className={`lg-waveform-bar${isRunning ? ' lg-waveform-bar--active' : ''}`}
        style={{ marginTop: 4 }}
      />
    </div>
  );
}
