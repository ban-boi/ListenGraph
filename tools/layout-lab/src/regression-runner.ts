/**
 * 回归执行器。
 * 运行布局算法、检查硬约束、检查软指标退化、生成报告、控制退出码。
 */
import type { SoftBaselines, RegressionCase } from '../../../packages/graph-fixtures/src/types';

import type { LayoutEngineAdapter } from './layout-engine-adapter';
import { centerToTopLeft, computeLayoutQuality } from './layout-metrics-v2';

export type HardConstraintResult = {
  name: string;
  expected: number | boolean;
  actual: number | boolean;
  passed: boolean;
};

export type SoftMetricResult = {
  name: keyof SoftBaselines;
  baseline: number;
  actual: number;
  degradation: number;
  budget: number;
  passed: boolean;
};

export type RegressionCaseResult = {
  caseId: string;
  split: string;
  status: string;
  passed: boolean;
  reason?: string;
  hardResults: HardConstraintResult[];
  softResults: SoftMetricResult[];
};

export type RegressionSuiteResult = {
  totalCases: number;
  passedCases: number;
  failedCases: number;
  skippedCases: number;
  results: RegressionCaseResult[];
  passRateBySplit: Record<string, { passed: number; total: number; skipped: number }>;
};

/**
 * 运行单个回归 case。
 * candidate 状态的 case 必须失败（证明期望有意义）。
 * baselined 状态的 case 检查硬约束 + 软指标退化。
 */
export function runRegressionCase(
  testCase: RegressionCase,
  adapter: LayoutEngineAdapter,
): RegressionCaseResult {
  if (testCase.status === 'candidate') {
    return {
      caseId: testCase.id,
      split: testCase.split,
      status: testCase.status,
      passed: false,
      reason: 'candidate case must fail first (run accept-baseline after algorithm fix)',
      hardResults: [],
      softResults: [],
    };
  }

  const result = adapter.computeLayout(testCase.graph);
  const positions = centerToTopLeft(result.positions, result.sizes);
  const edges = testCase.graph.edges.map((e) => ({ source: e.source, target: e.target }));
  const metrics = computeLayoutQuality(edges, positions, result.sizes, {
    clearanceThreshold: testCase.hardExpectations.minClearancePx ?? 16,
  });

  const hardResults: HardConstraintResult[] = [];
  const he = testCase.hardExpectations;

  hardResults.push({
    name: 'physicalOverlapPairs',
    expected: he.physicalOverlapPairs,
    actual: metrics.hard.physicalOverlapPairs,
    passed: metrics.hard.physicalOverlapPairs <= he.physicalOverlapPairs,
  });
  hardResults.push({
    name: 'clearanceViolationPairs',
    expected: he.clearanceViolationPairs,
    actual: metrics.hard.clearanceViolationPairs,
    passed: metrics.hard.clearanceViolationPairs <= he.clearanceViolationPairs,
  });
  hardResults.push({
    name: 'coordinateValidity',
    expected: true,
    actual: metrics.hard.coordinateValidity,
    passed: metrics.hard.coordinateValidity === true,
  });

  if (he.maxCanvasWidthPx !== undefined) {
    hardResults.push({
      name: 'maxCanvasWidthPx',
      expected: he.maxCanvasWidthPx,
      actual: metrics.soft.canvasWidth,
      passed: metrics.soft.canvasWidth <= he.maxCanvasWidthPx,
    });
  }
  if (he.maxAspectRatio !== undefined) {
    hardResults.push({
      name: 'maxAspectRatio',
      expected: he.maxAspectRatio,
      actual: metrics.soft.aspectRatio,
      passed: metrics.soft.aspectRatio <= he.maxAspectRatio,
    });
  }
  if (he.maxP95EdgeLength !== undefined) {
    hardResults.push({
      name: 'maxP95EdgeLength',
      expected: he.maxP95EdgeLength,
      actual: metrics.soft.p95EdgeLength,
      passed: metrics.soft.p95EdgeLength <= he.maxP95EdgeLength,
    });
  }

  const softResults: SoftMetricResult[] = [];
  if (testCase.softBaselines) {
    const softMetricNames: Array<keyof SoftBaselines> = [
      'edgeNodeOcclusions',
      'edgeEdgeCrossings',
      'avgEdgeLength',
      'longEdgeRatio',
      'canvasWidth',
    ];
    const actualMetrics: Record<string, number> = {
      edgeNodeOcclusions: metrics.soft.edgeNodeOcclusions,
      edgeEdgeCrossings: metrics.soft.edgeEdgeCrossings,
      avgEdgeLength: metrics.soft.avgEdgeLength,
      longEdgeRatio: metrics.soft.longEdgeRatio,
      canvasWidth: metrics.soft.canvasWidth,
    };

    for (const name of softMetricNames) {
      const baseline = testCase.softBaselines[name];
      const actual = actualMetrics[name];
      const budget =
        (testCase.degradationBudget as Record<string, number | undefined>)[name] ?? 0.15;
      const degradation = baseline === 0 ? (actual > 0 ? 1 : 0) : (actual - baseline) / baseline;

      softResults.push({
        name,
        baseline,
        actual,
        degradation,
        budget,
        passed: degradation <= budget,
      });
    }
  }

  const allHardPassed = hardResults.every((r) => r.passed);
  const allSoftPassed = softResults.every((r) => r.passed);

  return {
    caseId: testCase.id,
    split: testCase.split,
    status: testCase.status,
    passed: allHardPassed && allSoftPassed,
    reason: !allHardPassed
      ? 'hard constraint failed'
      : !allSoftPassed
        ? 'soft metric degraded beyond budget'
        : undefined,
    hardResults,
    softResults,
  };
}

