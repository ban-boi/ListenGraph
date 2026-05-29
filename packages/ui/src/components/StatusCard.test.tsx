import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusCard } from './StatusCard';

describe('StatusCard', () => {
  it('渲染标题、状态和详情', () => {
    render(
      <StatusCard
        label="ASR"
        status="连接中"
        detail="等待服务响应"
        tone="waiting"
      />,
    );
    expect(screen.getByText('ASR')).toBeInTheDocument();
    expect(screen.getByText('连接中')).toBeInTheDocument();
    expect(screen.getByText('等待服务响应')).toBeInTheDocument();
  });

  it('tone=active 时添加 lg-status-card--signal class', () => {
    const { container } = render(
      <StatusCard label="ASR" status="运行中" detail="" tone="active" />,
    );
    const card = container.firstElementChild as HTMLElement;
    expect(card.className).toContain('lg-status-card--signal');
  });

  it('tone=warning 时添加 lg-status-card--insight class', () => {
    const { container } = render(
      <StatusCard label="ASR" status="延迟" detail="" tone="warning" />,
    );
    const card = container.firstElementChild as HTMLElement;
    expect(card.className).toContain('lg-status-card--insight');
  });

  it('isRunning 时渲染活跃波形条', () => {
    const { container } = render(
      <StatusCard label="ASR" status="运行中" detail="" tone="active" isRunning />,
    );
    const waveform = container.querySelector('.lg-waveform-bar--active');
    expect(waveform).toBeTruthy();
  });

  it('非运行状态不渲染活跃波形条', () => {
    const { container } = render(
      <StatusCard label="ASR" status="空闲" detail="" tone="neutral" />,
    );
    const waveform = container.querySelector('.lg-waveform-bar--active');
    expect(waveform).toBeNull();
  });
});
