#!/usr/bin/env tsx
/**
 * CLI：将原始 graph 晋级为候选回归 case。
 *
 * 用法：
 *   cd tools/layout-lab/run && npx tsx ../src/promote-regression-case.ts \
 *     --input ../inputs/real-graphs-dump.json \
 *     --session-id <sessionId> \
 *     --case-id <caseId> \
 *     --description "描述" \
 *     --problem "问题描述" \
 *     --split regression \
 *     --source real-usage
 */
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

import type { MergedGraph } from '@listen-graphic/schema';

import { createCandidateCase, type PromotionInput } from './regression-promotion';
import { saveRegressionCase } from './regression-store';

const { values } = parseArgs({
  options: {
    input: { type: 'string' },
    'session-id': { type: 'string' },
    'case-id': { type: 'string' },
    description: { type: 'string' },
    problem: { type: 'string' },
    split: { type: 'string' },
    source: { type: 'string' },
    tags: { type: 'string' },
  },
});

if (!values.input || !values['session-id'] || !values['case-id']) {
  console.error(
    'Usage: --input <corpus.json> --session-id <id> --case-id <id> [--description] [--problem] [--split] [--source] [--tags]',
  );
  process.exit(1);
}

const corpus: MergedGraph[] = JSON.parse(readFileSync(values.input, 'utf-8'));
const graph = corpus.find((g) => g.sessionId === values['session-id']);
if (!graph) {
  console.error(`Session not found: ${values['session-id']}`);
  process.exit(1);
}

const input: PromotionInput = {
  caseId: values['case-id'],
  description: values.description ?? '',
  problemDescription: values.problem ?? '',
  split: (values.split as PromotionInput['split']) ?? 'regression',
  source: values.source ?? 'cli',
  graph,
  tags: values.tags ? values.tags.split(',') : undefined,
};

const testCase = createCandidateCase(input);
saveRegressionCase(testCase);
console.log(`✅ Created candidate case: ${testCase.id} (status: candidate)`);
console.log(
  '   Next: run regression to verify case fails, then fix algorithm, then accept-baseline',
);
