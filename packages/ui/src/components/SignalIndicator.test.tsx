import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SignalIndicator } from './SignalIndicator';

describe('SignalIndicator', () => {
  it('运行时显示活跃状态', () => {
    render(<SignalIndicator active={true} />);
    expect(screen.getByText('运行中')).toBeInTheDocument();
    const dot = screen.getByTestId('signal-dot');
    expect(dot.className).toContain('lg-signal-dot--active');
  });

  it('空闲时显示空闲状态', () => {
    render(<SignalIndicator active={false} />);
    expect(screen.getByText('空闲')).toBeInTheDocument();
    const dot = screen.getByTestId('signal-dot');
    expect(dot.className).toContain('lg-signal-dot--idle');
  });

  it('支持自定义文本', () => {
    render(<SignalIndicator active={true} label="录音中" />);
    expect(screen.getByText('录音中')).toBeInTheDocument();
  });
});
