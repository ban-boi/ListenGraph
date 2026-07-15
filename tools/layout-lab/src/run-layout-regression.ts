#!/usr/bin/env tsx
/**
 * CLI：运行回归套件。
 *
 * 用法：
 *   cd tools/layout-lab/run && npx tsx ../src/run-layout-regression.ts --engine product --split regression
 *   cd tools/layout-lab/run && npx tsx ../src/run-layout-regression.ts --engine product --split holdout
 *   cd tools/layout-lab/run && npx tsx ../src/run-layout-regression.ts --engine lab --split regression  # lab 调试
 *   cd tools/layout-lab/run && npx tsx ../src/run-layout-regression.ts --engine product --case-id specific-case
 *
 * --engine 必填（product | lab），无则报错退出，避免误跑错引擎路径：
 * - product = computeIncrementalLayout + 产品尺寸（发布门用）
 * - lab = computeClusterForceLayout + lab 尺寸（调参基准/真相源）
 */
import { parseArgs } from 'node:util';

import { createProductR3bAdapter, createR3bAdapter } from './layout-engine-adapter';
import type { LayoutEngineAdapter } from './layout-engine-adapter';
import {
  evaluateSuiteExit,
  formatRegressionReport,
  runRegressionCase,
  runRegressionSuite,
} from './regression-runner';
import { listRegressionCases } from './regression-store';

const { values } = parseArgs({
  options: {
    engine: { type: 'string' },
    split: { type: 'string' },
    'case-id': { type: 'string' },
  },
});

// --engine 必填，避免误跑
if (values.engine !== 'product' && values.engine !== 'lab') {
  console.error('[gate] --engine 必填（product | lab）。product=发布门真实路径，lab=调参基准。');
  process.exit(1);
}
const adapter: LayoutEngineAdapter =
  values.engine === 'product' ? createProductR3bAdapter() : createR3bAdapter();
const allCases = listRegressionCases();

if (values['case-id']) {
  const testCase = allCases.find((c) => c.id === values['case-id']);
  if (!testCase) {
    console.error(`Case not found: ${values['case-id']}`);
    process.exit(1);
  }
  const result = runRegressionCase(testCase, adapter);
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.passed ? 0 : 1);
} else {
  const split = values.split;
  const suiteResult = runRegressionSuite(allCases, adapter, split);
  console.log(formatRegressionReport(suiteResult));

  const minBaselined = split === 'holdout' ? 1 : split === 'regression' || !split ? 12 : 1;
  const exit = evaluateSuiteExit(suiteResult, { minBaselined });
  if (exit.code !== 0) {
    console.error(`[gate] FAIL: ${exit.reason}`);
  }
  process.exit(exit.code);
}
