import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ReactFlowProvider } from 'reactflow';
import { GraphNodeCard } from './GraphNodeCard';
import type { GraphNodeCardData } from './types';

function renderCard(
  overrides: Partial<GraphNodeCardData> = {},
  handleMode: 'simple' | 'multi' = 'multi',
) {
  const onClickTime = vi.fn();
  const data: GraphNodeCardData = {
    label: '节点正文',
    nodeType: 'claim',
    timestampMs: 1_000,
    status: 'confirmed',
    isActive: false,
    onClickTime,
    ...overrides,
  };
  render(
    <ReactFlowProvider>
      <GraphNodeCard
        id="n1"
        type="graphNode"
        selected={false}
        zIndex={0}
        isConnectable={false}
        xPos={0}
        yPos={0}
        dragging={false}
        handleMode={handleMode}
        data={data}
      />
    </ReactFlowProvider>,
  );
  return { onClickTime };
}

describe('GraphNodeCard extraction baseline', () => {
  it('exposes graph-node-card test id and tour data attributes', () => {
    renderCard({ isTourAdded: true, displayMode: 'compact' });
    expect(screen.getByTestId('graph-node-card-n1')).toHaveAttribute(
      'data-display-mode',
      'compact',
    );
    expect(screen.getByTestId('graph-node-card-n1')).toHaveAttribute(
      'data-tour-added',
      'true',
    );
  });
  it('renders multi handles with stable test ids', () => {
    renderCard({}, 'multi');
    expect(screen.getByTestId('graph-handle-target-top')).toBeInTheDocument();
    expect(screen.getByTestId('graph-handle-source-bottom')).toBeInTheDocument();
  });
  it('renders only simple top/bottom handles in simple mode', () => {
    renderCard({}, 'simple');
    expect(
      screen.queryByTestId('graph-handle-target-top'),
    ).not.toBeInTheDocument();
  });
  it('still invokes onClickTime from the header time button', () => {
    const { onClickTime } = renderCard({ timestampMs: 90_000 });
    fireEvent.click(screen.getByRole('button', { name: '1:30' }));
    expect(onClickTime).toHaveBeenCalledWith(90_000);
  });
});
