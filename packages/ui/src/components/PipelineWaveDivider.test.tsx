import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { PipelineWaveDivider } from './PipelineWaveDivider';

describe('PipelineWaveDivider', () => {
  it('idle 状态：渲染灰色波浪', () => {
    const { container } = render(
      <PipelineWaveDivider status="idle" tone="signal" />,
    );
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.className).toContain('lg-pipeline-wave');
    expect(wrapper.className).toContain('lg-pipeline-wave--idle');
    expect(wrapper.className).toContain('lg-pipeline-wave--horizontal');
    expect(wrapper.getAttribute('role')).toBe('separator');

    const path = container.querySelector('path');
    expect(path).toBeTruthy();
    expect(path?.getAttribute('stroke')).toBe('var(--lg-muted)');
  });

  it('active 状态：渲染语义色波浪', () => {
    const { container } = render(
      <PipelineWaveDivider status="active" tone="signal" />,
    );
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.className).toContain('lg-pipeline-wave--active');

    const path = container.querySelector('path');
    expect(path?.getAttribute('stroke')).toBe('var(--lg-signal)');
  });

  it('active insight 色调', () => {
    const { container } = render(
      <PipelineWaveDivider status="active" tone="insight" />,
    );
    const path = container.querySelector('path');
    expect(path?.getAttribute('stroke')).toBe('var(--lg-insight)');
  });

  it('active neutral 色调', () => {
    const { container } = render(
      <PipelineWaveDivider status="active" tone="neutral" />,
    );
    const path = container.querySelector('path');
    expect(path?.getAttribute('stroke')).toBe('var(--lg-muted)');
  });

  it('complete 状态：语义色 + 半透明', () => {
    const { container } = render(
      <PipelineWaveDivider status="complete" tone="signal" />,
    );
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.className).toContain('lg-pipeline-wave--complete');

    const path = container.querySelector('path');
    expect(path?.getAttribute('stroke')).toBe('var(--lg-signal)');
  });

  it('error 状态：红色虚线', () => {
    const { container } = render(
      <PipelineWaveDivider status="error" tone="signal" />,
    );
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.className).toContain('lg-pipeline-wave--error');

    const path = container.querySelector('path');
    expect(path?.getAttribute('stroke')).toBe('var(--lg-danger)');
    expect(path?.getAttribute('stroke-dasharray')).toBe('8 4');
  });

  it('支持自定义 className', () => {
    const { container } = render(
      <PipelineWaveDivider status="idle" tone="signal" className="my-extra" />,
    );
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.className).toContain('my-extra');
  });
});
