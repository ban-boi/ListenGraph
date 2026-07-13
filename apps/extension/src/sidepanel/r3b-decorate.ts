import type { MergedGraph, ViewType, EdgeType } from '@listen-graphic/schema';
import type { R3bGeometry } from './r3b-geometry';
import type { ReactFlowDebugNode, ReactFlowDebugEdge, DebugViewArtifact } from './types';
import { VIEW_EDGE_PRIORITIES } from './constants';
import { resolveEdgeHandles, getRendererGraph } from './graph-utils';

export function decorateR3bArtifacts(
  graph: MergedGraph,
  geometry: R3bGeometry,
  currentView: ViewType,
  currentTimeMs: number,
  selectedNodeId: string | null,
): Record<ViewType, DebugViewArtifact> {
  const artifacts = {} as Record<ViewType, DebugViewArtifact>;

  for (const view of ['causal', 'comparison', 'hierarchy', 'timeline'] as ViewType[]) {
    const priorities = VIEW_EDGE_PRIORITIES[view] ?? VIEW_EDGE_PRIORITIES.causal;
    const rendererGraph = getRendererGraph(graph, view); // 真实 renderer graph（非伪数据）

    const nodes: ReactFlowDebugNode[] = graph.nodes
      .filter((n) => geometry.geometries[n.id])
      .map((n) => {
        const g = geometry.geometries[n.id];
        const isActive = Math.abs(n.timestampMs - currentTimeMs) < 30000 || n.id === selectedNodeId;
        return {
          id: n.id,
          type: 'graphNode' as const,
          position: g.position,
          data: {
            label: n.text,
            nodeType: n.type,
            speaker: n.speaker,
            timestampMs: n.timestampMs,
            status: n.status,
            isActive,
            nodeSize: g.size,
          },
          style: { width: g.size.width, height: g.size.height },
        };
      });

    const edges: ReactFlowDebugEdge[] = graph.edges
      .filter((e) => {
        const p = priorities[e.type as EdgeType];
        return p !== 'hidden';
      })
      .filter((e) => geometry.geometries[e.source] && geometry.geometries[e.target])
      .map((e) => {
        const sg = geometry.geometries[e.source];
        const tg = geometry.geometries[e.target];
        const handles = resolveEdgeHandles(sg.position, tg.position, sg.size, tg.size);
        const priority = priorities[e.type as EdgeType] ?? 'secondary';
        return {
          id: e.id,
          source: e.source,
          target: e.target,
          type: 'default' as const,
          sourceHandle: handles.sourceHandle,
          targetHandle: handles.targetHandle,
          label: e.type,
          style: {
            stroke:
              e.type === 'supports'
                ? '#10b981'
                : e.type === 'opposes'
                  ? '#ef4444'
                  : e.type === 'causes'
                    ? '#f59e0b'
                    : '#6b7280',
            opacity: priority === 'primary' ? 1 : 0.35,
          },
          animated: e.type === 'causes' && priority === 'primary',
        };
      });

    artifacts[view] = {
      rendererGraph,
      layoutDiagnostics: { reusedPositions: 0, newPositions: nodes.length, movedPositions: 0 },
      reactFlow: { nodes, edges },
    };
  }

  return artifacts;
}
