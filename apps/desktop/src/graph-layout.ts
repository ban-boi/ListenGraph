import type { Edge, Node } from 'reactflow';
import type { MergedGraph, ViewType } from '@listen-graphic/schema';
import {
  toCausalRendererGraph,
  toComparisonRendererGraph,
  toHierarchyRendererGraph,
  toTimelineRendererGraph,
} from '@listen-graphic/graph-renderers';

function getRendererGraph(viewType: ViewType, graph: MergedGraph) {
  switch (viewType) {
    case 'timeline':
      return toTimelineRendererGraph(graph);
    case 'comparison':
      return toComparisonRendererGraph(graph);
    case 'hierarchy':
      return toHierarchyRendererGraph(graph);
    case 'causal':
    default:
      return toCausalRendererGraph(graph);
  }
}

export function getLayoutedElements(viewType: ViewType, graph: MergedGraph) {
  const rendererGraph = getRendererGraph(viewType, graph);

  const nodes: Node[] = rendererGraph.nodes.map((node, index) => {
    let x = 0;
    let y = 0;

    switch (viewType) {
      case 'timeline':
        x = (index % 5) * 230;
        y = Math.floor(index / 5) * 155;
        break;
      case 'comparison':
        x = node.speaker === '输入源' ? 420 : 120;
        y = index * 108;
        break;
      case 'hierarchy':
        x = 100 + (index % 4) * 220;
        y = Math.floor(index / 4) * 170;
        break;
      case 'causal':
      default:
        x = 100 + (index % 3) * 270;
        y = index * 130;
        break;
    }

    return {
      id: node.id,
      type: 'graphNode',
      position: { x, y },
      data: {
        label: node.label,
        nodeType: node.type,
        speaker: node.speaker,
        timestampMs: node.timestampMs,
        status: node.status,
        isActive: index === rendererGraph.nodes.length - 1,
      },
    };
  });

  const edges: Edge[] = rendererGraph.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    label: edge.relation,
    animated: edge.relation === 'causes',
    style: {
      stroke:
        edge.relation === 'supports'
          ? 'var(--lg-success)'
          : edge.relation === 'causes'
            ? 'var(--lg-insight)'
            : 'var(--lg-muted)',
    },
  }));

  return { nodes, edges };
}
