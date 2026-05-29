import type { TimelineEvent } from './types';
import {
  getTimelineToneStyles,
  formatTimelineTimestamp,
  formatTimelineStageLabel,
} from './timeline-utils';

export type LogPanelProps = {
  logPanelHeight: number;
  timelineEvents: TimelineEvent[];
};

export function LogPanel({ logPanelHeight, timelineEvents }: LogPanelProps) {
  return (
    <div
      data-testid="log-area"
      style={{
        height: logPanelHeight,
        overflowY: 'auto',
        backgroundColor: 'var(--lg-calm)',
        color: 'var(--lg-ink)',
        fontFamily: 'var(--font-mono)',
        fontSize: 'var(--text-xs)',
        padding: '8px',
        borderTop: '1px solid var(--lg-rim)',
      }}
    >
      {timelineEvents.length === 0 ? (
        <div style={{ color: 'var(--lg-muted)' }}>点击"开始"启动会话，状态与事件会在这里实时出现。</div>
      ) : (
        timelineEvents.map((event) => {
          const toneStyles = getTimelineToneStyles(event.tone);
          return (
            <div
              key={event.id}
              style={{
                marginBottom: 6,
                border: `1px solid ${toneStyles.borderColor}`,
                borderRadius: 8,
                padding: '6px 8px',
                backgroundColor: 'var(--lg-surface)',
                display: 'grid',
                gap: 4,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  minWidth: 0,
                }}
              >
                <span style={{ color: 'var(--lg-muted)', fontSize: 'var(--text-2xs)' }}>
                  {formatTimelineTimestamp(event.timestamp)}
                </span>
                <span
                  style={{
                    fontSize: 'var(--text-2xs)',
                    padding: '1px 6px',
                    borderRadius: 999,
                    backgroundColor: toneStyles.badgeBackground,
                    color: toneStyles.badgeColor,
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                  }}
                >
                  {formatTimelineStageLabel(event.stage)}
                </span>
                {(event.repeatCount ?? 1) > 1 && (
                  <span
                    style={{
                      fontSize: 'var(--text-2xs)',
                      padding: '1px 6px',
                      borderRadius: 999,
                      backgroundColor: 'var(--lg-rim)',
                      color: 'var(--lg-muted)',
                    }}
                  >
                    x{event.repeatCount}
                  </span>
                )}
              </div>
              <div style={{ color: toneStyles.textColor, wordBreak: 'break-word' }}>
                {event.message}
              </div>
              {event.detail && (
                <div style={{ color: toneStyles.detailColor, wordBreak: 'break-word' }}>
                  {event.detail}
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
