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
        backgroundColor: '#0f172a',
        color: '#e2e8f0',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
        fontSize: 11,
        padding: '8px',
        borderTop: '1px solid #0b1220',
      }}
    >
      {timelineEvents.length === 0 ? (
        <div style={{ color: '#64748b' }}>点击"开始"启动会话，状态与事件会在这里实时出现。</div>
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
                backgroundColor: 'rgba(15, 23, 42, 0.55)',
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
                <span style={{ color: '#64748b', fontSize: 10 }}>
                  {formatTimelineTimestamp(event.timestamp)}
                </span>
                <span
                  style={{
                    fontSize: 10,
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
                      fontSize: 10,
                      padding: '1px 6px',
                      borderRadius: 999,
                      backgroundColor: '#1e293b',
                      color: '#cbd5e1',
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
