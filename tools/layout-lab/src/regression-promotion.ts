/**
 * 回归 case 晋级函数。
 * 状态机：candidate → 人工写期望 → case 先失败 → 改算法 → accept-baseline → regression
 */
import type { MergedGraph } from '@listen-graphic/schema';
import type {
  DegradationBudget,
  HardExpectations,
  RegressionCase,
} from '../../../packages/graph-fixtures/src/types';

import type { LayoutEngineAdapter } from './layout-engine-adapter';
import { centerToTopLeft, computeLayoutQuality } from './layout-metrics-v2';
import { loadRegressionCase, saveRegressionCase } from './regression-store';

export type PromotionInput = {
  caseId: string;
  description: string;
  problemDescription: string;
  split: 'regression' | 'tuning' | 'holdout';
  source: string;
  graph: MergedGraph;
  primaryView?: 'timeline' | 'causal' | 'comparison' | 'hierarchy';
  tags?: string[];
  triggeringNodeIds?: string[];
  triggeringEdgeIds?: string[];
  hardExpectations?: Partial<HardExpectations>;
  degradationBudget?: Partial<DegradationBudget>;
};

/**
 * 创建候选回归 case（状态：candidate）。
 * 不计算基线——case 必须先失败，证明期望有意义。
 */
export function createCandidateCase(input: PromotionInput): RegressionCase {
  return {
    id: input.caseId,
    kind: 'regression',
    description: input.description,
    problemDescription: input.problemDescription,
    split: input.split,
    source: input.source,
    status: 'candidate',
    graph: input.graph,
    primaryView: input.primaryView,
    hardExpectations: {
      physicalOverlapPairs: 0,
      clearanceViolationPairs: 0,
      coordinateValidity: true,
      ...input.hardExpectations,
    },
    softBaselines: undefined,
    degradationBudget: {
      edgeNodeOcclusions: 0.15,
      edgeEdgeCrossings: 0.15,
      avgEdgeLength: 0.15,
      longEdgeRatio: 0.15,
      canvasWidth: 0.2,
      ...input.degradationBudget,
    },
    tags: input.tags,
    triggeringNodeIds: input.triggeringNodeIds,
    triggeringEdgeIds: input.triggeringEdgeIds,
  };
}

/**
 * 接受基线（显式命令，不是自动计算）。
 * 运行当前算法，将结果写入 softBaselines，状态变为 baselined。
 */
export function acceptBaseline(
  caseId: string,
  adapter: LayoutEngineAdapter,
): RegressionCase {
  const testCase = loadRegressionCase(caseId);
  if (testCase.status !== 'candidate') {
    throw new Error(`Case ${caseId} is not in candidate status (current: ${testCase.status})`);
  }

  const result = adapter.computeLayout(testCase.graph);
  const positions = centerToTopLeft(result.positions, result.sizes);
  const edges = testCase.graph.edges.map((e) => ({ source: e.source, target: e.target }));
  const metrics = computeLayoutQuality(edges, positions, result.sizes);

  const updated: RegressionCase = {
    ...testCase,
    status: 'baselined',
    softBaselines: {
      edgeNodeOcclusions: metrics.soft.edgeNodeOcclusions,
      edgeEdgeCrossings: metrics.soft.edgeEdgeCrossings,
      avgEdgeLength: metrics.soft.avgEdgeLength,
      p95EdgeLength: metrics.soft.p95EdgeLength,
      longEdgeRatio: metrics.soft.longEdgeRatio,
      canvasWidth: metrics.soft.canvasWidth,
      canvasHeight: metrics.soft.canvasHeight,
      aspectRatio: metrics.soft.aspectRatio,
    },
    algorithmId: adapter.id,
    algorithmVersion: adapter.version,
    metricsVersion: 'v2',
    clearancePx: testCase.hardExpectations.minClearancePx ?? 16,
  };

  saveRegressionCase(updated);
  return updated;
}
