/**
 * 回归 case 存储。
 * 独立于 write-fixtures.mjs，不会被覆盖。
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  parseRegressionCase,
  parseRegressionManifest,
} from '../../../packages/graph-fixtures/src/load';
import type { RegressionCase, RegressionManifest } from '../../../packages/graph-fixtures/src/types';

const REGRESSION_DIR = join(dirname(fileURLToPath(import.meta.url)), '../fixtures/regression');
const MANIFEST_PATH = join(REGRESSION_DIR, 'manifest.json');

/**
 * 原子写入：先写临时文件再 rename，避免崩溃留下半写文件（修复 M4 review finding）。
 * rename 在同一文件系统上是原子的（POSIX/NTFS 均保证）。
 */
function atomicWrite(filePath: string, content: string): void {
  const tmp = `${filePath}.tmp`;
  writeFileSync(tmp, content, 'utf-8');
  renameSync(tmp, filePath);
}

export function loadRegressionManifest(): RegressionManifest {
  if (!existsSync(MANIFEST_PATH)) {
    return { version: 1, cases: [] };
  }
  const raw = JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8'));
  return parseRegressionManifest(raw);
}

export function saveRegressionManifest(manifest: RegressionManifest): void {
  mkdirSync(dirname(MANIFEST_PATH), { recursive: true });
  atomicWrite(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
}

export function loadRegressionCase(id: string): RegressionCase {
  const manifest = loadRegressionManifest();
  const entry = manifest.cases.find((c) => c.id === id);
  if (!entry) throw new Error(`Regression case not found: ${id}`);
  const filePath = join(REGRESSION_DIR, entry.file);
  const raw = JSON.parse(readFileSync(filePath, 'utf-8'));
  return parseRegressionCase(raw);
}

export function saveRegressionCase(testCase: RegressionCase): void {
  const manifest = loadRegressionManifest();
  const fileName = `${testCase.id}.json`;
  const filePath = join(REGRESSION_DIR, fileName);

  const existing = manifest.cases.find((c) => c.id === testCase.id);
  if (existing) {
    existing.file = fileName;
    existing.tags = testCase.tags;
    existing.description = testCase.description;
  } else {
    manifest.cases.push({
      id: testCase.id,
      file: fileName,
      tags: testCase.tags,
      description: testCase.description,
    });
  }

  mkdirSync(REGRESSION_DIR, { recursive: true });
  // 先原子写 case 文件，成功后再更新 manifest——保证 manifest 只在 case 落盘后指向它
  atomicWrite(filePath, JSON.stringify(testCase, null, 2));
  saveRegressionManifest(manifest);
}

export function listRegressionCases(): RegressionCase[] {
  const manifest = loadRegressionManifest();
  return manifest.cases.map((entry) => {
    const filePath = join(REGRESSION_DIR, entry.file);
    const raw = JSON.parse(readFileSync(filePath, 'utf-8'));
    return parseRegressionCase(raw);
  });
}
