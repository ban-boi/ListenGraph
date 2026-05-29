import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ViewSwitcher } from './ViewSwitcher';

describe('ViewSwitcher', () => {
  it('渲染所有视图按钮', () => {
    render(<ViewSwitcher currentView="causal" onViewChange={() => {}} />);
    expect(screen.getByText('因果')).toBeInTheDocument();
    expect(screen.getByText('时间线')).toBeInTheDocument();
    expect(screen.getByText('对比')).toBeInTheDocument();
    expect(screen.getByText('层级')).toBeInTheDocument();
  });

  it('当前视图按钮高亮', () => {
    render(<ViewSwitcher currentView="timeline" onViewChange={() => {}} />);
    const activeBtn = screen.getByText('时间线');
    expect(activeBtn.className).toContain('lg-btn-primary');
  });

  it('点击触发 onViewChange', () => {
    const onChange = vi.fn();
    render(<ViewSwitcher currentView="causal" onViewChange={onChange} />);
    fireEvent.click(screen.getByText('对比'));
    expect(onChange).toHaveBeenCalledWith('comparison');
  });

  it('渲染 fitView 按钮', () => {
    render(
      <ViewSwitcher
        currentView="causal"
        onViewChange={() => {}}
        onFitView={() => {}}
      />,
    );
    expect(screen.getByText('适配视图')).toBeInTheDocument();
  });

  it('fitView 按钮在有 onFitView 但 disabled 时渲染', () => {
    render(
      <ViewSwitcher
        currentView="causal"
        onViewChange={() => {}}
        onFitView={() => {}}
        fitViewDisabled={true}
      />,
    );
    const btn = screen.getByText('适配视图');
    expect(btn).toBeDisabled();
  });
});