/**
 * 运行回归套件。
 * @param split 筛选 split；不传则运行所有。
 */
export function runRegressionSuite(
  cases: RegressionCase[],
  adapter: LayoutEngineAdapter,
  split?: string,
): RegressionSuiteResult {
  const filtered = split ? cases.filter((c) => c.split === split) : cases;
  const results: RegressionCaseResult[] = [];

  for (const testCase of filtered) {
    results.push(runRegressionCase(testCase, adapter));
  }

  const passedCases = results.filter((r) => r.passed).length;
  const failedCases = results.filter((r) => !r.passed).length;
  const skippedCases = results.filter((r) => r.status === 'candidate').length;

  const passRateBySplit: Record<string, { passed: number; total: number; skipped: number }> = {};
  for (const result of results) {
    if (!passRateBySplit[result.split]) {
      passRateBySplit[result.split] = { passed: 0, total: 0, skipped: 0 };
    }
    passRateBySplit[result.split].total++;
    if (result.passed) passRateBySplit[result.split].passed++;
    if (result.status === 'candidate') passRateBySplit[result.split].skipped++;
  }

  return {
    totalCases: results.length,
    passedCases,
    failedCases,
    skippedCases,
    results,
    passRateBySplit,
  };
}

/**
 * 生成回归报告。
 */
export function formatRegressionReport(suiteResult: RegressionSuiteResult): string {
  const lines: string[] = [];
  lines.push(
    `回归套件：${suiteResult.passedCases}/${suiteResult.totalCases} 通过，${suiteResult.skippedCases} 跳过（candidate）`,
  );
  lines.push('');

  for (const [split, stats] of Object.entries(suiteResult.passRateBySplit)) {
    const effective = stats.total - stats.skipped;
    const status =
      stats.skipped === stats.total ? '⏭️' : stats.passed === effective ? '✅' : '❌';
    lines.push(`  ${status} ${split}: ${stats.passed}/${effective} 通过，${stats.skipped} 跳过`);
  }
  lines.push('');

  const failed = suiteResult.results.filter((r) => !r.passed && r.status !== 'candidate');
  if (failed.length > 0) {
    lines.push(`失败的 case（${failed.length} 个）：`);
    for (const result of failed) {
      lines.push(`  ❌ ${result.caseId} (${result.split}): ${result.reason}`);
      for (const hard of result.hardResults.filter((r) => !r.passed)) {
        lines.push(`     硬约束 ${hard.name}: 期望 ${hard.expected}, 实际 ${hard.actual}`);
      }
      for (const soft of result.softResults.filter((r) => !r.passed)) {
        lines.push(
          `     软指标 ${soft.name}: 基线 ${soft.baseline}, 实际 ${soft.actual}, 退化 ${(soft.degradation * 100).toFixed(1)}% > ${(soft.budget * 100).toFixed(1)}%`,
        );
      }
    }
  } else {
    lines.push('所有 baselined case 通过 ✅');
  }

  return lines.join('\n');
}
