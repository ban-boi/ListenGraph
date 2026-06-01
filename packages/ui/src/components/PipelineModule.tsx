import type { StatusCardTone } from './StatusCard';

/**
 * 管线紧凑模块头。
 * 替代 StatusCard 用于管线流内部——居中对齐的 dot + label + detail。
 */

export interface PipelineModuleProps {
  /** 模块标签，如 "ASR" / "Structurer" / "Graph" */
  label: string;
  /** 状态文案 */
  status: string;
  /** 详情文案 */
  detail: string;
  /** 色调：控制 dot 和 label 颜色 */
  tone: StatusCardTone;
  /** 可选 data-testid */
  testId?: string;
}

/** tone → dot 样式 class 后缀 */
const DOT_CLASS: Record<StatusCardTone, string> = {
  active: 'lg-signal-dot--active',
  waiting: 'lg-signal-dot--active',
  success: 'lg-signal-dot--idle',
  warning: 'lg-signal-dot--idle',
  congested: 'lg-signal-dot--active',
  error: 'lg-signal-dot--error',
  neutral: 'lg-signal-dot--idle',
};

/** tone → label 颜色 CSS variable */
const LABEL_COLORS: Record<StatusCardTone, string> = {
  active: 'var(--lg-signal-dim)',
  waiting: 'var(--lg-signal-dim)',
  success: 'var(--lg-success)',
  warning: 'var(--lg-insight-dim)',
  congested: 'var(--lg-insight-dim)',
  error: 'var(--lg-danger)',
  neutral: 'var(--lg-muted)',
};

export function PipelineModule({ label, status, detail, tone, testId }: PipelineModuleProps) {
  return (
    <div
      data-testid={testId}
      className="lg-pipeline-mod"
    >
      <div className="lg-pipeline-mod__header">
        <div className={`lg-signal-dot ${DOT_CLASS[tone] ?? 'lg-signal-dot--idle'}`} />
        <span className="lg-pipeline-mod__label" style={{ color: LABEL_COLORS[tone] }}>
          {label}
        </span>
        <span style={{ color: 'var(--lg-mist)', fontSize: 'var(--text-2xs)' }}>·</span>
        <span className="lg-pipeline-mod__status" style={{ color: LABEL_COLORS[tone] }}>
          {status}
        </span>
      </div>
      <div className="lg-pipeline-mod__detail" title={detail}>
        {detail}
      </div>
    </div>
  );
}
