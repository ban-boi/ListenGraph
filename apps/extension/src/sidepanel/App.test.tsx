import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../sidepanel/App';

describe('App 组件', () => {
  beforeEach(() => {
    // Clear any state between tests
  });

  it('应该渲染日志区域', () => {
    render(<App />);

    // 检查日志区域是否存在
    const logArea = screen.getByTestId('log-area');
    expect(logArea).toBeInTheDocument();
  });

  it('应该显示日志区域内容', () => {
    render(<App />);

    // 检查日志区域是否存在并且有内容（开发模式会显示"开发模式: 已启用模拟数据"）
    const logArea = screen.getByTestId('log-area');
    expect(logArea).toBeInTheDocument();
    // 开发模式下会有日志显示
    const logContent = screen.getByText(/开发模式|等待日志/);
    expect(logContent).toBeInTheDocument();
  });

  it('应该渲染开始/停止按钮', () => {
    render(<App />);

    // 检查按钮是否存在
    const startButton = screen.getByRole('button', { name: /开始/i });
    expect(startButton).toBeInTheDocument();
  });

  it('应该渲染视图切换按钮', () => {
    render(<App />);

    // 检查视图按钮是否存在
    expect(screen.getByText('因果')).toBeInTheDocument();
    expect(screen.getByText('时间线')).toBeInTheDocument();
  });

  it('应该渲染底部状态栏', () => {
    render(<App />);

    // 检查状态栏
    expect(screen.getByText(/节点: 0/)).toBeInTheDocument();
    expect(screen.getByText(/边: 0/)).toBeInTheDocument();
  });

  it('点击开始按钮后应该改变状态', async () => {
    const user = userEvent.setup();
    render(<App />);

    // 点击开始按钮
    const startButton = screen.getByRole('button', { name: /开始/i });
    await user.click(startButton);

    // 按钮文字应该变成"停止"
    const stopButton = screen.getByRole('button', { name: /停止/i });
    expect(stopButton).toBeInTheDocument();
  });
});
