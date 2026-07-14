#!/usr/bin/env tsx
/**
 * CLI：接受基线（candidate → baselined）。
 *
 * 用法：
 *   pnpm --filter listen-graph-layout-lab accept-baseline --case-id reg-r3b-049
 *   pnpm --filter listen-graph-layout-lab accept-baseline --all-candidates
 */
import { parseArgs } from 'node:util';

import { createR3bAdapter } from './layout-engine-adapter';
import { acceptBaseline } from './regression-promotion';
import { listRegressionCases } from './regression-store';

const { values } = parseArgs({
  options: {
    'case-id': { type: 'string' },
    'all-candidates': { type: 'boolean', default: false },
  },
});

const adapter = createR3bAdapter();

if (values['all-candidates']) {
  const candidates = listRegressionCases().filter((c) => c.status === 'candidate');
  if (candidates.length === 0) {
    console.error('No candidate cases');
    process.exit(1);
  }
  for (const c of candidates) {
    const updated = acceptBaseline(c.id, adapter);
    console.log(`✅ baselined ${updated.id}`);
  }
  process.exit(0);
}

if (!values['case-id']) {
  console.error('Usage: --case-id <id> | --all-candidates');
  process.exit(1);
}

const updated = acceptBaseline(values['case-id'], adapter);
console.log(`✅ baselined ${updated.id} (algorithm=${updated.algorithmId}@${updated.algorithmVersion})`);
