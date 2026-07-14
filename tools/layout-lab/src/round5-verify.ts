/**
 * Round 5 验证：23 条 × stable/r3b 截图 + sequence 增量 + p95 + DOM 指标
 *
 * 注意：prod `build` 不含 fixture API，无法 loadGraph。
 * stable 对照使用 `build:fixture-lab`（稳定布局 + fixture），
 * r3b 使用 `build:r3b:fixture-lab`。
 *
 * Usage（需先构建两个 dist）:
 *   pnpm --filter extension build:fixture-lab
 *   # copy dist → dist-stable-fixture
 *   pnpm --filter extension build:r3b:fixture-lab
 *   cd tools/layout-lab/run && npx tsx ../src/round5-verify.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium, type BrowserContext, type Page } from '@playwright/test';
import type { MergedGraph } from '@listen-graphic/schema';
import {
  computeIncrementalLayout,
  computeAllNodeSizes,
  createEmptyIncrementalState,
} from '../../../packages/graph-renderers/src/r3b/index.ts';
import { waitForFixtureReady, waitForFixtureGraph, stabilizeForScreenshot } from './e2e-helpers';
import { nearestRankPercentile } from './layout-metrics-v2';
import { computeDomLayoutMetrics, type DomRect } from './dom-metrics';
import {
  evaluateRound5Gate,
  type Round5Summary,
  type SampleMetrics,
} from './round5-gates';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const DUMP = path.resolve(import.meta.dirname, '../inputs/real-graphs-dump.json');
const OUT = path.resolve(import.meta.dirname, '../outputs/round5');
const USER_DATA = path.resolve(import.meta.dirname, '../.tmp/round5-user-data');

/** 前 16 = large，后 7 = small（与 Round5 plan 对齐） */
const SAMPLE_INDICES = [
  49, 41, 48, 34, 47, 40, 29, 28, 39, 61, 31, 46,
  37, 32, 58, 57,
  18, 21, 16, 12, 6,
  33, 51,
];
const LARGE_INDICES = SAMPLE_INDICES.slice(0, 16);
const SMALL_INDICES = SAMPLE_INDICES.slice(16);

/** JSON-safe sentinel when React commit p95 was not measured (shots skipped). */
const REACT_COMMIT_P95_SKIPPED = 9999;

const DIST_STABLE = path.resolve(ROOT, 'apps/extension/dist-stable-fixture');
const DIST_R3B = path.resolve(ROOT, 'apps/extension/dist');

async function launchExt(distPath: string, userDataDir: string): Promise<{
  context: BrowserContext;
  extensionId: string;
}> {
  fs.mkdirSync(userDataDir, { recursive: true });
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    headless: true,
    args: [
      `--disable-extensions-except=${distPath}`,
      `--load-extension=${distPath}`,
    ],
  });
  let [serviceWorker] = context.serviceWorkers();
  if (!serviceWorker) serviceWorker = await context.waitForEvent('serviceworker');
  const extensionId = serviceWorker.url().split('/')[2];
  return { context, extensionId };
}

async function openSidepanel(context: BrowserContext, extensionId: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await page.waitForLoadState('domcontentloaded');
  await waitForFixtureReady(page);
  return page;
}

async function collectDomRects(page: Page): Promise<DomRect[]> {
  return page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('[data-testid^="graph-node-card-"]'));
    return cards.map((el) => {
      const r = el.getBoundingClientRect();
      return {
        id: el.getAttribute('data-testid') ?? '',
        left: r.left,
        top: r.top,
        right: r.right,
        bottom: r.bottom,
      };
    });
  });
}

function toSampleMetrics(m: ReturnType<typeof computeDomLayoutMetrics>): SampleMetrics {
  return {
    avgEdgeLength: m.avgEdgeLength,
    overlapPairs: m.overlapPairs,
    clearanceViolationPairs: m.clearanceViolationPairs,
    pairCount: m.pairCount,
    edgeEdgeCrossings: m.edgeEdgeCrossings,
    nodeCount: m.nodeCount,
  };
}

