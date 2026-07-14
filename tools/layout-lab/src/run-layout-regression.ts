#!/usr/bin/env tsx
/**
 * CLI：运行回归套件。
 *
 * 用法：
 *   cd tools/layout-lab/run && npx tsx ../src/run-layout-regression.ts --split regression
 *   cd tools/layout-lab/run && npx tsx ../src/run-layout-regression.ts --split holdout
 *   cd tools/layout-lab/run && npx tsx ../src/run-layout-regression.ts --case-id specific-case
 */
import { parseArgs } from 'node:util';

import { createR3bAdapter } from './layout-engine-adapter';
import {
  evaluateSuiteExit,
  formatRegressionReport,
  runRegressionCase,
  runRegressionSuite,
} from './regression-runner';
import { listRegressionCases } from './regression-store';

const { values } = parseArgs({
  options: {
    split: { type: 'string' },
    'case-id': { type: 'string' },
  },
});

const adapter = createR3bAdapter();
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
  const exit = evaluateSuiteExit(suiteResult, { split, minBaselined });
  if (exit.code !== 0) {
    console.error(`[gate] FAIL: ${exit.reason}`);
  }
  process.exit(exit.code);
}
