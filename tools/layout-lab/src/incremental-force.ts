import type { MergedGraph, GraphNode, GraphEdge, EdgeType } from '@listen-graphic/schema';
import { partitionClusters } from './cluster-partition';
import type { CenterPos } from './force-core-v2';
import {
  computeAllNodeSizes, FORCE_PARAMS, PENALTY_STRENGTH, GRAVITY_STRENGTH, TARGET_WIDTH,
  type NodeSize,
} from './round3-types';
import {
  computePinK, computeMaxDrift, computeOldMobility, stableHash,
  matchClusters,
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
  variant: 'R3a' | 'R3b' = 'R3b',
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
  // 硬固定模式：增量时旧节点完全跳过力迭代（0px 移动），只对新节点算力
  for (const cluster of partition.clusters) {
    const clusterNodeIds = new Set(cluster.nodeIds);

    // 增量模式下：forceNodes 只含新节点；旧节点作为"固定障碍物"参与斥力但不接受力
    const forceNodes = isFirstRevision
      ? graph.nodes.filter((n) => clusterNodeIds.has(n.id))
      : graph.nodes.filter((n) => clusterNodeIds.has(n.id) && !isOldNode(n.id));

    if (forceNodes.length === 0) continue; // 全是旧节点，跳过

    const clusterAllNodes = graph.nodes.filter((n) => clusterNodeIds.has(n.id)); // 含旧节点（作为斥力源）
    const clusterEdges = graph.edges.filter(
      (e) => clusterNodeIds.has(e.source) && clusterNodeIds.has(e.target) && e.source !== e.target,
    );
    const edgeList: Array<{ source: string; target: string }> = [];
    for (const e of clusterEdges) {
      if (STRUCTURAL_TYPES.has(e.type)) edgeList.push({ source: e.source, target: e.target });
    }

    for (let iter = 0; iter < ITERATIONS; iter++) {
      const forces: Record<string, { x: number; y: number }> = {};
      for (const n of forceNodes) forces[n.id] = { x: 0, y: 0 };

      if (isFirstRevision) {
        // 第一个 revision：对称斥力（和 R3b full-recompute 一致）
        for (let i = 0; i < forceNodes.length; i++) {
          for (let j = i + 1; j < forceNodes.length; j++) {
            const a = forceNodes[i], b = forceNodes[j];
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
      } else {
        // 增量：新节点 vs 所有节点（旧节点作为固定障碍物，不对称）
        for (const fn of forceNodes) {
          for (const other of clusterAllNodes) {
            if (fn.id === other.id) continue;
            const dx = positions[fn.id].cx - positions[other.id].cx;
            const dy = positions[fn.id].cy - positions[other.id].cy;
            let dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < 1) dist = 1;
            const areaA = allSizes[fn.id].width * allSizes[fn.id].height;
            const areaB = allSizes[other.id].width * allSizes[other.id].height;
            const repulsion = REPULSION_K * Math.sqrt(areaA * areaB) / (dist * dist);
            forces[fn.id].x += (dx / dist) * repulsion;
            forces[fn.id].y += (dy / dist) * repulsion;
          }
        }
      }

      // Spring
      for (const edge of edgeList) {
        const dx = positions[edge.target].cx - positions[edge.source].cx;
        const dy = positions[edge.target].cy - positions[edge.source].cy;
        let dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 1) dist = 1;
        const force = SPRING_K * (dist - SPRING_LENGTH);

        if (isFirstRevision) {
          // 第一个 revision：对称施加（和 full 一致）
          forces[edge.source].x += (dx / dist) * force;
          forces[edge.source].y += (dy / dist) * force;
          forces[edge.target].x -= (dx / dist) * force;
          forces[edge.target].y -= (dy / dist) * force;
        } else {
          // 增量：只给新节点施加力
          const isNewSource = !isOldNode(edge.source);
          const isNewTarget = !isOldNode(edge.target);
          if (!isNewSource && !isNewTarget) continue;
          if (isNewSource) {
            forces[edge.source].x += (dx / dist) * force;
            forces[edge.source].y += (dy / dist) * force;
          }
          if (isNewTarget) {
            forces[edge.target].x -= (dx / dist) * force;
            forces[edge.target].y -= (dy / dist) * force;
          }
        }
      }

      // 竖向约束力：R3a 引力收窄 / R3b 宽度惩罚
      if (variant === 'R3a') {
        const centerX = TARGET_WIDTH / 2;
        for (const n of forceNodes) {
          forces[n.id].x += (centerX - positions[n.id].cx) * GRAVITY_STRENGTH;
        }
      } else {
        for (const n of forceNodes) {
          const w = allSizes[n.id].width;
          const cx = positions[n.id].cx;
          const leftOvershoot = Math.max(0, w / 2 - cx);
          const rightOvershoot = Math.max(0, cx + w / 2 - TARGET_WIDTH);
          forces[n.id].x += leftOvershoot * PENALTY_STRENGTH - rightOvershoot * PENALTY_STRENGTH;
        }
      }

      // Apply + damping（只对新节点）
      for (const n of forceNodes) {
        velocities[n.id].x = (velocities[n.id].x + forces[n.id].x) * DAMPING;
        velocities[n.id].y = (velocities[n.id].y + forces[n.id].y) * DAMPING;
        positions[n.id].cx += Math.max(-MAX_DISPLACEMENT, Math.min(MAX_DISPLACEMENT, velocities[n.id].x));
        positions[n.id].cy += Math.max(-MAX_DISPLACEMENT, Math.min(MAX_DISPLACEMENT, velocities[n.id].y));
      }
    }
  }

  // Displacement stats（硬固定模式：旧节点位移应全为 0，除非碰撞消除微调）
  let stats: DisplacementStats | null = null;
  if (!isFirstRevision) {
    const displacements: number[] = [];
    for (const n of graph.nodes) {
      if (oldNodeIds.has(n.id) && prevState.positions[n.id]) {
        const dx = positions[n.id].cx - prevState.positions[n.id].cx;
        const dy = positions[n.id].cy - prevState.positions[n.id].cy;
        displacements.push(Math.hypot(dx, dy));
      }
    }
    displacements.sort((a, b) => a - b);
    const mid = Math.floor(displacements.length / 2);
    const movedNodes = displacements.filter((d) => d > 0.5).length;
    stats = {
      medianDisplacement: Math.round(displacements.length > 0 ? displacements[mid] : 0),
      maxDisplacement: Math.round(displacements.length > 0 ? displacements[displacements.length - 1] : 0),
      capHitRate: displacements.length > 0 ? movedNodes / displacements.length : 0,
      oldNodeCount: displacements.length,
    };
  }

  // Mobility-aware overlap resolution：旧节点 mobility=0（完全不动），新节点承担全部位移
  const mobilities: Record<string, number> = {};
  for (const n of graph.nodes) {
    mobilities[n.id] = isFirstRevision ? 1.0 : (isOldNode(n.id) ? 0.0 : 1.0);
  }
  resolveOverlapsWithMobility(positions, allSizes, mobilities, FORCE_PARAMS.OVERLAP_ROUNDS);

  // Cluster 匹配 + clusterOrigins 继承（spec 4.3.1 + 4.6）
  const newClusters = partition.clusters.map((c) => ({ id: c.id, nodeIds: c.nodeIds, type: c.type as 'major' | 'minor' }));
  const clusterOrigins: Record<string, { x: number; y: number }> = {};

  if (!isFirstRevision) {
    const matches = matchClusters(
      newClusters.map((c) => ({ id: c.id, nodeIds: c.nodeIds })),
      prevState.prevClusters,
    );
    for (const m of matches) {
      if (m.isNew) {
        // 新 cluster：用其节点的最小坐标作为 origin
        const clusterNodeIds = newClusters.find((c) => c.id === m.newClusterId)?.nodeIds ?? [];
        const xs = clusterNodeIds.map((id) => positions[id]?.cx ?? 0);
        const ys = clusterNodeIds.map((id) => positions[id]?.cy ?? 0);
        clusterOrigins[m.newClusterId] = {
          x: xs.length > 0 ? Math.min(...xs) : 0,
          y: ys.length > 0 ? Math.min(...ys) : 0,
        };
      } else if (m.predecessorIds.length === 1) {
        // 继承：从父 cluster 继承 origin
        const parentId = m.predecessorIds[0];
        clusterOrigins[m.newClusterId] = prevState.clusterOrigins[parentId] ?? { x: 0, y: 0 };
      } else {
        // Merge：取所有父 cluster origins 的平均
        const parentOrigins = m.predecessorIds
          .map((pid) => prevState.clusterOrigins[pid])
          .filter(Boolean) as Array<{ x: number; y: number }>;
        if (parentOrigins.length > 0) {
          clusterOrigins[m.newClusterId] = {
            x: parentOrigins.reduce((s, o) => s + o.x, 0) / parentOrigins.length,
            y: parentOrigins.reduce((s, o) => s + o.y, 0) / parentOrigins.length,
          };
        }
      }
    }
  }

  const newState: IncrementalState = {
    positions: { ...positions },
    sizes: allSizes,
    clusterOrigins,
    prevClusters: newClusters,
  };

  return {
    state: newState,
    positions,
    stats,
    clusters: newClusters,
  };
}

