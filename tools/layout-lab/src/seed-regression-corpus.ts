#!/usr/bin/env tsx
/**
 * 从本地 real-graphs-dump.json 批量脱敏并晋级为 regression/holdout candidate case。
 *
 * 用法：
 *   pnpm --filter listen-graph-layout-lab seed-regression
 *
 * 注意：dump 含真实对话，永不入库；本脚本只写入脱敏后的 fixtures/regression。
 *
 * hardExpectations：
 * - physicalOverlapPairs：始终 0（零重叠硬门；有真实重叠的图应进 tuning，不写进合同）
 * - clearanceViolationPairs：dry-run 后 min(actual, ceil(0.05 * pairCount))
 *
 * 索引说明：下列集合为「零重叠硬门下可绿」的发布门子集。
 * Round5 SAMPLE 中因 overlap>0 无法进 regression/holdout 的大图（如 #33/#51/#49…）
 * 由 fix-zero-overlap / 人工调到 tuning，不在此 seed 列表中。
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { MergedGraph } from '@listen-graphic/schema';

import { createR3bAdapter } from './layout-engine-adapter';
import { centerToTopLeft, computeLayoutQuality } from './layout-metrics-v2';
import { redactMergedGraph } from './redact-graph';
import { createCandidateCase } from './regression-promotion';
import { saveRegressionCase } from './regression-store';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DUMP = resolve(ROOT, 'inputs/real-graphs-dump.json');

/** 零重叠硬门下可绿的 regression 子集（含 SAMPLE 补位） */
const REGRESSION_INDICES = [18, 21, 6, 46, 32, 2, 4, 11, 43, 1, 44, 0];
/** 零重叠硬门下可绿的 holdout 子集 */
const HOLDOUT_INDICES = [31, 57, 16, 8, 10, 25];

const MIN_CLEARANCE_PX = 16;

function caseId(idx: number): string {
  return `reg-r3b-${String(idx).padStart(3, '0')}`;
}

function measureClearanceContract(graph: MergedGraph): {
  clearanceViolationPairs: number;
  pairCount: number;
  note?: string;
} {
  const adapter = createR3bAdapter();
  const result = adapter.computeLayout(graph);
  const positions = centerToTopLeft(result.positions, result.sizes);
  const edges = graph.edges.map((e) => ({ source: e.source, target: e.target }));
  const metrics = computeLayoutQuality(edges, positions, result.sizes, {
    clearanceThreshold: MIN_CLEARANCE_PX,
  });

  const n = Object.keys(positions).length;
  const pairCount = n < 2 ? 0 : (n * (n - 1)) / 2;
  const clearBudget = Math.ceil(0.05 * pairCount);
  const actualClear = metrics.hard.clearanceViolationPairs;
  const clearanceViolationPairs =
    actualClear === 0 ? 0 : Math.min(actualClear, clearBudget || actualClear);

  return {
    clearanceViolationPairs,
    pairCount,
    note:
      clearanceViolationPairs > 0
        ? `Round5 clearance residual: actual=${actualClear}, budget=ceil(0.05*${pairCount})=${clearBudget}, contract=${clearanceViolationPairs}`
        : undefined,
  };
}

function seedOne(dump: MergedGraph[], idx: number, split: 'regression' | 'holdout') {
  const graph = dump[idx];
  if (!graph) throw new Error(`dump[${idx}] missing`);
  const id = caseId(idx);
  const redacted = redactMergedGraph(graph, { caseId: id });
  const clearance = measureClearanceContract(redacted);
  const baseProblem = 'Release-gate readability / overlap / clearance contract';
  const problemDescription = clearance.note
    ? `${baseProblem}. ${clearance.note}`
    : baseProblem;

  const testCase = createCandidateCase({
    caseId: id,
    description: `R3b release corpus dump#${idx} (${graph.nodes.length}n/${graph.edges.length}e)`,
    problemDescription,
    split,
    source: `real-graphs-dump.json#${idx}`,
    graph: redacted,
    tags: ['r3b-release', `dump-${idx}`, split],
    hardExpectations: {
      physicalOverlapPairs: 0,
      clearanceViolationPairs: clearance.clearanceViolationPairs,
      coordinateValidity: true,
      minClearancePx: MIN_CLEARANCE_PX,
    },
  });
  saveRegressionCase(testCase);
  console.log(
    `seeded ${id} split=${split} nodes=${redacted.nodes.length} ` +
      `overlap≤0 clearance≤${clearance.clearanceViolationPairs} (pairs=${clearance.pairCount})`,
  );
}

function main() {
  if (!existsSync(DUMP)) {
    console.error(`Missing ${DUMP}. Copy dump locally first (see layout-lab README).`);
    process.exit(1);
  }
  const dump = JSON.parse(readFileSync(DUMP, 'utf8')) as MergedGraph[];
  for (const i of REGRESSION_INDICES) seedOne(dump, i, 'regression');
  for (const i of HOLDOUT_INDICES) seedOne(dump, i, 'holdout');
}

main();
