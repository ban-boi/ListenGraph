import { describe, expect, it } from 'vitest';

import type { MergedGraph } from '@listen-graphic/schema';
import type { RegressionCase } from '../../../packages/graph-fixtures/src/types';

import type { LayoutEngineAdapter } from './layout-engine-adapter';
import {
  evaluateSuiteExit,
  formatRegressionReport,
  runRegressionCase,
  runRegressionSuite,
} from './regression-runner';

function makeSimpleAdapter(): LayoutEngineAdapter {
  return {
    id: 'test',
    version: '0.0.1',
    computeLayout(graph: MergedGraph) {
      const positions: Record<string, { cx: number; cy: number }> = {};
      const sizes: Record<string, { width: number; height: number }> = {};
      graph.nodes.forEach((node, i) => {
        positions[node.id] = { cx: i * 200 + 100, cy: 100 };
        sizes[node.id] = { width: 160, height: 80 };
      });
      return { positions, sizes, algorithmId: 'test', algorithmVersion: '0.0.1' };
    },
  };
}

function makeGraph(): MergedGraph {
  return {
    sessionId: 'test',
    revision: 1,
    topics: [],
    nodes: [
      { id: 'n1', type: 'claim', text: 'A', timestampMs: 0, status: 'confirmed' },
      { id: 'n2', type: 'reason', text: 'B', timestampMs: 1, status: 'confirmed' },
      { id: 'n3', type: 'example', text: 'C', timestampMs: 2, status: 'confirmed' },
    ],
    edges: [
      { id: 'e1', source: 'n1', target: 'n2', type: 'supports' },
      { id: 'e2', source: 'n2', target: 'n3', type: 'example_of' },
    ],
    updatedAt: Date.now(),
  };
}

function makeBaselinedCase(overrides: Partial<RegressionCase> = {}): RegressionCase {
  return {
    id: 'test-1',
    kind: 'regression',
    description: '测试',
    problemDescription: '问题',
    split: 'regression',
    source: 'test',
    status: 'baselined',
    graph: makeGraph(),
    hardExpectations: {
      physicalOverlapPairs: 0,
      clearanceViolationPairs: 0,
      coordinateValidity: true,
    },
    softBaselines: {
      edgeNodeOcclusions: 0,
      edgeEdgeCrossings: 0,
      avgEdgeLength: 200,
      p95EdgeLength: 200,
      longEdgeRatio: 1,
      canvasWidth: 560,
      canvasHeight: 80,
      aspectRatio: 7,
    },
    degradationBudget: {
      edgeNodeOcclusions: 0.15,
      edgeEdgeCrossings: 0.15,
      avgEdgeLength: 0.15,
      longEdgeRatio: 0.15,
      canvasWidth: 0.2,
    },
    ...overrides,
  };
}

describe('runRegressionCase', () => {
  it('candidate 状态必须失败', () => {
    const testCase = makeBaselinedCase({ status: 'candidate', softBaselines: undefined });
    const result = runRegressionCase(testCase, makeSimpleAdapter());
    expect(result.passed).toBe(false);
    expect(result.reason).toContain('candidate');
  });

  it('baselined 状态：所有约束通过', () => {
    const result = runRegressionCase(makeBaselinedCase(), makeSimpleAdapter());
    expect(result.passed).toBe(true);
  });

  it('baselined 状态：硬约束失败', () => {
    const overlapping: LayoutEngineAdapter = {
      id: 'bad',
      version: '0.0.1',
      computeLayout(graph) {
        const positions: Record<string, { cx: number; cy: number }> = {};
        const sizes: Record<string, { width: number; height: number }> = {};
        graph.nodes.forEach((node) => {
          positions[node.id] = { cx: 100, cy: 100 };
          sizes[node.id] = { width: 160, height: 80 };
        });
        return { positions, sizes, algorithmId: 'bad', algorithmVersion: '0.0.1' };
      },
    };
    const result = runRegressionCase(makeBaselinedCase(), overlapping);
    expect(result.passed).toBe(false);
    expect(result.reason).toContain('hard constraint');
  });

  it('可选硬约束 maxCanvasWidthPx', () => {
    const result = runRegressionCase(
      makeBaselinedCase({
        hardExpectations: {
          physicalOverlapPairs: 0,
          clearanceViolationPairs: 0,
          coordinateValidity: true,
          maxCanvasWidthPx: 100,
        },
      }),
      makeSimpleAdapter(),
    );
    expect(result.passed).toBe(false);
    expect(result.hardResults.find((r) => r.name === 'maxCanvasWidthPx')?.passed).toBe(false);
  });
});

