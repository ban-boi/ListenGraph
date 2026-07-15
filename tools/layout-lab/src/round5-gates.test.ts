import { describe, expect, it } from 'vitest';
import { evaluateRound5Gate, type Round5Summary } from './round5-gates';

const base: Round5Summary = {
  shotsSkipped: false,
  sampleIndices: [49, 18],
  largeIndices: [49],
  smallIndices: [18],
  stableMetrics: {
    49: { avgEdgeLength: 1000, overlapPairs: 0, clearanceViolationPairs: 0, pairCount: 100, edgeEdgeCrossings: 10, nodeCount: 271, edgeCount: 255 },
    18: { avgEdgeLength: 100, overlapPairs: 0, clearanceViolationPairs: 0, pairCount: 28, edgeEdgeCrossings: 0, nodeCount: 8, edgeCount: 7 },
  },
  r3bMetrics: {
    49: { avgEdgeLength: 500, overlapPairs: 0, clearanceViolationPairs: 2, pairCount: 100, edgeEdgeCrossings: 11, nodeCount: 271, edgeCount: 255 },
    18: { avgEdgeLength: 110, overlapPairs: 0, clearanceViolationPairs: 0, pairCount: 28, edgeEdgeCrossings: 0, nodeCount: 8, edgeCount: 7 },
  },
  perf: { computeP95: 100, reactCommitP95: 200 },
  sequenceOk: true,
};

describe('evaluateRound5Gate', () => {
  it('shotsSkipped → fail', () => {
    const r = evaluateRound5Gate({ ...base, shotsSkipped: true });
    expect(r.code).toBe(1);
    expect(r.failures.some((f) => /shot/i.test(f))).toBe(true);
  });

  it('perf 超 target 但 < ceiling → warning 不 fail', () => {
    // 270ms compute > target(200) 但 < ceiling(400) → warning，code=0
    const r = evaluateRound5Gate({
      ...base,
      perf: { computeP95: 270, reactCommitP95: 642 },
    });
    expect(r.code).toBe(0);
    expect(r.warnings.some((w) => /compute p95.*target/.test(w))).toBe(true);
    expect(r.warnings.some((w) => /react commit.*target/.test(w))).toBe(true);
  });

  it('perf 超 ceiling → fail', () => {
    const r = evaluateRound5Gate({
      ...base,
      perf: { computeP95: 450, reactCommitP95: 200 },
    });
    expect(r.code).toBe(1);
    expect(r.failures.some((f) => /compute p95.*ceiling/.test(f))).toBe(true);
  });

  it('全绿 → pass', () => {
    expect(evaluateRound5Gate(base).code).toBe(0);
  });

  it('小图 avgEdge 恶化但边数 <3(极端 case 如 2节点1边)→ 豁免 pass', () => {
    // 模拟 #12：stable avgEdge=168 → r3b=244（+45% 恶化），但只有 1 条边。
    // avgEdge 此时就是单根线长度，无统计意义，不触发恶化门。
    const r = evaluateRound5Gate({
      ...base,
      smallIndices: [12],
      stableMetrics: { ...base.stableMetrics, 12: { avgEdgeLength: 168, overlapPairs: 0, clearanceViolationPairs: 0, pairCount: 1, edgeEdgeCrossings: 0, nodeCount: 2, edgeCount: 1 } },
      r3bMetrics: { ...base.r3bMetrics, 12: { avgEdgeLength: 244, overlapPairs: 0, clearanceViolationPairs: 0, pairCount: 1, edgeEdgeCrossings: 0, nodeCount: 2, edgeCount: 1 } },
    });
    expect(r.code).toBe(0);
    expect(r.failures.some((f) => /avgEdgeLength worsened/.test(f))).toBe(false);
  });

  it('小图 avgEdge 恶化且边数 ≥3 → 仍 fail', () => {
    // 确认豁免只对边数太少生效：边数够时恶化仍触发。
    const r = evaluateRound5Gate({
      ...base,
      smallIndices: [18],
      r3bMetrics: { ...base.r3bMetrics, 18: { avgEdgeLength: 200, overlapPairs: 0, clearanceViolationPairs: 0, pairCount: 28, edgeEdgeCrossings: 0, nodeCount: 8, edgeCount: 7 } },
    });
    // stable #18 avgEdge=100, r3b=200 (+100% > 20%), edgeCount=7 ≥3 → 应触发
    expect(r.code).toBe(1);
    expect(r.failures.some((f) => /avgEdgeLength worsened/.test(f))).toBe(true);
  });

  it('稀疏图(1边) avgEdge 超 320 绝对上限 → fail', () => {
    // 两节点一线相距 5000px：豁免相对 20%，但被绝对上限 320 堵住。
    const r = evaluateRound5Gate({
      ...base,
      smallIndices: [12],
      stableMetrics: { ...base.stableMetrics, 12: { avgEdgeLength: 100, overlapPairs: 0, clearanceViolationPairs: 0, pairCount: 1, edgeEdgeCrossings: 0, nodeCount: 2, edgeCount: 1 } },
      r3bMetrics: { ...base.r3bMetrics, 12: { avgEdgeLength: 5000, overlapPairs: 0, clearanceViolationPairs: 0, pairCount: 1, edgeEdgeCrossings: 0, nodeCount: 2, edgeCount: 1 } },
    });
    expect(r.code).toBe(1);
    expect(r.failures.some((f) => /sparse avgEdgeLength/.test(f))).toBe(true);
  });

  it('overlap 全样本零容忍：大图 overlap>0 → fail', () => {
    // 确认 overlap 检查不只针对 small：大图(#49) overlap 也会 fail。
    const r = evaluateRound5Gate({
      ...base,
      r3bMetrics: { ...base.r3bMetrics, 49: { ...base.r3bMetrics[49], overlapPairs: 3 } },
    });
    expect(r.code).toBe(1);
    expect(r.failures.some((f) => /#49 overlapPairs=3.*全样本/.test(f))).toBe(true);
  });
});
