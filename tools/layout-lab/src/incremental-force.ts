import type { MergedGraph, GraphNode, GraphEdge, EdgeType } from '@listen-graphic/schema';
import { partitionClusters } from './cluster-partition';
import type { CenterPos } from './force-core-v2';
import {
  computeAllNodeSizes, FORCE_PARAMS, PENALTY_STRENGTH, TARGET_WIDTH,
  type NodeSize,
} from './round3-types';
import {
  computePinK, computeMaxDrift, computeOldMobility, stableHash,
  type IncrementalState,
} from './incremental-types';

const STRUCTURAL_TYPES = new Set<EdgeType>(['causes', 'supports', 'example_of', 'follows', 'opposes']);

export type DisplacementStats = {
  medianDisplacement: number;
  maxDisplacement: number;
  capHitRate: number;
  oldNodeCount: number;
};

export type IncrementalResult = {
  state: IncrementalState;
  positions: Record<string, CenterPos>;
  stats: DisplacementStats | null;
  clusters: Array<{ id: string; nodeIds: string[]; type: 'major' | 'minor' }>;
};

function initNewNode(
  nodeId: string,
  edges: GraphEdge[],
  positions: Record<string, CenterPos>,
): CenterPos {
  const neighbors = edges
    .filter((e) => e.source === nodeId || e.target === nodeId)
    .map((e) => (e.source === nodeId ? e.target : e.source))
    .filter((id) => positions[id]);

  if (neighbors.length > 0) {
    const cx = neighbors.reduce((s, id) => s + positions[id].cx, 0) / neighbors.length;
    const cy = neighbors.reduce((s, id) => s + positions[id].cy, 0) / neighbors.length;
    const angle = (stableHash(nodeId) * Math.PI) / 180;
    return {
      cx: cx + Math.cos(angle) * FORCE_PARAMS.SPRING_LENGTH,
      cy: cy + Math.sin(angle) * FORCE_PARAMS.SPRING_LENGTH,
    };
  }
  const allY = Object.values(positions).map((p) => p.cy);
  const maxY = allY.length > 0 ? Math.max(...allY) : 0;
  return { cx: TARGET_WIDTH / 2, cy: maxY + 200 };
}

