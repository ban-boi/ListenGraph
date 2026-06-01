import { useState, useEffect, useRef, type ReactNode } from 'react';
import { PipelineWaveDivider, type WaveDividerStatus } from './PipelineWaveDivider';
import { PipelineModule, type PipelineModuleProps } from './PipelineModule';

export type LayoutMode = 'narrow' | 'medium' | 'wide';

export interface PipelineModuleSlot {
  module: PipelineModuleProps;
  waveStatus: WaveDividerStatus;
  waveTone: 'signal' | 'insight' | 'neutral';
}

export interface PipelineLayoutProps {
  asr: PipelineModuleSlot;
  structurer: PipelineModuleSlot;
  graph: PipelineModuleSlot;
  /** Graph 右侧额外内容（auto-tour indicator 等） */
  graphExtra?: ReactNode;
  className?: string;
}

function useLayoutMode(): { ref: React.RefObject<HTMLDivElement | null>; mode: LayoutMode } {
  const ref = useRef<HTMLDivElement | null>(null);
  const [mode, setMode] = useState<LayoutMode>('narrow');

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const w = el.clientWidth;
      setMode(w < 400 ? 'narrow' : w < 600 ? 'medium' : 'wide');
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return { ref, mode };
}

function ModSlot({ slot }: { slot: PipelineModuleSlot }) {
  return <PipelineModule {...slot.module} />;
}

function Wave({ status, tone, direction }: { status: WaveDividerStatus; tone: 'signal' | 'insight' | 'neutral'; direction: 'horizontal' | 'vertical' }) {
  return <PipelineWaveDivider status={status} tone={tone} direction={direction} />;
}

/**
 * 管线响应式布局。
 *
 * narrow（< 400px）：单列竖排，横向波浪
 *   ASR → wave-h → Structurer → wave-h → Graph → wave-h
 *
 * medium（400-600px）：2+1 网格
 *   顶行：ASR → wave-v → Structurer → wave-v
 *   横波（Graph）
 *   Graph 模块
 *
 * wide（> 600px）：三列并排，竖向波浪
 *   ASR → wave-v → Structurer → wave-v → Graph → wave-v
 */
export function PipelineLayout({ asr, structurer, graph, graphExtra, className }: PipelineLayoutProps) {
  const { ref, mode } = useLayoutMode();

  return (
    <div
      ref={ref}
      className={['lg-pipeline-layout', `lg-pipeline-layout--${mode}`, className ?? ''].filter(Boolean).join(' ')}
      data-testid="runtime-status-cards"
      style={{ flexShrink: 0 }}
    >
      {mode === 'narrow' && (
        <div className="lg-pipeline-layout__inner">
          <ModSlot slot={asr} />
          <Wave status={asr.waveStatus} tone={asr.waveTone} direction="horizontal" />
          <ModSlot slot={structurer} />
          <Wave status={structurer.waveStatus} tone={structurer.waveTone} direction="horizontal" />
          <ModSlot slot={graph} />
          {graphExtra}
          <Wave status={graph.waveStatus} tone={graph.waveTone} direction="horizontal" />
        </div>
      )}

      {mode === 'medium' && (
        <>
          <div className="lg-pipeline-layout__top-row">
            <ModSlot slot={asr} />
            <Wave status={asr.waveStatus} tone={asr.waveTone} direction="vertical" />
            <ModSlot slot={structurer} />
            <Wave status={structurer.waveStatus} tone={structurer.waveTone} direction="vertical" />
          </div>
          <Wave status={graph.waveStatus} tone={graph.waveTone} direction="horizontal" />
          <div className="lg-pipeline-layout__bottom">
            <ModSlot slot={graph} />
            {graphExtra}
          </div>
        </>
      )}

      {mode === 'wide' && (
        <div className="lg-pipeline-layout__inner">
          <ModSlot slot={asr} />
          <Wave status={asr.waveStatus} tone={asr.waveTone} direction="vertical" />
          <ModSlot slot={structurer} />
          <Wave status={structurer.waveStatus} tone={structurer.waveTone} direction="vertical" />
          <ModSlot slot={graph} />
          {graphExtra}
        </div>
      )}
    </div>
  );
}
