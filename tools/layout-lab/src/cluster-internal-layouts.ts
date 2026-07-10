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

// ── Strategy D1: Force-directed + center-axis gravity ──
// Same as D0 but adds a continuous gentle pull toward the vertical center axis (x = targetWidth/2).
// This "encourages" the layout to be narrow without hard constraints.
// GRAVITY_STRENGTH controls how aggressively nodes are pulled toward center.
export function layoutForceDirectedGravity(
  nodes: GraphNode[],
  edges: GraphEdge[],
  iterations = 300,
  targetWidth = 600,
): Record<string, Position> {
  if (nodes.length === 0) return {};
  if (nodes.length === 1) return { [nodes[0].id]: { x: targetWidth / 2, y: 0 } };

  const nodeIds = new Set(nodes.map(n => n.id));
  const structuralTypes = new Set<EdgeType>(['causes', 'supports', 'example_of', 'follows', 'opposes']);
  const edgeList: Array<{ source: string; target: string }> = [];
  for (const e of edges) {
    if (!structuralTypes.has(e.type)) continue;
    if (!nodeIds.has(e.source) || !nodeIds.has(e.target)) continue;
    if (e.source === e.target) continue;
    edgeList.push({ source: e.source, target: e.target });
  }

  const positions: Record<string, Position> = {};
  const radius = Math.max(200, nodes.length * 15);
  nodes.forEach((n, i) => {
    const angle = (i / nodes.length) * Math.PI * 2;
    positions[n.id] = {
      x: Math.cos(angle) * radius + (i % 3) * 10,
      y: Math.sin(angle) * radius + (i % 3) * 10,
    };
  });

  const REPULSION = 80000;
  const SPRING_LENGTH = 160;
  const SPRING_K = 0.04;
  const DAMPING = 0.85;
  const MAX_DISPLACEMENT = 50;
  // Center-axis gravity: pull each node toward x = targetWidth/2
  const GRAVITY_STRENGTH = 0.015;
  const centerX = targetWidth / 2;

  const velocities: Record<string, Position> = {};
  for (const n of nodes) velocities[n.id] = { x: 0, y: 0 };

  for (let iter = 0; iter < iterations; iter++) {
    const forces: Record<string, Position> = {};
    for (const n of nodes) forces[n.id] = { x: 0, y: 0 };

    // Repulsion
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i], b = nodes[j];
        const dx = positions[a.id].x - positions[b.id].x;
        const dy = positions[a.id].y - positions[b.id].y;
        let dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 1) dist = 1;
        const force = REPULSION / (dist * dist);
        forces[a.id].x += (dx / dist) * force;
        forces[a.id].y += (dy / dist) * force;
        forces[b.id].x -= (dx / dist) * force;
        forces[b.id].y -= (dy / dist) * force;
      }
    }

    // Spring attraction
    for (const edge of edgeList) {
      const dx = positions[edge.target].x - positions[edge.source].x;
      const dy = positions[edge.target].y - positions[edge.source].y;
      let dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 1) dist = 1;
      const force = SPRING_K * (dist - SPRING_LENGTH);
      forces[edge.source].x += (dx / dist) * force;
      forces[edge.source].y += (dy / dist) * force;
      forces[edge.target].x -= (dx / dist) * force;
      forces[edge.target].y -= (dy / dist) * force;
    }

    // Center-axis gravity (only on X)
    for (const n of nodes) {
      const dx = centerX - positions[n.id].x;
      forces[n.id].x += dx * GRAVITY_STRENGTH;
    }

    // Apply
    for (const n of nodes) {
      velocities[n.id].x = (velocities[n.id].x + forces[n.id].x) * DAMPING;
      velocities[n.id].y = (velocities[n.id].y + forces[n.id].y) * DAMPING;
      positions[n.id].x += Math.max(-MAX_DISPLACEMENT, Math.min(MAX_DISPLACEMENT, velocities[n.id].x));
      positions[n.id].y += Math.max(-MAX_DISPLACEMENT, Math.min(MAX_DISPLACEMENT, velocities[n.id].y));
    }
  }

  // Normalize
  const allPos = Object.values(positions);
  const minX = Math.min(...allPos.map(p => p.x));
  const minY = Math.min(...allPos.map(p => p.y));
  for (const id of Object.keys(positions)) {
    positions[id].x -= minX;
    positions[id].y -= minY;
  }
  return positions;
}