export function computeIncrementalLayout(
  graph: MergedGraph,
  prevState: IncrementalState,
): IncrementalResult {
  const partition = partitionClusters(graph);
  const allSizes = computeAllNodeSizes(graph.nodes);
  const isFirstRevision = Object.keys(prevState.positions).length === 0;
  const oldNodeIds = new Set(Object.keys(prevState.positions));

  // Initialize positions
  const positions: Record<string, CenterPos> = {};

  if (isFirstRevision) {
    const radius = Math.max(200, graph.nodes.length * 15);
    graph.nodes.forEach((n, i) => {
      const angle = (i / graph.nodes.length) * Math.PI * 2;
      positions[n.id] = {
        cx: Math.cos(angle) * radius + (i % 3) * 10,
        cy: Math.sin(angle) * radius + (i % 3) * 10,
      };
    });
  } else {
    for (const n of graph.nodes) {
      if (prevState.positions[n.id]) {
        positions[n.id] = { ...prevState.positions[n.id] };
      }
    }
    for (const n of graph.nodes) {
      if (!positions[n.id]) {
        positions[n.id] = initNewNode(n.id, graph.edges, positions);
      }
    }
  }

  const isOldNode = (id: string) => !isFirstRevision && oldNodeIds.has(id);
  const { REPULSION_K, SPRING_LENGTH, SPRING_K, DAMPING, MAX_DISPLACEMENT, ITERATIONS } = FORCE_PARAMS;
  const velocities: Record<string, { x: number; y: number }> = {};
  for (const n of graph.nodes) velocities[n.id] = { x: 0, y: 0 };

  // Per-cluster force simulation
  for (const cluster of partition.clusters) {
    const clusterNodeIds = new Set(cluster.nodeIds);
    const clusterNodes = graph.nodes.filter((n) => clusterNodeIds.has(n.id));
    const clusterEdges = graph.edges.filter(
      (e) => clusterNodeIds.has(e.source) && clusterNodeIds.has(e.target) && e.source !== e.target,
    );
    const edgeList: Array<{ source: string; target: string }> = [];
    for (const e of clusterEdges) {
      if (STRUCTURAL_TYPES.has(e.type)) edgeList.push({ source: e.source, target: e.target });
    }

    let pinK = 0, maxDrift = 0;
    if (!isFirstRevision && cluster.type === 'major') {
      const oldInCluster = cluster.nodeIds.filter(isOldNode);
      const newInCluster = cluster.nodeIds.filter((id) => !isOldNode(id));
      const affectedOld = new Set<string>();
      for (const e of clusterEdges) {
        if (newInCluster.includes(e.source) && oldInCluster.includes(e.target)) affectedOld.add(e.target);
        if (newInCluster.includes(e.target) && oldInCluster.includes(e.source)) affectedOld.add(e.source);
      }
      const r = (newInCluster.length + 0.5 * affectedOld.size) / Math.max(1, oldInCluster.length);
      pinK = computePinK(r);
      maxDrift = computeMaxDrift(r);
    }

    for (let iter = 0; iter < ITERATIONS; iter++) {
      const forces: Record<string, { x: number; y: number }> = {};
      for (const n of clusterNodes) forces[n.id] = { x: 0, y: 0 };

      // Area repulsion
      for (let i = 0; i < clusterNodes.length; i++) {
        for (let j = i + 1; j < clusterNodes.length; j++) {
          const a = clusterNodes[i], b = clusterNodes[j];
          const dx = positions[a.id].cx - positions[b.id].cx;
          const dy = positions[a.id].cy - positions[b.id].cy;
          let dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 1) dist = 1;
          const areaA = allSizes[a.id].width * allSizes[a.id].height;
          const areaB = allSizes[b.id].width * allSizes[b.id].height;
          const repulsion = REPULSION_K * Math.sqrt(areaA * areaB) / (dist * dist);
          forces[a.id].x += (dx / dist) * repulsion;
          forces[a.id].y += (dy / dist) * repulsion;
          forces[b.id].x -= (dx / dist) * repulsion;
          forces[b.id].y -= (dy / dist) * repulsion;
        }
      }

      // Spring
      for (const edge of edgeList) {
        const dx = positions[edge.target].cx - positions[edge.source].cx;
        const dy = positions[edge.target].cy - positions[edge.source].cy;
        let dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 1) dist = 1;
        const force = SPRING_K * (dist - SPRING_LENGTH);
        forces[edge.source].x += (dx / dist) * force;
        forces[edge.source].y += (dy / dist) * force;
        forces[edge.target].x -= (dx / dist) * force;
        forces[edge.target].y -= (dy / dist) * force;
      }

      // Width penalty (R3b)
      for (const n of clusterNodes) {
        const w = allSizes[n.id].width;
        const cx = positions[n.id].cx;
        const leftOvershoot = Math.max(0, w / 2 - cx);
        const rightOvershoot = Math.max(0, cx + w / 2 - TARGET_WIDTH);
        forces[n.id].x += leftOvershoot * PENALTY_STRENGTH - rightOvershoot * PENALTY_STRENGTH;
      }

      // Pin spring (old nodes only)
      if (!isFirstRevision && pinK > 0) {
        for (const n of clusterNodes) {
          if (isOldNode(n.id) && prevState.positions[n.id]) {
            const anchor = prevState.positions[n.id];
            forces[n.id].x += pinK * (anchor.cx - positions[n.id].cx);
            forces[n.id].y += pinK * (anchor.cy - positions[n.id].cy);
          }
        }
      }

      // Apply + damping
      for (const n of clusterNodes) {
        velocities[n.id].x = (velocities[n.id].x + forces[n.id].x) * DAMPING;
        velocities[n.id].y = (velocities[n.id].y + forces[n.id].y) * DAMPING;
        positions[n.id].cx += Math.max(-MAX_DISPLACEMENT, Math.min(MAX_DISPLACEMENT, velocities[n.id].x));
        positions[n.id].cy += Math.max(-MAX_DISPLACEMENT, Math.min(MAX_DISPLACEMENT, velocities[n.id].y));
      }

      // Drift clamp (old nodes)
      if (!isFirstRevision && maxDrift > 0) {
        for (const n of clusterNodes) {
          if (isOldNode(n.id) && prevState.positions[n.id]) {
            const anchor = prevState.positions[n.id];
            const dx = positions[n.id].cx - anchor.cx;
            const dy = positions[n.id].cy - anchor.cy;
            const distance = Math.hypot(dx, dy);
            if (distance > maxDrift) {
              const scale = maxDrift / distance;
              positions[n.id].cx = anchor.cx + dx * scale;
              positions[n.id].cy = anchor.cy + dy * scale;
              velocities[n.id].x *= 0.25;
              velocities[n.id].y *= 0.25;
            }
          }
        }
      }
    }
  }

  // Displacement stats
  let stats: DisplacementStats | null = null;
  const capHitNodes = new Set<string>();
  if (!isFirstRevision) {
    const displacements: number[] = [];
    for (const n of graph.nodes) {
      if (oldNodeIds.has(n.id) && prevState.positions[n.id]) {
        const dx = positions[n.id].cx - prevState.positions[n.id].cx;
        const dy = positions[n.id].cy - prevState.positions[n.id].cy;
        const dist = Math.hypot(dx, dy);
        displacements.push(dist);
        if (dist >= 99) capHitNodes.add(n.id);
      }
    }
    displacements.sort((a, b) => a - b);
    const mid = Math.floor(displacements.length / 2);
    stats = {
      medianDisplacement: Math.round(displacements.length > 0 ? displacements[mid] : 0),
      maxDisplacement: Math.round(displacements.length > 0 ? displacements[displacements.length - 1] : 0),
      capHitRate: displacements.length > 0 ? capHitNodes.size / displacements.length : 0,
      oldNodeCount: displacements.length,
    };
  }

  // Mobility-aware overlap resolution
  const mobilities: Record<string, number> = {};
  for (const n of graph.nodes) {
    mobilities[n.id] = isFirstRevision ? 1.0 : (isOldNode(n.id) ? 0.4 : 1.0);
  }
  resolveOverlapsWithMobility(positions, allSizes, mobilities, FORCE_PARAMS.OVERLAP_ROUNDS);

  const newState: IncrementalState = {
    positions: { ...positions },
    sizes: allSizes,
    clusterOrigins: {},
    prevClusters: partition.clusters.map((c) => ({ id: c.id, nodeIds: c.nodeIds, type: c.type })),
  };

  return {
    state: newState,
    positions,
    stats,
    clusters: partition.clusters.map((c) => ({ id: c.id, nodeIds: c.nodeIds, type: c.type })),
  };
}

