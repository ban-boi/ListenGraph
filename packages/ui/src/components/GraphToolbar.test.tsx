import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { GraphToolbar } from './GraphToolbar';

beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
});

describe('GraphToolbar', () => {
  it('渲染品牌名', () => {
    render(
      <GraphToolbar
        brandName="Listen Graphic"
        primaryAction={{ label: '开始', onClick: () => {} }}
      />,
    );
    expect(screen.getByText('Listen Graphic')).toBeInTheDocument();
    expect(screen.getByText('开始')).toBeInTheDocument();
  });

  it('渲染 actions slot', () => {
    render(
      <GraphToolbar
        brandName="Test"
        primaryAction={{ label: '开始', onClick: () => {} }}
        actions={<button>自定义按钮</button>}
      />,
    );
    expect(screen.getByText('自定义按钮')).toBeInTheDocument();
  });

  it('primaryAction 点击触发回调', () => {
    const onClick = vi.fn();
    render(
      <GraphToolbar
        brandName="Test"
        primaryAction={{ label: '开始', onClick }}
      />,
    );
    fireEvent.click(screen.getByText('开始'));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('active 状态渲染停止按钮（danger）', () => {
    render(
      <GraphToolbar
        brandName="Test"
        primaryAction={{ label: '停止', onClick: () => {}, active: true }}
      />,
    );
    const btn = screen.getByText('停止');
    expect(btn.className).toContain('lg-btn-danger');
  });

  it('渲染 info slot', () => {
    render(
      <GraphToolbar
        brandName="Test"
        primaryAction={{ label: '开始', onClick: () => {} }}
        info={<span>sequence step 1/3</span>}
      />,
    );
    expect(screen.getByText('sequence step 1/3')).toBeInTheDocument();
  });
});
