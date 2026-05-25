import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { OverflowMenu } from './OverflowMenu';

describe('OverflowMenu', () => {
  it('opens menu and shows export items', async () => {
    render(
      <OverflowMenu
        canExport
        canReplay
        debugOpen={false}
        replayOpen={false}
        buildInfo={{ uiLabel: 'ui-test', workerLabel: 'worker-test' }}
        onExport={vi.fn()}
        onToggleDebug={vi.fn()}
        onToggleReplay={vi.fn()}
      />,
    );

    expect(screen.queryByTestId('overflow-menu-export-json')).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByTestId('overflow-menu-toggle'));
    });

    expect(screen.getByTestId('overflow-menu-export-json')).toBeInTheDocument();
    expect(screen.getByTestId('build-info')).toHaveTextContent('UI ui-test | Worker worker-test');
  });
});
