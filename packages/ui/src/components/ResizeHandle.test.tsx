import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ResizeHandle } from './ResizeHandle';

describe('ResizeHandle', () => {
  it('渲染分割条并带正确的 role', () => {
    render(<ResizeHandle onResizeStart={() => {}} />);
    const handle = screen.getByRole('separator');
    expect(handle).toBeInTheDocument();
    expect(handle.style.cursor).toBe('row-resize');
  });

  it('mousedown 触发 onResizeStart', () => {
    const onResizeStart = vi.fn();
    render(<ResizeHandle onResizeStart={onResizeStart} />);
    fireEvent.mouseDown(screen.getByRole('separator'));
    expect(onResizeStart).toHaveBeenCalledOnce();
  });

  it('渲染拖拽指示器', () => {
    render(<ResizeHandle onResizeStart={() => {}} />);
    const handle = screen.getByRole('separator');
    const indicator = handle.querySelector('div');
    expect(indicator).toBeTruthy();
  });
});
