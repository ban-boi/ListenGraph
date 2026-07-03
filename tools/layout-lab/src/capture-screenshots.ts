import fs from 'node:fs';
import path from 'node:path';
import type { MergedGraph } from '@listen-graphic/schema';
import {
  launchExtensionContext,
  openSidepanelPage,
  waitForFixtureReady,
  waitForFixtureGraph,
  stabilizeForScreenshot,
} from './e2e-helpers';

const DEFAULT_INPUT = path.resolve(import.meta.dirname, '../inputs/real-graphs-dump.json');
const DEFAULT_OUTPUT = path.resolve(import.meta.dirname, '../outputs/screenshots');
const USER_DATA_DIR = path.resolve(import.meta.dirname, '../.tmp/lab-user-data');

export async function captureScreenshots(
  inputPath: string = DEFAULT_INPUT,
  outputDir: string = DEFAULT_OUTPUT,
  onlyIndex?: number,
): Promise<void> {
  const dump = JSON.parse(fs.readFileSync(inputPath, 'utf8')) as MergedGraph[];
  fs.mkdirSync(outputDir, { recursive: true });

  const { context, extensionId } = await launchExtensionContext(USER_DATA_DIR);
  const page = await openSidepanelPage(context, extensionId);
  await page.waitForLoadState('domcontentloaded');
  // 控制器是 App.tsx useEffect 内的动态 import，必须等它挂载完成才能 loadGraph。
  await waitForFixtureReady(page);

  const indices = onlyIndex !== undefined ? [onlyIndex] : dump.map((_, i) => i);

  for (const i of indices) {
    const graph = dump[i];
    const padded = String(i).padStart(2, '0');

    // 1. 灌图（静态装载）
    await page.evaluate((g) => {
      globalThis.__listenGraphicFixture?.loadGraph(g);
    }, graph);

    // 2. 等 React 渲染完成（读 status，不查 service worker）
    await waitForFixtureGraph(page, graph.nodes.length);

    // 3. 稳定视图（等 fitView 落定）
    await stabilizeForScreenshot(page);

    // 4. 截图
    await page.screenshot({
      path: path.join(outputDir, `${padded}.png`),
      fullPage: true,
    });
    console.log(`[capture] ${padded}/${String(dump.length - 1).padStart(2, '0')} nodes=${graph.nodes.length}`);
  }

  await context.close();
  console.log(`[capture] 完成 ${indices.length} 张截图 → ${outputDir}`);
}

// CLI：支持 --only=N 单条重截
const onlyArg = process.argv.find((a) => a.startsWith('--only='));
const onlyIndex = onlyArg ? parseInt(onlyArg.slice('--only='.length), 10) : undefined;
void captureScreenshots(undefined, undefined, onlyIndex);
