import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SimpleLogPanel, TimelineLogPanel } from './LogPanel';
import type { TimelineEvent } from './LogPanel';

describe('SimpleLogPanel', () => {
  it('无日志时显示占位文本', () => {
    render(<SimpleLogPanel logs={[]} placeholder="点击开始" />);
    expect(screen.getByText('点击开始')).toBeInTheDocument();
  });

  it('渲染日志条目', () => {
    render(
      <SimpleLogPanel logs={['第一条日志', '第二条日志']} placeholder="" />,
    );
    expect(screen.getByText('第一条日志')).toBeInTheDocument();
    expect(screen.getByText('第二条日志')).toBeInTheDocument();
  });

  it('显示日志数量标题', () => {
    render(<SimpleLogPanel logs={['a', 'b']} placeholder="" />);
    expect(screen.getByText('日志 (2)')).toBeInTheDocument();
  });
});

describe('TimelineLogPanel', () => {
  const events: TimelineEvent[] = [
    {
      id: 'e1',
      timestamp: Date.now(),
      stage: 'asr',
      message: '转写完成',
      detail: '详细信息',
      tone: 'success',
      repeatCount: 1,
    },
  ];

  it('无事件时显示占位文本', () => {
    render(<TimelineLogPanel events={[]} placeholder="等待事件" />);
    expect(screen.getByText('等待事件')).toBeInTheDocument();
  });

  it('渲染事件条目', () => {
    render(<TimelineLogPanel events={events} placeholder="" />);
    expect(screen.getByText('转写完成')).toBeInTheDocument();
    expect(screen.getByText('详细信息')).toBeInTheDocument();
  });

  it('渲染 stage badge', () => {
    render(<TimelineLogPanel events={events} placeholder="" />);
    expect(screen.getByText('ASR')).toBeInTheDocument();
  });
});
