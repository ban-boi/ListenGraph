import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusBar } from './StatusBar';

describe('StatusBar', () => {
  it('渲染 segments', () => {
    render(
      <StatusBar
        segments={[
          { id: 'session', content: '会话: abc123' },
          { id: 'time', content: '当前时间: 1:05' },
        ]}
      />,
    );
    expect(screen.getByText('会话: abc123')).toBeInTheDocument();
    expect(screen.getByText('当前时间: 1:05')).toBeInTheDocument();
  });

  it('渲染 children 作为替代', () => {
    render(
      <StatusBar>
        <span>自定义内容</span>
      </StatusBar>,
    );
    expect(screen.getByText('自定义内容')).toBeInTheDocument();
  });
});
