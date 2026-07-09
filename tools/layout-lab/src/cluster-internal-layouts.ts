import type { GraphNode, GraphEdge, EdgeType } from '@listen-graphic/schema';

export type Position = { x: number; y: number };

const CARD_W = 220;
const CARD_H = 132;
const GAP_X = 40;   // horizontal gap between cards
const GAP_Y = 30;   // vertical gap between cards

// ── Strategy A: Topological layering ──
// BFS from root nodes (in-degree 0). Nodes at same depth go in the same horizontal row.
// Layer 0 at top, layer 1 below, etc. Within a layer, nodes spread horizontally.
// Edges flow top-to-bottom, matching the vertical layer direction → minimal crossing.
//
// For nodes in cycles (can't reach via BFS), assign them to max_depth+1.
export function layoutTopologicalLayers(
  nodes: GraphNode[],
  edges: GraphEdge[],
): Record<string, Position> {
  const nodeIds = new Set(nodes.map(n => n.id));
  const nodeMap = new Map(nodes.map(n => [n.id, n]));

  // Build adjacency (only structural edges: causes, supports, example_of, follows)
  const structuralTypes = new Set<EdgeType>(['causes', 'supports', 'example_of', 'follows']);
  const inDegree = new Map<string, number>();
  const children = new Map<string, string[]>();
  for (const n of nodes) { inDegree.set(n.id, 0); children.set(n.id, []); }
  for (const e of edges) {
    if (!structuralTypes.has(e.type)) continue;
    if (!nodeIds.has(e.source) || !nodeIds.has(e.target)) continue;
    if (e.source === e.target) continue;
    children.get(e.source)!.push(e.target);
    inDegree.set(e.target, (inDegree.get(e.target) ?? 0) + 1);
  }

  // BFS layering: start from in-degree-0 nodes
  const layers: string[][] = [];
  const assigned = new Set<string>();
  let currentLayer = nodes
    .filter(n => (inDegree.get(n.id) ?? 0) === 0)
    .sort((a, b) => a.timestampMs - b.timestampMs)
    .map(n => n.id);

  if (currentLayer.length === 0) {
    // No root (all in cycles) — pick earliest node as root
    currentLayer = [nodes.sort((a, b) => a.timestampMs - b.timestampMs)[0]?.id].filter(Boolean) as string[];
  }

  while (currentLayer.length > 0) {
    layers.push(currentLayer);
    for (const id of currentLayer) assigned.add(id);
    const next: string[] = [];
    for (const id of currentLayer) {
      for (const child of children.get(id) ?? []) {
        if (!assigned.has(child)) {
          // Check all parents assigned
          const parents = edges.filter(e => e.target === child && structuralTypes.has(e.type) && nodeIds.has(e.source));
          if (parents.every(p => assigned.has(p.source))) {
            next.push(child);
          }
        }
      }
    }
    // Deduplicate + sort
    const unique = [...new Set(next)].sort((a, b) => {
      return (nodeMap.get(a)?.timestampMs ?? 0) - (nodeMap.get(b)?.timestampMs ?? 0);
    });
    currentLayer = unique;
  }

  // Any unassigned nodes (cycles) → last layer
  const unassigned = nodes.filter(n => !assigned.has(n.id));
  if (unassigned.length > 0) {
    layers.push(unassigned.sort((a, b) => a.timestampMs - b.timestampMs).map(n => n.id));
  }

  // Position: each layer is a row, nodes spread horizontally
  const positions: Record<string, Position> = {};
  layers.forEach((layer, layerIdx) => {
    const layerWidth = layer.length * (CARD_W + GAP_X) - GAP_X;
    const startX = Math.max(0, (1200 - layerWidth) / 2); // center within 1200px
    layer.forEach((nodeId, i) => {
      positions[nodeId] = {
        x: startX + i * (CARD_W + GAP_X),
        y: layerIdx * (CARD_H + GAP_Y),
      };
    });
  });

  return positions;
}

