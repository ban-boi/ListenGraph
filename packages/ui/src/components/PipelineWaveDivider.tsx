import { useMemo, useRef, useState, useEffect } from 'react';
import { generateWavePath } from '../utils/wave-path';

export type WaveDividerStatus = 'idle' | 'active' | 'complete' | 'error';
export type WaveDividerTone = 'signal' | 'insight' | 'neutral';
export type WaveDirection = 'horizontal' | 'vertical';

export interface PipelineWaveDividerProps {
  /** 模块运行状态 */
  status: WaveDividerStatus;
  /** 模块色调：signal=蓝绿(ASR), insight=琥珀(Structurer), neutral=灰(Graph) */
  tone: WaveDividerTone;
  /** 波浪方向，默认 horizontal */
  direction?: WaveDirection;
  /** 额外 CSS class */
  className?: string;
}

/** 设计参数 — 与设计文件对齐 */
const AMPLITUDE = 7;
const TARGET_WAVELENGTH = 40;
const CROSS_LENGTH = 18;
const STROKE_WIDTH = 2;

/** 不同方向的默认长度（ResizeObserver 测量生效前的回退值） */
const FALLBACK_LENGTH: Record<WaveDirection, number> = {
  horizontal: 320,
  vertical: 80,
};

const TONE_COLORS: Record<WaveDividerTone, string> = {
  signal: 'var(--lg-signal)',
  insight: 'var(--lg-insight)',
  neutral: 'var(--lg-muted)',
};

const IDLE_COLOR = 'var(--lg-muted)';
const ERROR_COLOR = 'var(--lg-danger)';

/**
 * 测量波浪容器在主轴方向的实际尺寸。
 * 返回 0 表示尚未测量。
 */
function useMeasuredLength(
  direction: WaveDirection,
): { ref: React.RefObject<HTMLDivElement | null>; length: number } {
  const ref = useRef<HTMLDivElement | null>(null);
  const [length, setLength] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const len = direction === 'horizontal' ? el.clientWidth : el.clientHeight;
      if (len > 0) setLength(len);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [direction]);

  return { ref, length };
}

export function PipelineWaveDivider({
  status,
  tone,
  direction = 'horizontal',
  className,
}: PipelineWaveDividerProps) {
  const { ref: measureRef, length: measuredLength } = useMeasuredLength(direction);
  const length = measuredLength > 0 ? measuredLength : FALLBACK_LENGTH[direction];

  const wave = useMemo(
    () => generateWavePath(length, CROSS_LENGTH, AMPLITUDE, TARGET_WAVELENGTH, direction),
    [length, direction],
  );

  const strokeColor =
    status === 'idle' ? IDLE_COLOR
      : status === 'error' ? ERROR_COLOR
        : TONE_COLORS[tone];

  const isDashed = status === 'error';
  const isHorizontal = direction === 'horizontal';

  return (
    <div
      ref={measureRef}
      className={[
        'lg-pipeline-wave',
        `lg-pipeline-wave--${direction}`,
        `lg-pipeline-wave--${status}`,
        className ?? '',
      ].filter(Boolean).join(' ')}
      role="separator"
    >
      <svg
        viewBox={wave.viewBox}
        preserveAspectRatio="none"
        fill="none"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: isHorizontal ? '200%' : '100%',
          height: isHorizontal ? '100%' : '200%',
        }}
      >
        <path
          d={wave.path}
          stroke={strokeColor}
          strokeWidth={STROKE_WIDTH}
          strokeLinecap="round"
          strokeDasharray={isDashed ? '8 4' : undefined}
        />
      </svg>
    </div>
  );
}