function resolveOverlapsWithMobility(
  positions: Record<string, CenterPos>,
  sizes: Record<string, NodeSize>,
  mobilities: Record<string, number>,
  rounds: number,
): void {
  const ids = Object.keys(positions).sort();
  for (let r = 0; r < rounds; r++) {
    let anyOverlap = false;
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = ids[i], b = ids[j];
        if (!positions[a] || !positions[b] || !sizes[a] || !sizes[b]) continue;
        const sa = sizes[a], sb = sizes[b];
        const dx = positions[a].cx - positions[b].cx;
        const dy = positions[a].cy - positions[b].cy;
        const overlapX = (sa.width + sb.width) / 2 - Math.abs(dx);
        const overlapY = (sa.height + sb.height) / 2 - Math.abs(dy);
        if (overlapX <= 0 || overlapY <= 0) continue;
        anyOverlap = true;
        const ma = mobilities[a] ?? 1.0;
        const mb = mobilities[b] ?? 1.0;
        const totalMob = ma + mb;
        const ratioA = totalMob > 0 ? ma / totalMob : 0.5;
        const ratioB = totalMob > 0 ? mb / totalMob : 0.5;

        if (overlapX < overlapY) {
          let dir: number;
          if (dx === 0) { dir = a < b ? -1 : 1; }
          else { dir = dx > 0 ? 1 : -1; }
          positions[a].cx += dir * overlapX * ratioA;
          positions[b].cx -= dir * overlapX * ratioB;
        } else {
          let dir: number;
          if (dy === 0) { dir = a < b ? -1 : 1; }
          else { dir = dy > 0 ? 1 : -1; }
          positions[a].cy += dir * overlapY * ratioA;
          positions[b].cy -= dir * overlapY * ratioB;
        }
      }
    }
    if (!anyOverlap) break;
  }
}
