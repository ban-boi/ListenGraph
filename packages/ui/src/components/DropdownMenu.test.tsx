import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DropdownMenu } from './DropdownMenu';

describe('DropdownMenu', () => {
  const items = [
    { id: 'a', label: '选项 A' },
    { id: 'b', label: '选项 B', disabled: true },
    { id: 'c', label: '选项 C' },
  ];

  it('点击触发按钮展开菜单', () => {
    render(
      <DropdownMenu triggerLabel="更多" items={items} onSelect={() => {}} />,
    );
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.click(screen.getByText('更多'));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(screen.getByText('选项 A')).toBeInTheDocument();
  });

  it('选择项目触发 onSelect 并关闭', () => {
    const onSelect = vi.fn();
    render(
      <DropdownMenu triggerLabel="更多" items={items} onSelect={onSelect} />,
    );
    fireEvent.click(screen.getByText('更多'));
    fireEvent.click(screen.getByText('选项 A'));
    expect(onSelect).toHaveBeenCalledWith('a');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('disabled 项不可点击', () => {
    const onSelect = vi.fn();
    render(
      <DropdownMenu triggerLabel="更多" items={items} onSelect={onSelect} />,
    );
    fireEvent.click(screen.getByText('更多'));
    const disabledBtn = screen.getByText('选项 B');
    expect(disabledBtn).toBeDisabled();
    fireEvent.click(disabledBtn);
    expect(onSelect).not.toHaveBeenCalled();
  });
});