describe('runRegressionSuite', () => {
  it('按 split 筛选', () => {
    const cases = [
      makeBaselinedCase({ id: 'r1', split: 'regression' }),
      makeBaselinedCase({ id: 't1', split: 'tuning' }),
    ];
    const result = runRegressionSuite(cases, makeSimpleAdapter(), 'regression');
    expect(result.totalCases).toBe(1);
    expect(result.results[0].caseId).toBe('r1');
  });

  it('candidate 计入 skipped', () => {
    const cases = [makeBaselinedCase({ status: 'candidate', softBaselines: undefined })];
    const result = runRegressionSuite(cases, makeSimpleAdapter());
    expect(result.skippedCases).toBe(1);
  });
});

describe('formatRegressionReport', () => {
  it('包含 split 统计和失败详情', () => {
    const cases = [makeBaselinedCase({ id: 'r1' })];
    const report = formatRegressionReport(runRegressionSuite(cases, makeSimpleAdapter()));
    expect(report).toContain('regression:');
    expect(report).toContain('通过');
  });
});

describe('evaluateSuiteExit', () => {
  it('0 case → exit 1', () => {
    const r = evaluateSuiteExit(
      { totalCases: 0, passedCases: 0, failedCases: 0, skippedCases: 0, results: [], passRateBySplit: {} },
      { minBaselined: 1 },
    );
    expect(r.code).toBe(1);
    expect(r.reason).toMatch(/0 case/i);
  });

  it('全部 candidate → exit 1', () => {
    const r = evaluateSuiteExit(
      {
        totalCases: 2,
        passedCases: 0,
        failedCases: 2,
        skippedCases: 2,
        results: [
          { caseId: 'a', split: 'regression', status: 'candidate', passed: false, hardResults: [], softResults: [] },
          { caseId: 'b', split: 'regression', status: 'candidate', passed: false, hardResults: [], softResults: [] },
        ],
        passRateBySplit: { regression: { passed: 0, total: 2, skipped: 2 } },
      },
      { minBaselined: 1 },
    );
    expect(r.code).toBe(1);
    expect(r.reason).toMatch(/candidate|baselined/i);
  });

  it('baselined 全绿且数量够 → exit 0', () => {
    const r = evaluateSuiteExit(
      {
        totalCases: 1,
        passedCases: 1,
        failedCases: 0,
        skippedCases: 0,
        results: [
          { caseId: 'a', split: 'regression', status: 'baselined', passed: true, hardResults: [], softResults: [] },
        ],
        passRateBySplit: { regression: { passed: 1, total: 1, skipped: 0 } },
      },
      { minBaselined: 1 },
    );
    expect(r.code).toBe(0);
  });

  it('baselined 失败 → exit 1', () => {
    const r = evaluateSuiteExit(
      {
        totalCases: 1,
        passedCases: 0,
        failedCases: 1,
        skippedCases: 0,
        results: [
          {
            caseId: 'a',
            split: 'regression',
            status: 'baselined',
            passed: false,
            reason: 'hard constraint failed',
            hardResults: [],
            softResults: [],
          },
        ],
        passRateBySplit: { regression: { passed: 0, total: 1, skipped: 0 } },
      },
      { minBaselined: 1 },
    );
    expect(r.code).toBe(1);
    expect(r.reason).toMatch(/failed/i);
  });
});
