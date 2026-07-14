import { describe, expect, it } from 'vitest';
import { evaluateRound5Gate, type Round5Summary } from './round5-gates';

const base: Round5Summary = {
  shotsSkipped: false,
  sampleIndices: [49, 18],
  largeIndices: [49],
  smallIndices: [18],
  stableMetrics: {
    49: { avgEdgeLength: 1000, overlapPairs: 0, clearanceViolationPairs: 0, pairCount: 100, edgeEdgeCrossings: 10, nodeCount: 271 },
    18: { avgEdgeLength: 100, overlapPairs: 0, clearanceViolationPairs: 0, pairCount: 28, edgeEdgeCrossings: 0, nodeCount: 8 },
  },
  r3bMetrics: {
    49: { avgEdgeLength: 500, overlapPairs: 0, clearanceViolationPairs: 2, pairCount: 100, edgeEdgeCrossings: 11, nodeCount: 271 },
    18: { avgEdgeLength: 110, overlapPairs: 0, clearanceViolationPairs: 0, pairCount: 28, edgeEdgeCrossings: 0, nodeCount: 8 },
  },
  perf: { computeP95: 100, reactCommitP95: 200, ok: true },
  sequenceOk: true,
};

describe('evaluateRound5Gate', () => {
  it('shotsSkipped → fail', () => {
    const r = evaluateRound5Gate({ ...base, shotsSkipped: true });
    expect(r.code).toBe(1);
    expect(r.failures.some((f) => /shot/i.test(f))).toBe(true);
  });

  it('perf 超标 → fail', () => {
    const r = evaluateRound5Gate({
      ...base,
      perf: { computeP95: 250, reactCommitP95: 200, ok: false },
    });
    expect(r.code).toBe(1);
  });

  it('全绿 → pass', () => {
    expect(evaluateRound5Gate(base).code).toBe(0);
  });
});
