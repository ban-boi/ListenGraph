import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SecretField } from './SecretField';

describe('SecretField', () => {
  it('keeps configured secrets blank and explains blank preservation', () => {
    render(
      <SecretField
        ariaLabel="Tencent Secret ID"
        label="Secret ID"
        value=""
        configured
        onChange={() => undefined}
      />,
    );
    const input = screen.getByLabelText('Tencent Secret ID') as HTMLInputElement;
    expect(input.type).toBe('password');
    expect(input.placeholder).toContain('已保存');
    expect(screen.getByText(/已保存Secret ID，留空则保持不变/)).toBeInTheDocument();
  });

  it('toggles password visibility with an accessible button', async () => {
    const user = userEvent.setup();
    render(
      <SecretField
        ariaLabel="API Key"
        label="API Key"
        value="sk-test"
        configured={false}
        onChange={vi.fn()}
      />,
    );
    const input = screen.getByLabelText('API Key') as HTMLInputElement;
    expect(input.type).toBe('password');
    await user.click(screen.getByRole('button', { name: '显示 API Key' }));
    expect(input.type).toBe('text');
    await user.click(screen.getByRole('button', { name: '隐藏 API Key' }));
    expect(input.type).toBe('password');
  });
});