// ── Strategy B: Fan-out from high-degree nodes ──
// Process nodes in topological order. Each node's children fan out horizontally
// around the parent's X position, like a tree branching outward.
// Children are placed at parent.y + CARD_H + GAP_Y, spread horizontally centered on parent.
export function layoutFanOut(
  nodes: GraphNode[],
  edges: GraphEdge[],
): Record<string, Position> {
  const nodeIds = new Set(nodes.map(n => n.id));
  const nodeMap = new Map(nodes.map(n => [n.id, n]));
  const structuralTypes = new Set<EdgeType>(['causes', 'supports', 'example_of', 'follows']);

  const inDegree = new Map<string, number>();
  const children = new Map<string, string[]>();
  for (const n of nodes) { inDegree.set(n.id, 0); children.set(n.id, []); }
  for (const e of edges) {
    if (!structuralTypes.has(e.type)) continue;
    if (!nodeIds.has(e.source) || !nodeIds.has(e.target)) continue;
    if (e.source === e.target) continue;
    children.get(e.source)!.push(e.target);
    inDegree.set(e.target, (inDegree.get(e.target) ?? 0) + 1);
  }

  // Topological order
  const queue = nodes
    .filter(n => (inDegree.get(n.id) ?? 0) === 0)
    .sort((a, b) => a.timestampMs - b.timestampMs)
    .map(n => n.id);
  const visited = new Set<string>();
  const order: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    order.push(id);
    for (const child of children.get(id) ?? []) {
      const d = (inDegree.get(child) ?? 1) - 1;
      inDegree.set(child, d);
      if (d <= 0) queue.push(child);
    }
    queue.sort((a, b) => (nodeMap.get(a)?.timestampMs ?? 0) - (nodeMap.get(b)?.timestampMs ?? 0));
  }
  // Unvisited (cycles)
  for (const n of nodes) if (!visited.has(n.id)) order.push(n.id);

  // Assign positions: root at center top, children fan out below
  const positions: Record<string, Position> = {};
  const placed = new Set<string>();
  const COLUMN_UNIT = CARD_W + GAP_X;

  // Place roots in a horizontal row at y=0
  const roots = order.filter(id => (inDegree.get(id) ?? 0) === 0 || !placed.has(id));
  // Actually just place in order, fanning children
  const placeSubtree = (nodeId: string, x: number, y: number, depth: number): number => {
    if (placed.has(nodeId)) return x;
    positions[nodeId] = { x, y };
    placed.add(nodeId);

    const kids = (children.get(nodeId) ?? []).filter(c => !placed.has(c));
    if (kids.length === 0) return x + COLUMN_UNIT;

    // Fan children centered on parent
    const totalWidth = kids.length * COLUMN_UNIT;
    let childX = x - (totalWidth - COLUMN_UNIT) / 2;
    let maxReturn = childX + totalWidth;
    for (const child of kids) {
      const ret = placeSubtree(child, childX, y + CARD_H + GAP_Y, depth + 1);
      childX = ret;
    }
    // Return the rightmost extent
    return Math.max(maxReturn, x + COLUMN_UNIT);
  };

  // Place roots sequentially
  let cursorX = 0;
  for (const id of order) {
    if (placed.has(id)) continue;
    cursorX = placeSubtree(id, cursorX, 0, 0);
    cursorX += COLUMN_UNIT; // gap between root subtrees
  }

  // Normalize: shift all so min x = 0
  const minX = Math.min(...Object.values(positions).map(p => p.x));
  for (const id of Object.keys(positions)) {
    positions[id].x -= minX;
  }

  return positions;
}

// ── Strategy C: Keep columns but group by subtree ──
// Same 2-column structure (x=60 main, x=340 branch) as baseline,
// BUT: group children of the same parent together vertically with
// a visual gap between different parents' children groups.
// This reduces cross-subtree line crossings within the same column.
export function layoutColumnGrouped(
  nodes: GraphNode[],
  edges: GraphEdge[],
): Record<string, Position> {
  const MAIN_X = 60;
  const BRANCH_X = 340;
  const ROW_GAP = 168;
  const CARD_W = 220;
  const CARD_H = 132;
  const GROUP_GAP = 50; // extra gap between different parents' child groups

  const nodeIds = new Set(nodes.map(n => n.id));
  const nodeMap = new Map(nodes.map(n => [n.id, n]));
  const structuralTypes = new Set<EdgeType>(['causes', 'supports', 'example_of', 'follows']);

  const children = new Map<string, string[]>();
  const parents = new Map<string, string[]>();
  for (const n of nodes) { children.set(n.id, []); parents.set(n.id, []); }
  for (const e of edges) {
    if (!structuralTypes.has(e.type)) continue;
    if (!nodeIds.has(e.source) || !nodeIds.has(e.target)) continue;
    if (e.source === e.target) continue;
    children.get(e.source)!.push(e.target);
    parents.get(e.target)!.push(e.source);
  }

  // Topological order for main column
  const inDegree = new Map<string, number>();
  for (const n of nodes) inDegree.set(n.id, parents.get(n.id)!.length);
  const queue = nodes
    .filter(n => (inDegree.get(n.id) ?? 0) === 0)
    .sort((a, b) => a.timestampMs - b.timestampMs)
    .map(n => n.id);
  const visited = new Set<string>();
  const mainOrder: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    mainOrder.push(id);
    for (const child of children.get(id) ?? []) {
      const d = (inDegree.get(child) ?? 1) - 1;
      inDegree.set(child, d);
      if (d <= 0) queue.push(child);
    }
    queue.sort((a, b) => (nodeMap.get(a)?.timestampMs ?? 0) - (nodeMap.get(b)?.timestampMs ?? 0));
  }
  for (const n of nodes) if (!visited.has(n.id)) mainOrder.push(n.id);

  // Place main column nodes, and their children grouped right after
  const positions: Record<string, Position> = {};
  const placed = new Set<string>();
  let y = 0;

  for (const parentId of mainOrder) {
    if (placed.has(parentId)) continue;
    positions[parentId] = { x: MAIN_X, y };
    placed.add(parentId);

    // Place this parent's children as a group in the branch column
    const kids = (children.get(parentId) ?? []).filter(c => !placed.has(c));
    if (kids.length > 0) {
      const groupStartY = y;
      kids.forEach((kidId, i) => {
        positions[kidId] = { x: BRANCH_X, y: groupStartY + i * ROW_GAP };
        placed.add(kidId);
      });
      y = groupStartY + kids.length * ROW_GAP + GROUP_GAP;
    } else {
      y += ROW_GAP;
    }
  }

  return positions;
}