function resolveOverlapsWithMobility(
  positions: Record<string, CenterPos>,
  sizes: Record<string, NodeSize>,
  mobilities: Record<string, number>,
  rounds: number,
  padding: number = 16,
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
        // 带 padding 的 penetration（与 force-core-v2 一致）
        const penX = (sa.width + sb.width) / 2 + padding - Math.abs(dx);
        const penY = (sa.height + sb.height) / 2 + padding - Math.abs(dy);
        if (penX <= 0 || penY <= 0) continue;
        anyOverlap = true;
        const ma = mobilities[a] ?? 1.0;
        const mb = mobilities[b] ?? 1.0;
        const totalMob = ma + mb;
        const ratioA = totalMob > 0 ? ma / totalMob : 0.5;
        const ratioB = totalMob > 0 ? mb / totalMob : 0.5;

        // 沿较小 penetration 轴推开
        if (penX < penY) {
          let dir: number;
          if (dx === 0) { dir = a < b ? -1 : 1; }
          else { dir = dx > 0 ? 1 : -1; }
          positions[a].cx += dir * penX * ratioA;
          positions[b].cx -= dir * penX * ratioB;
        } else {
          let dir: number;
          if (dy === 0) { dir = a < b ? -1 : 1; }
          else { dir = dy > 0 ? 1 : -1; }
          positions[a].cy += dir * penY * ratioA;
          positions[b].cy -= dir * penY * ratioB;
        }
      }
    }
    if (!anyOverlap) break;
  }
}