// ── Strategy D2: Force-directed + soft width penalty ──
// Same as D0 but adds a conditional force: if a node's X exceeds targetWidth,
// a penalty pushes it back inward. Nodes within the width are free.
// PENALTY_STRENGTH controls how hard the boundary pushes back.
export function layoutForceDirectedWidthPenalty(
  nodes: GraphNode[],
  edges: GraphEdge[],
  iterations = 300,
  targetWidth = 600,
): Record<string, Position> {
  if (nodes.length === 0) return {};
  if (nodes.length === 1) return { [nodes[0].id]: { x: 0, y: 0 } };

  const nodeIds = new Set(nodes.map(n => n.id));
  const structuralTypes = new Set<EdgeType>(['causes', 'supports', 'example_of', 'follows', 'opposes']);
  const edgeList: Array<{ source: string; target: string }> = [];
  for (const e of edges) {
    if (!structuralTypes.has(e.type)) continue;
    if (!nodeIds.has(e.source) || !nodeIds.has(e.target)) continue;
    if (e.source === e.target) continue;
    edgeList.push({ source: e.source, target: e.target });
  }

  const positions: Record<string, Position> = {};
  const radius = Math.max(200, nodes.length * 15);
  nodes.forEach((n, i) => {
    const angle = (i / nodes.length) * Math.PI * 2;
    positions[n.id] = {
      x: Math.cos(angle) * radius + (i % 3) * 10,
      y: Math.sin(angle) * radius + (i % 3) * 10,
    };
  });

  const REPULSION = 80000;
  const SPRING_LENGTH = 160;
  const SPRING_K = 0.04;
  const DAMPING = 0.85;
  const MAX_DISPLACEMENT = 50;
  // Soft width penalty: push back if x < 0 or x > targetWidth
  const PENALTY_STRENGTH = 0.08;

  const velocities: Record<string, Position> = {};
  for (const n of nodes) velocities[n.id] = { x: 0, y: 0 };

  for (let iter = 0; iter < iterations; iter++) {
    const forces: Record<string, Position> = {};
    for (const n of nodes) forces[n.id] = { x: 0, y: 0 };

    // Repulsion
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i], b = nodes[j];
        const dx = positions[a.id].x - positions[b.id].x;
        const dy = positions[a.id].y - positions[b.id].y;
        let dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 1) dist = 1;
        const force = REPULSION / (dist * dist);
        forces[a.id].x += (dx / dist) * force;
        forces[a.id].y += (dy / dist) * force;
        forces[b.id].x -= (dx / dist) * force;
        forces[b.id].y -= (dy / dist) * force;
      }
    }

    // Spring attraction
    for (const edge of edgeList) {
      const dx = positions[edge.target].x - positions[edge.source].x;
      const dy = positions[edge.target].y - positions[edge.source].y;
      let dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 1) dist = 1;
      const force = SPRING_K * (dist - SPRING_LENGTH);
      forces[edge.source].x += (dx / dist) * force;
      forces[edge.source].y += (dy / dist) * force;
      forces[edge.target].x -= (dx / dist) * force;
      forces[edge.target].y -= (dy / dist) * force;
    }

    // Soft width penalty: only on X, only when out of bounds
    for (const n of nodes) {
      const x = positions[n.id].x;
      if (x < 0) {
        forces[n.id].x += (-x) * PENALTY_STRENGTH; // push right
      } else if (x > targetWidth) {
        forces[n.id].x -= (x - targetWidth) * PENALTY_STRENGTH; // push left
      }
    }

    // Apply
    for (const n of nodes) {
      velocities[n.id].x = (velocities[n.id].x + forces[n.id].x) * DAMPING;
      velocities[n.id].y = (velocities[n.id].y + forces[n.id].y) * DAMPING;
      positions[n.id].x += Math.max(-MAX_DISPLACEMENT, Math.min(MAX_DISPLACEMENT, velocities[n.id].x));
      positions[n.id].y += Math.max(-MAX_DISPLACEMENT, Math.min(MAX_DISPLACEMENT, velocities[n.id].y));
    }
  }

  // Normalize
  const allPos = Object.values(positions);
  const minX = Math.min(...allPos.map(p => p.x));
  const minY = Math.min(...allPos.map(p => p.y));
  for (const id of Object.keys(positions)) {
    positions[id].x -= minX;
    positions[id].y -= minY;
  }
  return positions;
}

