import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PipelineModule } from './PipelineModule';

describe('PipelineModule', () => {
  it('renders dot, label, and detail without a secondary status label', () => {
    render(
      <PipelineModule
        label="Graph"
        detail="图谱已稳定 · 3 节点 · 2 关系"
        tone="success"
        testId="status-card-graph"
      />,
    );
    expect(screen.getByTestId('status-card-graph')).toBeInTheDocument();
    expect(screen.getByText('Graph')).toBeInTheDocument();
    expect(screen.getByText('图谱已稳定 · 3 节点 · 2 关系')).toBeInTheDocument();
    expect(document.querySelector('.lg-pipeline-mod__status')).toBeNull();
  });
});
