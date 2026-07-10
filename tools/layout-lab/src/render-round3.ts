import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';
import type { MergedGraph } from '@listen-graphic/schema';
import { computeBaselinePositions } from './baseline-layout';
import { computeClusterForceLayout } from './cluster-force-layout';
import { renderModelToHtml } from './html-renderer';        // v1：baseline 固定 220×132
import { renderModelToHtmlV2 } from './html-renderer-v2';   // v2：R3a/R3b 自适应尺寸

const DUMP_PATH = path.resolve(import.meta.dirname, '../inputs/real-graphs-dump.json');
const HTML_DIR = path.resolve(import.meta.dirname, '../outputs/round3-html');
const SHOT_DIR = path.resolve(import.meta.dirname, '../outputs/round3-screenshots');

const SAMPLE_INDICES = [
  49, 41, 48, 34, 47, 40, 29, 28, 39, 61, 31, 46,
  37, 32, 58, 57,
  18, 21, 16, 12, 6,
  33, 51,
];

export async function renderRound3(): Promise<void> {
  const dump = JSON.parse(fs.readFileSync(DUMP_PATH, 'utf8')) as MergedGraph[];
  fs.mkdirSync(HTML_DIR, { recursive: true });
  fs.mkdirSync(SHOT_DIR, { recursive: true });

  for (const idx of SAMPLE_INDICES) {
    const graph = dump[idx];
    if (!graph) { console.warn(`[round3] #${idx} 不存在`); continue; }
    const padded = String(idx).padStart(2, '0');

    const baseline = computeBaselinePositions(graph, idx);
    const r3a = computeClusterForceLayout(graph, idx, 'R3a');
    const r3b = computeClusterForceLayout(graph, idx, 'R3b');

    // baseline 用 v1（固定 220×132），R3a/R3b 用 v2（自适应尺寸）
    renderModelToHtml(baseline, graph, path.join(HTML_DIR, `${padded}-baseline.html`));
    renderModelToHtmlV2(r3a, graph, path.join(HTML_DIR, `${padded}-R3a.html`));
    renderModelToHtmlV2(r3b, graph, path.join(HTML_DIR, `${padded}-R3b.html`));

    console.log(`[round3] #${padded}: baseline=${baseline.items.length}items R3a=${r3a.meta.clusterCount}clusters R3b=${r3b.meta.clusterCount}clusters`);
  }

  // Chromium 全页截图单边上限约 16384px；大图的力导向布局可能超过此限制。
  // 用固定 viewport 宽度 + clip 截图，最多截 16000px 高（首屏 + 滚动区域）。
  const MAX_SCREENSHOT_HEIGHT = 16000;
  const browser = await chromium.launch({ headless: true });
  for (const idx of SAMPLE_INDICES) {
    const padded = String(idx).padStart(2, '0');
    for (const cand of ['baseline', 'R3a', 'R3b'] as const) {
      const htmlPath = path.join(HTML_DIR, `${padded}-${cand}.html`);
      if (!fs.existsSync(htmlPath)) continue;
      const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
      try {
        await page.goto(`file:///${htmlPath.replace(/\\/g, '/')}`);
        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(300);
        // 测量实际画布尺寸，截取 min(实际高度, MAX) 的区域
        const dims = await page.evaluate(() => {
          const canvas = document.querySelector('.canvas') as HTMLElement;
          return { w: canvas?.scrollWidth ?? document.body.scrollWidth, h: canvas?.scrollHeight ?? document.body.scrollHeight };
        });
        const clipH = Math.min(dims.h, MAX_SCREENSHOT_HEIGHT);
        await page.setViewportSize({ width: Math.min(dims.w + 20, 2000), height: Math.min(clipH, 800) });
        await page.screenshot({
          path: path.join(SHOT_DIR, `${padded}-${cand}.png`),
          clip: { x: 0, y: 0, width: Math.min(dims.w + 20, 2000), height: clipH },
        });
      } catch (err) {
        console.warn(`[round3] #${padded} ${cand} 截图失败：${(err as Error).message.split('\n')[0]}`);
      } finally {
        await page.close();
      }
    }
    console.log(`[round3] #${padded} 截图完成`);
  }
  await browser.close();
  console.log(`[round3] 全部完成：${SAMPLE_INDICES.length} 条图 × 3 候选`);
}

void renderRound3();