// ── Layout quality metrics ──
// Computes quantitative metrics for comparing layouts.
export type LayoutMetrics = {
  aspectRatio: number;       // width / height (lower = more vertical/narrow)
  avgEdgeLength: number;     // average Euclidean distance of edges
  longEdgeRatio: number;     // fraction of edges longer than 30% of canvas diagonal
  edgeCrossings: number;     // count of edge-node intersections (edge passes through a node card)
};

export function computeLayoutMetrics(
  nodes: GraphNode[],
  edges: GraphEdge[],
  positions: Record<string, Position>,
  cardWidth = 220,
  cardHeight = 132,
): LayoutMetrics {
  const validIds = new Set(Object.keys(positions));
  const validEdges = edges.filter(e => validIds.has(e.source) && validIds.has(e.target) && e.source !== e.target);

  // Canvas dimensions
  const allPos = Object.values(positions);
  if (allPos.length === 0) {
    return { aspectRatio: 0, avgEdgeLength: 0, longEdgeRatio: 0, edgeCrossings: 0 };
  }
  const minX = Math.min(...allPos.map(p => p.x));
  const maxX = Math.max(...allPos.map(p => p.x)) + cardWidth;
  const minY = Math.min(...allPos.map(p => p.y));
  const maxY = Math.max(...allPos.map(p => p.y)) + cardHeight;
  const width = maxX - minX;
  const height = maxY - minY;
  const diagonal = Math.sqrt(width * width + height * height);

  // Edge lengths
  const edgeLengths = validEdges.map(e => {
    const s = positions[e.source], t = positions[e.target];
    return Math.sqrt((s.x - t.x) ** 2 + (s.y - t.y) ** 2);
  });
  const avgEdgeLength = edgeLengths.length > 0
    ? edgeLengths.reduce((a, b) => a + b, 0) / edgeLengths.length
    : 0;
  const longEdgeRatio = edgeLengths.length > 0
    ? edgeLengths.filter(l => l > diagonal * 0.3).length / edgeLengths.length
    : 0;

  // Edge crossings through node cards (approximate: does the edge line segment
  // intersect any node's bounding rect that isn't its own source/target?)
  let edgeCrossings = 0;
  for (const edge of validEdges) {
    const s = positions[edge.source];
    const t = positions[edge.target];
    for (const node of nodes) {
      if (node.id === edge.source || node.id === edge.target) continue;
      if (!validIds.has(node.id)) continue;
      const np = positions[node.id];
      // Check if line segment (s→t) intersects rect (np.x, np.y, cardWidth, cardHeight)
      if (lineIntersectsRect(s, t, np.x, np.y, cardWidth, cardHeight)) {
        edgeCrossings++;
      }
    }
  }

  return {
    aspectRatio: height > 0 ? width / height : 0,
    avgEdgeLength: Math.round(avgEdgeLength),
    longEdgeRatio: Math.round(longEdgeRatio * 100) / 100,
    edgeCrossings,
  };
}

// Line segment vs axis-aligned rect intersection test
function lineIntersectsRect(
  p1: Position, p2: Position,
  rx: number, ry: number, rw: number, rh: number,
): boolean {
  // Check if either endpoint is inside the rect
  if (p1.x >= rx && p1.x <= rx + rw && p1.y >= ry && p1.y <= ry + rh) return true;
  if (p2.x >= rx && p2.x <= rx + rw && p2.y >= ry && p2.y <= ry + rh) return true;

  // Check intersection with 4 rect edges
  const r1 = { x: rx, y: ry };           // top-left
  const r2 = { x: rx + rw, y: ry };       // top-right
  const r3 = { x: rx + rw, y: ry + rh };  // bottom-right
  const r4 = { x: rx, y: ry + rh };       // bottom-left

  return (
    segmentsIntersect(p1, p2, r1, r2) || // top
    segmentsIntersect(p1, p2, r2, r3) || // right
    segmentsIntersect(p1, p2, r3, r4) || // bottom
    segmentsIntersect(p1, p2, r4, r1)    // left
  );
}

function segmentsIntersect(a: Position, b: Position, c: Position, d: Position): boolean {
  const d1 = crossProduct(c, d, a);
  const d2 = crossProduct(c, d, b);
  const d3 = crossProduct(a, b, c);
  const d4 = crossProduct(a, b, d);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
      ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  return false;
}

function crossProduct(o: Position, a: Position, b: Position): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}
