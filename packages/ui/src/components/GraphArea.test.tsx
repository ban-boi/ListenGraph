import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { GraphArea } from './GraphArea';
import type { Node } from 'reactflow';

vi.mock('reactflow', () => ({
  ReactFlow: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="react-flow">{children}</div>
  ),
  Background: () => <div data-testid="background" />,
  Controls: () => <div data-testid="controls" />,
}));

describe('GraphArea', () => {
  it('无节点且空闲时显示 EmptyState', () => {
    render(
      <GraphArea
        nodes={[]}
        edges={[]}
        nodeTypes={{}}
        isIdle={true}
        onNodeClick={() => {}}
      />,
    );
    expect(screen.getByText('开始记录')).toBeInTheDocument();
    expect(screen.queryByTestId('react-flow')).toBeNull();
  });

  it('有节点时显示 ReactFlow', () => {
    const nodes: Node[] = [
      { id: 'n1', position: { x: 0, y: 0 }, data: {} },
    ];
    render(
      <GraphArea
        nodes={nodes}
        edges={[]}
        nodeTypes={{}}
        isIdle={false}
        onNodeClick={() => {}}
      />,
    );
    expect(screen.getByTestId('react-flow')).toBeInTheDocument();
    expect(screen.queryByTestId('empty-state')).toBeNull();
  });

  it('运行中（非空闲）时即使无节点也显示 ReactFlow', () => {
    render(
      <GraphArea
        nodes={[]}
        edges={[]}
        nodeTypes={{}}
        isIdle={false}
        onNodeClick={() => {}}
      />,
    );
    expect(screen.getByTestId('react-flow')).toBeInTheDocument();
  });
});
