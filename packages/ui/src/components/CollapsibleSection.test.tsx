import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CollapsibleSection } from './CollapsibleSection';

describe('CollapsibleSection', () => {
  it('defaults to collapsed and toggles content', async () => {
    const user = userEvent.setup();
    render(
      <CollapsibleSection title="高级参数">
        <div>VAD silence</div>
      </CollapsibleSection>,
    );
    expect(screen.queryByText('VAD silence')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /高级参数/ }));
    expect(screen.getByText('VAD silence')).toBeInTheDocument();
  });
});
