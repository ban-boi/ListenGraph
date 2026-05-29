import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { ReactFlowProvider } from 'reactflow';
import { GraphNodeCard } from './GraphNodeCard';
import type { GraphNodeCardData } from './types';

function renderCard(overrides: Partial<GraphNodeCardData> = {}) {
  const onClickTime = vi.fn();
  const data: GraphNodeCardData = {
    label: '这是节点正文内容',
    nodeType: 'claim',
    timestampMs: 65_000,
    status: 'confirmed',
    isActive: false,
    onClickTime,
    ...overrides,
  };
  render(
    <ReactFlowProvider>
      <GraphNodeCard id="n1" type="graphNode" selected={false} zIndex={0} isConnectable={false} xPos={0} yPos={0} dragging={false} data={data} />
    </ReactFlowProvider>,
  );
  return { onClickTime };
}

describe('GraphNodeCard header layout', () => {
  it('renders type and time on the same header row', () => {
    renderCard();
    const header = screen.getByTestId('graph-node-card-header');
    expect(within(header).getByText('观点')).toBeInTheDocument();
    expect(within(header).getByRole('button', { name: '1:05' })).toBeInTheDocument();
  });
  it('renders label on its own body row below the header', () => {
    renderCard({ label: '独立正文行' });
    expect(screen.getByTestId('graph-node-card-body')).toHaveTextContent('独立正文行');
    expect(screen.getByTestId('graph-node-card-header')).not.toHaveTextContent('独立正文行');
  });
  it('shows speaker on a separate row only when provided', () => {
    renderCard();
    expect(screen.queryByTestId('graph-node-card-speaker')).not.toBeInTheDocument();
    renderCard({ speaker: '嘉宾A' });
    expect(screen.getByTestId('graph-node-card-speaker')).toHaveTextContent('嘉宾A');
  });
  it('keeps draft badge beside type on the header left', () => {
    renderCard({ status: 'draft' });
    const header = screen.getByTestId('graph-node-card-header');
    expect(within(header).getByText('观点')).toBeInTheDocument();
    expect(within(header).getByText('草稿')).toBeInTheDocument();
  });
  it('still invokes onClickTime when the time button is clicked', () => {
    const { onClickTime } = renderCard({ timestampMs: 90_000 });
    fireEvent.click(screen.getByRole('button', { name: '1:30' }));
    expect(onClickTime).toHaveBeenCalledWith(90_000);
  });
});
