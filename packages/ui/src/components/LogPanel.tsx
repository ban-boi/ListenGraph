import { formatTimestamp } from '../utils/format-time';

// ===== 类型 =====

export type TimelineStage = 'system' | 'asr' | 'structurer' | 'graph';
export type TimelineTone = 'neutral' | 'success' | 'warning' | 'error';

export type TimelineEvent = {
  id: string;
  timestamp: number;
  stage: TimelineStage;
  message: string;
  detail?: string;
  tone: TimelineTone;
  repeatCount?: number;
};

// ===== 简单日志面板（Web Demo 用）=====

export type SimpleLogPanelProps = {
  logs: string[];
  placeholder?: string;
};

export function SimpleLogPanel({ logs, placeholder = '暂无日志' }: SimpleLogPanelProps) {
  return (
    <div
      style={{
        borderLeft: '1px solid var(--lg-rim)',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: 'var(--lg-ink)',
      }}
    >
      <div
        style={{
          padding: '8px 12px',
          borderBottom: '1px solid var(--lg-rim)',
          color: 'var(--lg-success)',
          fontSize: 'var(--text-sm)',
          fontWeight: 600,
        }}
      >
        日志 ({logs.length})
      </div>
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '8px 12px',
          fontFamily: 'monospace',
          fontSize: 'var(--text-xs)',
          color: 'var(--lg-success)',
        }}
      >
        {logs.length === 0 ? (
          <div style={{ color: 'var(--lg-muted)' }}>{placeholder}</div>
        ) : (
          logs.map((log, i) => (
            <div key={i} style={{ marginBottom: 4, wordBreak: 'break-all' }}>
              {log}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ===== 时间轴日志面板（Extension 用）=====

function formatStageLabel(stage: TimelineStage): string {
  switch (stage) {
    case 'asr': return 'ASR';
    case 'structurer': return 'Structurer';
    case 'graph': return 'Graph';
    default: return 'System';
  }
}

function getToneColors(tone: TimelineTone) {
  switch (tone) {
    case 'success':
      return { border: '#14532d', badge: '#14532d', badgeText: '#dcfce7', text: '#dcfce7', detail: '#86efac' };
    case 'warning':
      return { border: '#92400e', badge: '#92400e', badgeText: '#fef3c7', text: '#fde68a', detail: '#fbbf24' };
    case 'error':
      return { border: '#991b1b', badge: '#991b1b', badgeText: '#fee2e2', text: '#fecaca', detail: '#fca5a5' };
    default:
      return { border: '#334155', badge: '#0f172a', badgeText: '#cbd5e1', text: '#e2e8f0', detail: '#94a3b8' };
  }
}

export type TimelineLogPanelProps = {
  events: TimelineEvent[];
  placeholder?: string;
  /** 固定高度（px） */
  height?: number;
};

export function TimelineLogPanel({
  events,
  placeholder = '点击"开始"启动会话，状态与事件会在这里实时出现。',
  height,
}: TimelineLogPanelProps) {
  return (
    <div
      data-testid="log-area"
      style={{
        height: height ?? 'auto',
        overflowY: 'auto',
        backgroundColor: 'var(--lg-calm)',
        color: 'var(--lg-ink)',
        fontFamily: 'var(--font-mono)',
        fontSize: 'var(--text-xs)',
        padding: '8px',
        borderTop: '1px solid var(--lg-rim)',
      }}
    >
      {events.length === 0 ? (
        <div style={{ color: 'var(--lg-muted)' }}>{placeholder}</div>
      ) : (
        events.map((event) => {
          const colors = getToneColors(event.tone);
          return (
            <div
              key={event.id}
              style={{
                marginBottom: 6,
                border: `1px solid ${colors.border}`,
                borderRadius: 8,
                padding: '6px 8px',
                backgroundColor: 'var(--lg-surface)',
                display: 'grid',
                gap: 4,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                <span style={{ color: 'var(--lg-muted)', fontSize: 'var(--text-2xs)' }}>
                  {formatTimestamp(event.timestamp)}
                </span>
                <span
                  style={{
                    fontSize: 'var(--text-2xs)',
                    padding: '1px 6px',
                    borderRadius: 999,
                    backgroundColor: colors.badge,
                    color: colors.badgeText,
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                  }}
                >
                  {formatStageLabel(event.stage)}
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
              <div style={{ color: colors.text, wordBreak: 'break-word' }}>
                {event.message}
              </div>
              {event.detail && (
                <div style={{ color: colors.detail, wordBreak: 'break-word' }}>
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
