#!/usr/bin/env tsx
/**
 * R3b 候选发布门禁编排：回归 → holdout → 双包构建 → round5(23 样本) → stability。
 *
 * Usage（仓库根）:
 *   pnpm test:r3b-release-gate
 *   pnpm --filter listen-graph-layout-lab release-gate
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/** src → layout-lab → tools → repo root */
const ROOT = path.resolve(import.meta.dirname, '../../..');
const DIST = path.join(ROOT, 'apps/extension/dist');
const DIST_STABLE = path.join(ROOT, 'apps/extension/dist-stable-fixture');

type Step = {
  name: string;
  run: () => void;
};

function runPnpm(args: string[], label: string): void {
  console.log(`\n========== [gate] ${label} ==========\n`);
  const result = spawnSync('pnpm', args, {
    cwd: ROOT,
    stdio: 'inherit',
    shell: true,
  });
  if (result.status !== 0) {
    console.error(`[r3b-release-gate] FAIL at "${label}" (exit ${result.status ?? 1})`);
    process.exit(result.status ?? 1);
  }
}

function copyStableFixtureDist(): void {
  console.log('\n========== [gate] copy dist → dist-stable-fixture ==========\n');
  if (!fs.existsSync(DIST)) {
    console.error(`[r3b-release-gate] FAIL: missing build output: ${DIST}`);
    process.exit(1);
  }
  fs.rmSync(DIST_STABLE, { recursive: true, force: true });
  fs.cpSync(DIST, DIST_STABLE, { recursive: true });
  console.log(`[r3b-release-gate] copied ${DIST} → ${DIST_STABLE}`);
}

const steps: Step[] = [
  {
    name: 'layout-regression',
    run: () => runPnpm(['test:layout-regression'], 'layout-regression'),
  },
  {
    name: 'layout-regression:holdout',
    run: () => runPnpm(['test:layout-regression:holdout'], 'layout-regression:holdout'),
  },
  {
    name: 'build:fixture-lab + copy stable',
    run: () => {
      runPnpm(['--filter', 'extension', 'build:fixture-lab'], 'build:fixture-lab');
      copyStableFixtureDist();
    },
  },
  {
    name: 'build:r3b:fixture-lab',
    run: () =>
      runPnpm(['--filter', 'extension', 'build:r3b:fixture-lab'], 'build:r3b:fixture-lab'),
  },
  {
    name: 'round5-verify',
    run: () =>
      runPnpm(['--filter', 'listen-graph-layout-lab', 'round5-verify'], 'round5-verify'),
  },
  {
    name: 'stability',
    run: () => runPnpm(['--filter', 'listen-graph-layout-lab', 'stability'], 'stability'),
  },
];

console.log(`[r3b-release-gate] ROOT=${ROOT}`);
console.log(`[r3b-release-gate] steps=${steps.length}`);

for (const step of steps) {
  step.run();
}

console.log('\n========== [r3b-release-gate] PASS ==========\n');
process.exit(0);
