#!/usr/bin/env tsx
/**
 * CLI：接受基线（candidate → baselined）或受控 rebaseline（baselined → 重录）。
 *
 * 用法：
 *   # 首次固化（candidate → baselined）
 *   pnpm --filter listen-graph-layout-lab accept-baseline --engine product --case-id reg-r3b-049
 *   pnpm --filter listen-graph-layout-lab accept-baseline --engine product --all-candidates
 *
 *   # 受控 rebaseline（baselined → 用新 engine 重录 soft metrics）
 *   pnpm --filter listen-graph-layout-lab accept-baseline --engine product --rebaseline --all-baselined
 *   pnpm --filter listen-graph-layout-lab accept-baseline --engine product --rebaseline --case-id reg-r3b-049
 */
import { parseArgs } from 'node:util';

import { createProductR3bAdapter, createR3bAdapter } from './layout-engine-adapter';
import type { LayoutEngineAdapter } from './layout-engine-adapter';
import { acceptBaseline, rebaseline } from './regression-promotion';
import { listRegressionCases } from './regression-store';

const { values } = parseArgs({
  options: {
    engine: { type: 'string' },
    'case-id': { type: 'string' },
    'all-candidates': { type: 'boolean', default: false },
    'all-baselined': { type: 'boolean', default: false },
    rebaseline: { type: 'boolean', default: false },
  },
});

if (values.engine !== 'product' && values.engine !== 'lab') {
  console.error('--engine 必填（product | lab）');
  process.exit(1);
}
const adapter: LayoutEngineAdapter =
  values.engine === 'product' ? createProductR3bAdapter() : createR3bAdapter();

if (values.rebaseline) {
  // 受控 rebaseline：只对 baselined 状态的 case 重录 soft metrics
  const targets = values['all-baselined']
    ? listRegressionCases().filter((c) => c.status === 'baselined')
    : values['case-id']
      ? listRegressionCases().filter((c) => c.id === values['case-id'] && c.status === 'baselined')
      : [];
  if (targets.length === 0) {
    console.error('rebaseline 需要 --all-baselined 或 --case-id（且该 case 必须已 baselined）');
    process.exit(1);
  }
  for (const c of targets) {
    try {
      const updated = rebaseline(c.id, adapter);
      console.log(`rebaselined ${updated.id} (algorithm=${updated.algorithmId}@${updated.algorithmVersion})`);
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  }
  process.exit(0);
}

if (values['all-candidates']) {
  const candidates = listRegressionCases().filter((c) => c.status === 'candidate');
  if (candidates.length === 0) {
    console.error('No candidate cases');
    process.exit(1);
  }
  for (const c of candidates) {
    try {
      const updated = acceptBaseline(c.id, adapter);
      console.log(`baselined ${updated.id}`);
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  }
  process.exit(0);
}

if (!values['case-id']) {
  console.error('Usage: --case-id <id> | --all-candidates | --rebaseline [--all-baselined|--case-id <id>]  (需 --engine product|lab)');
  process.exit(1);
}

try {
  const updated = acceptBaseline(values['case-id'], adapter);
  console.log(`baselined ${updated.id} (algorithm=${updated.algorithmId}@${updated.algorithmVersion})`);
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
