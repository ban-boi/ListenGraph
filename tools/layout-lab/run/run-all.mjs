#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.resolve(__dirname, '../src');

const stageArg = process.argv.find((a) => a.startsWith('--stage='))?.slice('--stage='.length);

const stages = [
  { name: 'export', file: 'export-snapshot.ts' },
  { name: 'capture', file: 'capture-screenshots.ts' },
  { name: 'annotate', file: 'llm-annotate.ts' },
  { name: 'gallery', file: 'render-gallery.ts' },
];

const toRun = stageArg ? stages.filter((s) => s.name === stageArg) : stages;

for (const s of toRun) {
  console.log(`\n========== [stage] ${s.name} ==========\n`);
  const r = spawnSync('npx', ['tsx', path.join(srcDir, s.file)], {
    stdio: 'inherit',
    shell: true,
    cwd: __dirname,
  });
  if (r.status !== 0) {
    console.error(`[run-all] stage ${s.name} 失败 (exit ${r.status})，后续阶段中止`);
    process.exit(r.status ?? 1);
  }
}
console.log('\n========== 全部完成 ==========');
