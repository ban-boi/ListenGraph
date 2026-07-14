export type SampleMetrics = {
  avgEdgeLength: number;
  overlapPairs: number;
  clearanceViolationPairs: number;
  pairCount: number;
  edgeEdgeCrossings: number;
  nodeCount: number;
};

export type Round5Summary = {
  shotsSkipped: boolean;
  sampleIndices: number[];
  largeIndices: number[];
  smallIndices: number[];
  stableMetrics: Record<number, SampleMetrics>;
  r3bMetrics: Record<number, SampleMetrics>;
  perf: { computeP95: number; reactCommitP95: number; ok: boolean };
  sequenceOk: boolean;
};

export function evaluateRound5Gate(s: Round5Summary): { code: 0 | 1; failures: string[] } {
  const failures: string[] = [];
  if (s.shotsSkipped) failures.push('screenshots skipped');
  if (!s.sequenceOk) failures.push('sequence incremental failed');
  if (!s.perf.ok || s.perf.computeP95 >= 200) {
    failures.push(`compute p95 ${s.perf.computeP95}ms >= 200ms`);
  }
  if (s.perf.reactCommitP95 >= 500) {
    failures.push(`react commit p95 ${s.perf.reactCommitP95}ms >= 500ms`);
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

  for (const i of s.smallIndices) {
    const r3 = s.r3bMetrics[i];
    const st = s.stableMetrics[i];
    if (!r3 || !st) {
      failures.push(`missing small sample #${i}`);
      continue;
    }
    if (r3.overlapPairs !== 0) failures.push(`small #${i} overlapPairs=${r3.overlapPairs}`);
    if (st.avgEdgeLength > 0 && r3.avgEdgeLength > st.avgEdgeLength * 1.2) {
      failures.push(`small #${i} avgEdgeLength worsened >20%`);
    }
  }

  for (const i of s.sampleIndices) {
    const r3 = s.r3bMetrics[i];
    const st = s.stableMetrics[i];
    if (!r3 || !st) {
      failures.push(`missing sample #${i}`);
      continue;
    }
    const residual = r3.pairCount > 0 ? r3.clearanceViolationPairs / r3.pairCount : 0;
    if (residual > 0.05) failures.push(`#${i} clearance residual ${residual} > 5%`);
    if (st.edgeEdgeCrossings > 0 && r3.edgeEdgeCrossings > st.edgeEdgeCrossings * 1.15) {
      failures.push(`#${i} edgeEdgeCrossings worsened >15%`);
    }
  }

  return { code: failures.length ? 1 : 0, failures };
}
