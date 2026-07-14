#!/usr/bin/env tsx
/**
 * 从本地 real-graphs-dump.json 批量脱敏并晋级为 regression/holdout candidate case。
 *
 * 用法：
 *   pnpm --filter listen-graph-layout-lab seed-regression
 *
 * 注意：dump 含真实对话，永不入库；本脚本只写入脱敏后的 fixtures/regression。
 *
 * hardExpectations：先跑一次 R3b dry-run；
 * - physicalOverlapPairs：小图（<50 节点）固定 0；大图写入实测残留（Round5 不对大图零门控 overlap）
 * - clearanceViolationPairs：min(actual, ceil(0.05 * pairCount))；无残留则为 0
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

/** 与 Round5 SAMPLE_INDICES 对齐的固定子集 */
const REGRESSION_INDICES = [49, 41, 48, 34, 47, 40, 29, 28, 18, 21, 6, 33];
const HOLDOUT_INDICES = [39, 61, 31, 57, 16, 51];

const SMALL_NODE_LIMIT = 50;
const MIN_CLEARANCE_PX = 16;

function caseId(idx: number): string {
  return `reg-r3b-${String(idx).padStart(3, '0')}`;
}

function measureHardResiduals(graph: MergedGraph): {
  physicalOverlapPairs: number;
  clearanceViolationPairs: number;
  pairCount: number;
  notes: string[];
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
  const actualOverlap = metrics.hard.physicalOverlapPairs;

  const notes: string[] = [];
  const clearanceViolationPairs =
    actualClear === 0 ? 0 : Math.min(actualClear, clearBudget || actualClear);
  if (clearanceViolationPairs > 0) {
    notes.push(
      `Round5 clearance residual: actual=${actualClear}, budget=ceil(0.05*${pairCount})=${clearBudget}, contract=${clearanceViolationPairs}`,
    );
  }

  const isLarge = graph.nodes.length >= SMALL_NODE_LIMIT;
  const physicalOverlapPairs = isLarge ? actualOverlap : 0;
  if (physicalOverlapPairs > 0) {
    notes.push(
      `Large-graph physical overlap residual (Round5 does not zero-gate large samples): actual=${actualOverlap}`,
    );
  }
  if (!isLarge && actualOverlap > 0) {
    notes.push(
      `WARN small-graph overlap actual=${actualOverlap} but contract kept at 0 (Round5 hard)`,
    );
  }

  return { physicalOverlapPairs, clearanceViolationPairs, pairCount, notes };
}

function seedOne(dump: MergedGraph[], idx: number, split: 'regression' | 'holdout') {
  const graph = dump[idx];
  if (!graph) throw new Error(`dump[${idx}] missing`);
  const id = caseId(idx);
  const redacted = redactMergedGraph(graph, { caseId: id });
  const residuals = measureHardResiduals(redacted);
  const baseProblem = 'Release-gate readability / overlap / clearance contract';
  const problemDescription =
    residuals.notes.length > 0
      ? `${baseProblem}. ${residuals.notes.join(' | ')}`
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
      physicalOverlapPairs: residuals.physicalOverlapPairs,
      clearanceViolationPairs: residuals.clearanceViolationPairs,
      coordinateValidity: true,
      minClearancePx: MIN_CLEARANCE_PX,
    },
  });
  saveRegressionCase(testCase);
  console.log(
    `seeded ${id} split=${split} nodes=${redacted.nodes.length} ` +
      `overlap≤${residuals.physicalOverlapPairs} clearance≤${residuals.clearanceViolationPairs} (pairs=${residuals.pairCount})`,
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
