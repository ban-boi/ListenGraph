export type SampleMetrics = {
  avgEdgeLength: number;
  overlapPairs: number;
  clearanceViolationPairs: number;
  pairCount: number;
  edgeEdgeCrossings: number;
  nodeCount: number;
  edgeCount: number;
};

export type Round5Summary = {
  shotsSkipped: boolean;
  sampleIndices: number[];
  largeIndices: number[];
  smallIndices: number[];
  stableMetrics: Record<number, SampleMetrics>;
  r3bMetrics: Record<number, SampleMetrics>;
  perf: { computeP95: number; reactCommitP95: number };
  sequenceOk: boolean;
};

// Perf 两级合同：target 超出只 warning，ceiling 超出才 fail。
// 阈值在此定义一次，round5-verify 不再自判（删 perf.ok，避免第二套冲突判断源）。
const PERF_TARGET = { computeMs: 200, reactCommitMs: 500 };
const PERF_CEILING = { computeMs: 400, reactCommitMs: 800 };

// 稀疏图(1-2 边) avgEdge 绝对上限：豁免相对 20% 后，用绝对值堵"两节点 5000px 通过"的洞。
const SPARSE_AVG_EDGE_MAX = 320;

export function evaluateRound5Gate(s: Round5Summary): {
  code: 0 | 1;
  failures: string[];
  warnings: string[];
} {
  const failures: string[] = [];
  const warnings: string[] = [];
  if (s.shotsSkipped) failures.push('screenshots skipped');
  if (!s.sequenceOk) failures.push('sequence incremental failed');

  // Perf 两级：target → warning，ceiling → failure
  if (s.perf.computeP95 > PERF_TARGET.computeMs) {
    warnings.push(`compute p95 ${s.perf.computeP95}ms > target ${PERF_TARGET.computeMs}ms`);
  }
  if (s.perf.reactCommitP95 > PERF_TARGET.reactCommitMs) {
    warnings.push(`react commit p95 ${s.perf.reactCommitP95}ms > target ${PERF_TARGET.reactCommitMs}ms`);
  }
  if (s.perf.computeP95 >= PERF_CEILING.computeMs) {
    failures.push(`compute p95 ${s.perf.computeP95}ms >= ceiling ${PERF_CEILING.computeMs}ms`);
  }
  if (s.perf.reactCommitP95 >= PERF_CEILING.reactCommitMs) {
    failures.push(`react commit p95 ${s.perf.reactCommitP95}ms >= ceiling ${PERF_CEILING.reactCommitMs}ms`);
  }

  const largeEdgeRatios = s.largeIndices.map((i) => {
    const st = s.stableMetrics[i]?.avgEdgeLength ?? 0;
    const r3 = s.r3bMetrics[i]?.avgEdgeLength ?? 0;
    return st > 0 ? (st - r3) / st : 0;
  });
  const median =
    largeEdgeRatios.length === 0
      ? 0
      : [...largeEdgeRatios].sort((a, b) => a - b)[Math.floor(largeEdgeRatios.length / 2)];
  if (median < 0.4) failures.push(`large-graph edge shorten median ${median} < 0.4`);

  // 小图桶：overlap 零容忍 + avgEdge 分边数处理
  for (const i of s.smallIndices) {
    const r3 = s.r3bMetrics[i];
    const st = s.stableMetrics[i];
    if (!r3 || !st) {
      failures.push(`missing small sample #${i}`);
      continue;
    }
    if (r3.overlapPairs !== 0) failures.push(`small #${i} overlapPairs=${r3.overlapPairs}`);
    // avgEdge 分边数：
    // - 0 边：不查边长（无意义）
    // - 1-2 边：不查相对 20%（无统计意义），但查绝对上限 320px（堵极端拉散）
    // - ≥3 边：查相对 stable 恶化 ≤20%
    if (r3.edgeCount >= 3) {
      if (st.avgEdgeLength > 0 && r3.avgEdgeLength > st.avgEdgeLength * 1.2) {
        failures.push(`small #${i} avgEdgeLength worsened >20% (edges=${r3.edgeCount})`);
      }
    } else if (r3.edgeCount > 0) {
      if (r3.avgEdgeLength > SPARSE_AVG_EDGE_MAX) {
        failures.push(`small #${i} sparse avgEdgeLength ${r3.avgEdgeLength} > ${SPARSE_AVG_EDGE_MAX} (edges=${r3.edgeCount})`);
      }
    }
  }

  // 全样本：overlap 零容忍（从 small-only 提升到全部 23 个）+ clearance + crossings
  for (const i of s.sampleIndices) {
    const r3 = s.r3bMetrics[i];
    const st = s.stableMetrics[i];
    if (!r3 || !st) {
      failures.push(`missing sample #${i}`);
      continue;
    }
    if (r3.overlapPairs !== 0) failures.push(`#${i} overlapPairs=${r3.overlapPairs} (全样本零容忍)`);
    const residual = r3.pairCount > 0 ? r3.clearanceViolationPairs / r3.pairCount : 0;
    if (residual > 0.05) failures.push(`#${i} clearance residual ${residual} > 5%`);
    if (st.edgeEdgeCrossings > 0 && r3.edgeEdgeCrossings > st.edgeEdgeCrossings * 1.15) {
      failures.push(`#${i} edgeEdgeCrossings worsened >15%`);
    }
  }

  return { code: failures.length ? 1 : 0, failures, warnings };
}
