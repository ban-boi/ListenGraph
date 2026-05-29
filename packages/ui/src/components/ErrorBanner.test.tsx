import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ErrorBanner } from './ErrorBanner';

describe('ErrorBanner', () => {
  it('渲染错误标题和消息', () => {
    render(
      <ErrorBanner stage="ASR" code="TIMEOUT" message="连接超时" />,
    );
    expect(screen.getByText('最近错误')).toBeInTheDocument();
    expect(screen.getByText(/ASR/)).toBeInTheDocument();
    expect(screen.getByText(/TIMEOUT/)).toBeInTheDocument();
    expect(screen.getByText('连接超时')).toBeInTheDocument();
  });

  it('使用 data-testid="error-banner"', () => {
    render(<ErrorBanner stage="ASR" code="ERR" message="test" />);
    expect(screen.getByTestId('error-banner')).toBeInTheDocument();
  });
});
