import type { StatusCardTone } from './StatusCard';

export interface PipelineModuleProps {
  label: string;
  detail: string;
  tone: StatusCardTone;
  testId?: string;
}

const DOT_CLASS: Record<StatusCardTone, string> = {
  active: 'lg-signal-dot--active',
  waiting: 'lg-signal-dot--active',
  success: 'lg-signal-dot--idle',
  warning: 'lg-signal-dot--idle',
  congested: 'lg-signal-dot--active',
  error: 'lg-signal-dot--error',
  neutral: 'lg-signal-dot--idle',
};

const LABEL_COLORS: Record<StatusCardTone, string> = {
  active: 'var(--lg-signal-dim)',
  waiting: 'var(--lg-signal-dim)',
  success: 'var(--lg-success)',
  warning: 'var(--lg-insight-dim)',
  congested: 'var(--lg-insight-dim)',
  error: 'var(--lg-danger)',
  neutral: 'var(--lg-muted)',
};

export function PipelineModule({ label, detail, tone, testId }: PipelineModuleProps) {
  return (
    <div data-testid={testId} className="lg-pipeline-mod">
      <div className="lg-pipeline-mod__header">
        <div className={`lg-signal-dot ${DOT_CLASS[tone] ?? 'lg-signal-dot--idle'}`} />
        <span className="lg-pipeline-mod__label" style={{ color: LABEL_COLORS[tone] }}>
          {label}
        </span>
      </div>
      <div className="lg-pipeline-mod__detail" title={detail}>
        {detail}
      </div>
    </div>
  );
}