async function measureReactCommitP95(page: Page, graph: MergedGraph): Promise<number> {
  const times: number[] = [];
  for (let i = 0; i < 10; i++) {
    // Avoid nested named fns inside evaluate — tsx/esbuild keepNames injects
    // `__name(...)` which is undefined in the browser page context.
    const ms = await page.evaluate(async (g) => {
      const t0 = performance.now();
      globalThis.__listenGraphicFixture?.loadGraph(g);
      const deadline = performance.now() + 10000;
      for (;;) {
        const n = document.querySelectorAll('[data-testid^="graph-node-card-"]').length;
        if (n >= g.nodes.length) break;
        if (performance.now() > deadline) throw new Error('commit timeout');
        await new Promise<void>((r) => {
          requestAnimationFrame(() => r());
        });
      }
      return performance.now() - t0;
    }, graph);
    times.push(ms);
  }
  times.sort((a, b) => a - b);
  return nearestRankPercentile(times, 95);
}

async function captureVariant(
  label: 'stable' | 'r3b',
  distPath: string,
  dump: MergedGraph[],
): Promise<{ metrics: Record<number, SampleMetrics>; reactCommitP95?: number }> {
  const outDir = path.join(OUT, `shots-${label}`);
  fs.mkdirSync(outDir, { recursive: true });
  const userData = path.join(USER_DATA, label);
  fs.rmSync(userData, { recursive: true, force: true });

  const { context, extensionId } = await launchExt(distPath, userData);
  const page = await openSidepanel(context, extensionId);
  const metrics: Record<number, SampleMetrics> = {};

  for (const idx of SAMPLE_INDICES) {
    const graph = dump[idx];
    if (!graph) {
      console.warn(`[${label}] #${idx} missing`);
      continue;
    }
    await page.evaluate((g) => {
      globalThis.__listenGraphicFixture?.loadGraph(g);
    }, graph);
    await waitForFixtureGraph(page, graph.nodes.length);
    await stabilizeForScreenshot(page);
    const padded = String(idx).padStart(2, '0');
    await page.screenshot({ path: path.join(outDir, `${padded}-causal.png`), fullPage: true });
    const rects = await collectDomRects(page);
    const edges = graph.edges.map((e) => ({ source: e.source, target: e.target }));
    const dom = computeDomLayoutMetrics(rects, edges, { clearanceThreshold: 16 });
    metrics[idx] = toSampleMetrics(dom);
    console.log(
      `[${label}] #${padded} nodes=${dom.nodeCount} avgEdge=${Math.round(dom.avgEdgeLength)} overlaps=${dom.overlapPairs} crossings=${dom.edgeEdgeCrossings}`,
    );
  }

  let reactCommitP95: number | undefined;
  if (label === 'r3b' && dump[49]) {
    reactCommitP95 = await measureReactCommitP95(page, dump[49]);
    console.log(`[perf] #49 react commit p95=${reactCommitP95.toFixed(1)}ms`);
  }

  await context.close();
  return { metrics, reactCommitP95 };
}

async function verifySequenceIncremental(dump: MergedGraph[]): Promise<void> {
  // Kernel-level: simulate incremental growth with computeIncrementalLayout and assert old nodes stay put
  const base = dump[18];
  if (!base) throw new Error('dump[18] missing for sequence kernel check');

  let state = createEmptyIncrementalState();
  const g1 = {
    ...base,
    revision: 1,
    nodes: base.nodes.slice(0, Math.min(8, base.nodes.length)),
    edges: base.edges.filter(
      (e) =>
        base.nodes.slice(0, 8).some((n) => n.id === e.source) &&
        base.nodes.slice(0, 8).some((n) => n.id === e.target),
    ),
  };
  const sizes1 = computeAllNodeSizes(g1.nodes);
  const r1 = computeIncrementalLayout(g1, state, 'R3b', sizes1);
  state = r1.state;

  const g2Nodes = base.nodes.slice(0, Math.min(12, base.nodes.length));
  const g2 = {
    ...base,
    revision: 2,
    nodes: g2Nodes,
    edges: base.edges.filter(
      (e) => g2Nodes.some((n) => n.id === e.source) && g2Nodes.some((n) => n.id === e.target),
    ),
  };
  const sizes2 = computeAllNodeSizes(g2.nodes);
  const r2 = computeIncrementalLayout(g2, state, 'R3b', sizes2);

  let maxOldDrift = 0;
  for (const n of g1.nodes) {
    const a = r1.positions[n.id];
    const b = r2.positions[n.id];
    if (a && b) maxOldDrift = Math.max(maxOldDrift, Math.hypot(a.cx - b.cx, a.cy - b.cy));
  }
  console.log(`[sequence] old-node max drift = ${maxOldDrift.toFixed(3)}px (expect 0)`);
  if (maxOldDrift > 0.01) {
    throw new Error(`sequence incremental failed: old nodes moved ${maxOldDrift}px`);
  }
}

