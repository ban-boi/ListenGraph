import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import App from './App';

// Mock ReactFlow
vi.mock('reactflow', () => ({
  ReactFlow: ({ children }: any) => (
    <div data-testid="react-flow">{children}</div>
  ),
  Background: () => <div data-testid="background" />,
  Controls: () => <div data-testid="controls" />,
  Handle: () => null,
  Position: { Top: 'top', Bottom: 'bottom' },
}));

describe('App 组件', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('应该渲染开始按钮', () => {
    render(<App />);
    const startButton = screen.getByRole('button', { name: /开始/i });
    expect(startButton).toBeInTheDocument();
  });

  it('初始状态应该显示"空闲"', () => {
    render(<App />);
    expect(screen.getByText('空闲')).toBeInTheDocument();
  });

  it('点击开始按钮后应该显示"运行中"', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<App />);

    const startButton = screen.getByRole('button', { name: /开始/i });
    await act(async () => {
      await user.click(startButton);
    });

    expect(screen.getByText('运行中')).toBeInTheDocument();
  });

  it('点击开始后应该生成第一个节点', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<App />);

    const startButton = screen.getByRole('button', { name: /开始/i });

    // 关键：用 act() 包裹 click，确保 useEffect 被触发
    await act(async () => {
      await user.click(startButton);
    });

    // useEffect 应该在 act() 后执行完成
    expect(screen.getByText(/节点: 1/)).toBeInTheDocument();
  });

  it('点击开始后应该显示日志', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<App />);

    const startButton = screen.getByRole('button', { name: /开始/i });
    await act(async () => {
      await user.click(startButton);
    });

    // 应该显示会话开始的日志
    expect(screen.getByText(/会话开始/)).toBeInTheDocument();
  });

  it('点击开始后按钮应该变成"停止"', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<App />);

    const startButton = screen.getByRole('button', { name: /开始/i });
    await act(async () => {
      await user.click(startButton);
    });

    const stopButton = screen.getByRole('button', { name: /停止/i });
    expect(stopButton).toBeInTheDocument();
  });

  it('点击停止后应该恢复空闲状态', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<App />);

    const startButton = screen.getByRole('button', { name: /开始/i });
    await act(async () => {
      await user.click(startButton);
    });

    const stopButton = screen.getByRole('button', { name: /停止/i });
    await act(async () => {
      await user.click(stopButton);
    });

    expect(screen.getByText('空闲')).toBeInTheDocument();
  });

  it('应该每30秒生成一个新节点', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<App />);

    const startButton = screen.getByRole('button', { name: /开始/i });
    await act(async () => {
      await user.click(startButton);
    });

    // 初始有1个节点（useEffect 立即生成）
    expect(screen.getByText(/节点: 1/)).toBeInTheDocument();

    // 快进30秒
    await act(async () => {
      vi.advanceTimersByTime(30000);
    });

    // 应该有2个节点
    expect(screen.getByText(/节点: 2/)).toBeInTheDocument();
  });

  it('应该渲染视图切换按钮', () => {
    render(<App />);

    expect(screen.getByText('因果图')).toBeInTheDocument();
    expect(screen.getByText('时间线')).toBeInTheDocument();
    expect(screen.getByText('对比图')).toBeInTheDocument();
    expect(screen.getByText('层级图')).toBeInTheDocument();
  });

  it('应该显示底部状态栏', () => {
    render(<App />);

    expect(screen.getByText(/会话: 无/)).toBeInTheDocument();
    expect(screen.getByText(/节点: 0/)).toBeInTheDocument();
    expect(screen.getByText(/边: 0/)).toBeInTheDocument();
  });

  it('应该显示日志面板', () => {
    render(<App />);

    expect(screen.getByText('日志 (0)')).toBeInTheDocument();
  });

  it('开始后日志数量应该增加', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<App />);

    const startButton = screen.getByRole('button', { name: /开始/i });
    await act(async () => {
      await user.click(startButton);
    });

    // 应该有多个日志条目（会话开始 + capture + 转写 + 节点）
    const logHeader = screen.getByText(/日志 \(\d+\)/);
    const match = logHeader.textContent?.match(/日志 \((\d+)\)/);
    expect(match && parseInt(match[1])).toBeGreaterThan(0);
  });
});
