import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';
import type { MergedGraph } from '@listen-graphic/schema';
import { computeBaselinePositions } from './baseline-layout';
import { computeClusterLayoutA } from './cluster-layout';
import { computeClusterLayoutB } from './cluster-overview';
import { renderModelToHtml } from './html-renderer';

const DUMP_PATH = path.resolve(import.meta.dirname, '../inputs/real-graphs-dump.json');
const HTML_DIR = path.resolve(import.meta.dirname, '../outputs/round2-html');
const SHOT_DIR = path.resolve(import.meta.dirname, '../outputs/round2-screenshots');

// spec 4.x 代表样本（23 条）
const SAMPLE_INDICES = [
  49, 41, 48, 34, 47, 40, 29, 28, 39, 61, 31, 46,
  37, 32, 58, 57,
  18, 21, 16, 12, 6,
  33, 51,
];

export async function renderRound2(): Promise<void> {
  const dump = JSON.parse(fs.readFileSync(DUMP_PATH, 'utf8')) as MergedGraph[];
  fs.mkdirSync(HTML_DIR, { recursive: true });
  fs.mkdirSync(SHOT_DIR, { recursive: true });

  // 1. 算三候选坐标 + 生成 HTML
  for (const idx of SAMPLE_INDICES) {
    const graph = dump[idx];
    if (!graph) {
      console.warn(`[round2] graph #${idx} 不存在，跳过`);
      continue;
    }
    const padded = String(idx).padStart(2, '0');

    const baseline = computeBaselinePositions(graph, idx);
    const candidateA = computeClusterLayoutA(graph, idx);
    const candidateB = computeClusterLayoutB(graph, idx);

    renderModelToHtml(baseline, graph, path.join(HTML_DIR, `${padded}-baseline.html`));
    renderModelToHtml(candidateA, graph, path.join(HTML_DIR, `${padded}-A.html`));
    renderModelToHtml(candidateB, graph, path.join(HTML_DIR, `${padded}-B.html`));

    console.log(`[round2] #${padded}: baseline=${baseline.items.length}items A=${candidateA.meta.clusterCount}clusters B=${candidateB.meta.clusterCount}clusters`);
  }

  // 2. Playwright 截图
  const browser = await chromium.launch({ headless: true });
  for (const idx of SAMPLE_INDICES) {
    const padded = String(idx).padStart(2, '0');
    for (const candidate of ['baseline', 'A', 'B'] as const) {
      const htmlPath = path.join(HTML_DIR, `${padded}-${candidate}.html`);
      if (!fs.existsSync(htmlPath)) continue;
      const page = await browser.newPage();
      await page.goto(`file:///${htmlPath.replace(/\\/g, '/')}`);
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(300);
      await page.screenshot({
        path: path.join(SHOT_DIR, `${padded}-${candidate}.png`),
        fullPage: true,
      });
      await page.close();
    }
    console.log(`[round2] #${padded} 截图完成`);
  }
  await browser.close();
  console.log(`[round2] 全部完成：${SAMPLE_INDICES.length} 条图 × 3 候选`);
}

void renderRound2();
