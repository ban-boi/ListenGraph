import type { StatusCardData, AutoTourStatus } from './types';
import { getStatusCardStyles } from './timeline-utils';
import { VIEW_LABELS } from './constants';

export type StatusCardsProps = {
  primaryStatusCards: StatusCardData[];
  graphViewStatus: StatusCardData;
  currentView: string;
  autoTourStatus: AutoTourStatus;
  autoTourProgress: { current: number; total: number };
  isRunning: boolean;
  autoTourIndicatorColor: string;
  autoTourStatusText: string;
};

export function StatusCards({
  primaryStatusCards,
  graphViewStatus,
  currentView,
  autoTourIndicatorColor,
  autoTourStatusText,
  autoTourStatus,
}: StatusCardsProps) {
  return (
    <>
      <div
        data-testid="runtime-status-cards"
        style={{
          padding: '8px 12px',
          display: 'grid',
          gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
          gap: 8,
          flexShrink: 0,
        }}
      >
        {primaryStatusCards.map((card) => {
          const styles = getStatusCardStyles(card.tone);
          return (
            <div
              key={card.label}
              data-testid={`status-card-${card.label.toLowerCase()}`}
              style={{
                border: `1px solid ${styles.borderColor}`,
                borderRadius: 8,
                backgroundColor: styles.backgroundColor,
                padding: '8px 10px',
                display: 'grid',
                gap: 4,
                minWidth: 0,
              }}
            >
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: '0.04em',
                  textTransform: 'uppercase',
                  color: styles.titleColor,
                }}
              >
                {card.label}
              </div>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  color: styles.statusColor,
                }}
              >
                {card.status}
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: styles.detailColor,
                  wordBreak: 'break-word',
                }}
              >
                {card.detail}
              </div>
            </div>
          );
        })}
      </div>
      <div
        data-testid="graph-view-status"
        style={{
          margin: '0 12px 8px',
          padding: '7px 10px',
          border: '1px solid #dbe4ee',
          borderRadius: 8,
          backgroundColor: '#f8fafc',
          color: '#475569',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
          flexWrap: 'wrap',
          flexShrink: 0,
          fontSize: 11,
          borderBottom: '1px solid #dbe4ee',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span style={{ fontWeight: 700, color: '#334155' }}>Graph View</span>
          <span>{graphViewStatus.status}</span>
          <span style={{ color: '#64748b' }}>{graphViewStatus.detail}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>视图: {VIEW_LABELS[currentView as keyof typeof VIEW_LABELS]}</span>
          <span
            data-testid="auto-tour-indicator"
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              backgroundColor: autoTourIndicatorColor,
              animation:
                autoTourStatus === 'touring'
                  ? 'listen-graphic-tour-pulse 1s ease-in-out infinite'
                  : 'none',
              display: 'inline-block',
            }}
          />
          <span data-testid="auto-tour-status">{autoTourStatusText}</span>
        </div>
      </div>
    </>
  );
}