// ── Strategy D: Force-directed layout ──
// Classic force-directed: nodes repel each other, edges act as springs.
// Iteratively simulates physics until positions stabilize.
// This spreads network/graph structures into a 2D plane instead of a line.
export function layoutForceDirected(
  nodes: GraphNode[],
  edges: GraphEdge[],
  iterations = 300,
): Record<string, Position> {
  if (nodes.length === 0) return {};
  if (nodes.length === 1) return { [nodes[0].id]: { x: 0, y: 0 } };

  const nodeIds = new Set(nodes.map(n => n.id));
  const structuralTypes = new Set<EdgeType>(['causes', 'supports', 'example_of', 'follows', 'opposes']);

  // Build edge list (only structural edges between existing nodes)
  const edgeList: Array<{ source: string; target: string }> = [];
  for (const e of edges) {
    if (!structuralTypes.has(e.type)) continue;
    if (!nodeIds.has(e.source) || !nodeIds.has(e.target)) continue;
    if (e.source === e.target) continue;
    edgeList.push({ source: e.source, target: e.target });
  }

  // Initialize positions in a circle (deterministic seed based on node order)
  const positions: Record<string, Position> = {};
  const radius = Math.max(300, nodes.length * 25);
  nodes.forEach((n, i) => {
    const angle = (i / nodes.length) * Math.PI * 2;
    positions[n.id] = {
      x: Math.cos(angle) * radius + (i % 3) * 10, // small jitter to break symmetry
      y: Math.sin(angle) * radius + (i % 3) * 10,
    };
  });

  // Parameters
  const REPULSION = 80000;      // repulsion constant (higher = more spread)
  const SPRING_LENGTH = 180;    // ideal edge length
  const SPRING_K = 0.04;        // spring stiffness
  const DAMPING = 0.85;         // velocity damping
  const MAX_DISPLACEMENT = 50;  // per-iteration cap to prevent explosion

  const velocities: Record<string, Position> = {};
  for (const n of nodes) velocities[n.id] = { x: 0, y: 0 };

  for (let iter = 0; iter < iterations; iter++) {
    const forces: Record<string, Position> = {};
    for (const n of nodes) forces[n.id] = { x: 0, y: 0 };

    // Repulsion: all pairs
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i], b = nodes[j];
        const dx = positions[a.id].x - positions[b.id].x;
        const dy = positions[a.id].y - positions[b.id].y;
        let dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 1) dist = 1; // avoid division by zero
        const force = REPULSION / (dist * dist);
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        forces[a.id].x += fx;
        forces[a.id].y += fy;
        forces[b.id].x -= fx;
        forces[b.id].y -= fy;
      }
    }

    // Spring attraction: edges
    for (const edge of edgeList) {
      const dx = positions[edge.target].x - positions[edge.source].x;
      const dy = positions[edge.target].y - positions[edge.source].y;
      let dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 1) dist = 1;
      const displacement = dist - SPRING_LENGTH;
      const force = SPRING_K * displacement;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      forces[edge.source].x += fx;
      forces[edge.source].y += fy;
      forces[edge.target].x -= fx;
      forces[edge.target].y -= fy;
    }

    // Apply forces with damping and displacement cap
    for (const n of nodes) {
      velocities[n.id].x = (velocities[n.id].x + forces[n.id].x) * DAMPING;
      velocities[n.id].y = (velocities[n.id].y + forces[n.id].y) * DAMPING;
      // Cap displacement
      const vx = Math.max(-MAX_DISPLACEMENT, Math.min(MAX_DISPLACEMENT, velocities[n.id].x));
      const vy = Math.max(-MAX_DISPLACEMENT, Math.min(MAX_DISPLACEMENT, velocities[n.id].y));
      positions[n.id].x += vx;
      positions[n.id].y += vy;
    }
  }

  // Normalize: shift so min x and min y are 0
  const allPos = Object.values(positions);
  const minX = Math.min(...allPos.map(p => p.x));
  const minY = Math.min(...allPos.map(p => p.y));
  for (const id of Object.keys(positions)) {
    positions[id].x -= minX;
    positions[id].y -= minY;
  }

  return positions;
}
