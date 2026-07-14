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

  // 退出码：基于实际运行的 case 判定（修复 B2）。
  // 原实现硬编码只看 passRateBySplit['regression']，--split holdout/tuning 时
  // 该 key 不存在 → undefined → 恒 exit 0，即使所有硬约束全挂 CI 也绿。
  // candidate 状态的 case 本就预期失败（需先 accept-baseline），不参与门禁。
  const failed = suiteResult.results.some((r) => !r.passed && r.status !== 'candidate');
  process.exit(failed ? 1 : 0);
}