function measureP95(dump: MergedGraph[]): { p95: number; times: number[]; ok: boolean } {
  const graph = dump[49];
  if (!graph) throw new Error('dump[49] missing');
  const sizes = computeAllNodeSizes(graph.nodes);
  for (let i = 0; i < 3; i++) {
    computeIncrementalLayout(graph, createEmptyIncrementalState(), 'R3b', sizes);
  }
  const times: number[] = [];
  for (let i = 0; i < 10; i++) {
    const t0 = performance.now();
    computeIncrementalLayout(graph, createEmptyIncrementalState(), 'R3b', sizes);
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  const p95 = nearestRankPercentile(times, 95);
  console.log(
    `[perf] #49 computeIncrementalLayout times(ms)=${times.map((t) => t.toFixed(1)).join(',')} p95=${p95.toFixed(1)}`,
  );
  const ok = p95 < 200;
  if (!ok) {
    console.error(`[perf] FAIL: compute p95 ${p95.toFixed(1)}ms >= 200ms`);
  }
  return { p95, times, ok };
}

function writeSummaryAndExit(summary: Round5Summary): never {
  const gate = evaluateRound5Gate(summary);
  fs.writeFileSync(
    path.join(OUT, 'summary.json'),
    JSON.stringify({ ...summary, gate }, null, 2),
  );
  if (gate.code !== 0) {
    console.error('[round5] FAIL:\n - ' + gate.failures.join('\n - '));
    process.exit(1);
  }
  console.log('[round5] PASS');
  process.exit(0);
}

async function main(): Promise<void> {
  if (!fs.existsSync(DUMP)) throw new Error(`missing dump: ${DUMP}`);
  const dump = JSON.parse(fs.readFileSync(DUMP, 'utf8')) as MergedGraph[];
  fs.mkdirSync(OUT, { recursive: true });

  console.log('=== Step: p95 perf (#49) ===');
  const perfKernel = measureP95(dump);

  console.log('=== Step: sequence incremental (kernel) ===');
  await verifySequenceIncremental(dump);

  const hasStable =
    fs.existsSync(path.join(DIST_STABLE, 'sidepanel', 'sidepanel.js')) ||
    fs.existsSync(path.join(DIST_STABLE, 'manifest.json'));
  const hasR3b =
    fs.existsSync(path.join(DIST_R3B, 'sidepanel', 'sidepanel.js')) ||
    fs.existsSync(path.join(DIST_R3B, 'manifest.json'));

  if (!hasStable || !hasR3b) {
    console.warn(`[shots] skip screenshots: stable=${hasStable} r3b=${hasR3b}`);
    console.warn(`  Prepare with:`);
    console.warn(
      `    pnpm --filter extension build:fixture-lab && xcopy /E /I /Y apps\\extension\\dist apps\\extension\\dist-stable-fixture`,
    );
    console.warn(`    pnpm --filter extension build:r3b:fixture-lab`);
    console.warn(`  Then re-run this script.`);
    writeSummaryAndExit({
      shotsSkipped: true,
      sampleIndices: SAMPLE_INDICES,
      largeIndices: LARGE_INDICES,
      smallIndices: SMALL_INDICES,
      stableMetrics: {},
      r3bMetrics: {},
      perf: {
        computeP95: perfKernel.p95,
        reactCommitP95: REACT_COMMIT_P95_SKIPPED,
        ok: perfKernel.ok,
      },
      sequenceOk: true,
    });
  }

  console.log('=== Step: capture stable fixture-lab ===');
  const stable = await captureVariant('stable', DIST_STABLE, dump);
  console.log('=== Step: capture r3b fixture-lab ===');
  const r3b = await captureVariant('r3b', DIST_R3B, dump);

  const reactCommitP95 = r3b.reactCommitP95 ?? REACT_COMMIT_P95_SKIPPED;
  writeSummaryAndExit({
    shotsSkipped: false,
    sampleIndices: SAMPLE_INDICES,
    largeIndices: LARGE_INDICES,
    smallIndices: SMALL_INDICES,
    stableMetrics: stable.metrics,
    r3bMetrics: r3b.metrics,
    perf: {
      computeP95: perfKernel.p95,
      reactCommitP95,
      ok: perfKernel.ok,
    },
    sequenceOk: true,
  });
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
