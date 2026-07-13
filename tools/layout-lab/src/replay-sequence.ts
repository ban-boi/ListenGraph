import fs from 'node:fs';
import path from 'node:path';
import type { MergedGraph } from '@listen-graphic/schema';
import { chromium } from '@playwright/test';
import { computeBaselinePositions } from './baseline-layout';
import { computeClusterForceLayout } from './cluster-force-layout';
import { computeIncrementalLayout } from './incremental-force';
import { createEmptyIncrementalState, type IncrementalState } from './incremental-types';
import { splitGraphByTimestamp } from './split-real-graph';
import { renderModelToHtml } from './html-renderer';
import { renderModelToHtmlV2 } from './html-renderer-v2';
import { computeLayoutMetrics, type Position } from './cluster-internal-layouts';
import { computeAllNodeSizes } from './round3-types';
import type { RenderModel } from './round2-types';

const DUMP_PATH = path.resolve(import.meta.dirname, '../inputs/real-graphs-dump.json');
const FIXTURE_DIR = path.resolve(import.meta.dirname, '../../../packages/graph-fixtures/fixtures/sequences');
const HTML_DIR = path.resolve(import.meta.dirname, '../outputs/round4-html');
const SHOT_DIR = path.resolve(import.meta.dirname, '../outputs/round4-screenshots');
const METRICS_PATH = path.resolve(import.meta.dirname, '../outputs/round4-metrics.json');

function extractPositions(items: Array<{ kind: string; nodeId?: string; position?: Position }>): Record<string, Position> {
  const pos: Record<string, Position> = {};
  for (const item of items) {
    if (item.kind === 'fullNode' && item.nodeId && item.position) pos[item.nodeId] = item.position;
  }
  return pos;
}

function loadSequences(): Array<{ name: string; revisions: MergedGraph[]; trackNodeIds: string[] }> {
  const sequences: Array<{ name: string; revisions: MergedGraph[]; trackNodeIds: string[] }> = [];

  // Fixture sequences
  for (const name of ['seq-incremental-growth', 'seq-late-burst', 'seq-pattern-question-incremental']) {
    try {
      const fixture = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, `${name}.json`), 'utf8'));
      const revisions = (fixture.steps ?? []).map((s: { graph: MergedGraph }) => s.graph);
      const trackNodeIds = revisions[0]?.nodes?.slice(0, 3).map((n: { id: string }) => n.id) ?? [];
      sequences.push({ name, revisions, trackNodeIds });
    } catch (e) { console.warn(`[replay] fixture ${name} 加载失败: ${(e as Error).message}`); }
  }

  // Real graph splits
  const dump = JSON.parse(fs.readFileSync(DUMP_PATH, 'utf8')) as MergedGraph[];
  for (const idx of [49, 41, 32]) {
    const revisions = splitGraphByTimestamp(dump[idx]); // 真实节奏：每个 timestamp 一批
    const trackNodeIds = revisions[0]?.nodes?.slice(0, 3).map((n) => n.id) ?? [];
    sequences.push({ name: `real-${idx}`, revisions, trackNodeIds });
  }

  return sequences;
}

export async function replayAll(): Promise<void> {
  const sequences = loadSequences();
  fs.mkdirSync(HTML_DIR, { recursive: true });
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const allMetrics: unknown[] = [];

  for (const seq of sequences) {
    console.log(`\n[replay] ${seq.name} (${seq.revisions.length} revisions)`);
    let incrState: IncrementalState = createEmptyIncrementalState();
    const revMetrics: unknown[] = [];

    for (let rev = 0; rev < seq.revisions.length; rev++) {
      const graph = seq.revisions[rev];
      const padded = String(rev).padStart(2, '0');
      const prefix = `${seq.name}-${padded}`;

      // Three candidates
      const baseline = computeBaselinePositions(graph, rev);
      const r3bFull = computeClusterForceLayout(graph, rev, 'R3b');
      const r3bIncr = computeIncrementalLayout(graph, incrState);
      incrState = r3bIncr.state;

      // HTML
      renderModelToHtml(baseline, graph, path.join(HTML_DIR, `${prefix}-baseline.html`));
      renderModelToHtmlV2(r3bFull, graph, path.join(HTML_DIR, `${prefix}-r3bfull.html`));

      // Incremental → manual RenderModel (center → top-left)
      const adaptiveSizes = computeAllNodeSizes(graph.nodes);
      const incrItems = graph.nodes.map((n) => {
        const pos = r3bIncr.positions[n.id];
        if (!pos) return null;
        const size = adaptiveSizes[n.id];
        return { kind: 'fullNode' as const, nodeId: n.id, position: { x: pos.cx - size.width / 2, y: pos.cy - size.height / 2 } };
      }).filter((x): x is NonNullable<typeof x> => x !== null);
      const incrEdges = graph.edges
        .filter((e) => r3bIncr.positions[e.source] && r3bIncr.positions[e.target])
        .map((e) => ({ source: e.source, target: e.target, type: e.type }));
      const incrModel: RenderModel = {
        items: incrItems, edges: incrEdges, clusters: [],
        meta: { candidate: 'R3b', graphIndex: rev, nodeCount: graph.nodes.length, edgeCount: graph.edges.length, clusterCount: 0, majorCount: 0, minorCount: 0 },
      };
      renderModelToHtmlV2(incrModel, graph, path.join(HTML_DIR, `${prefix}-incr.html`));

      // Metrics
      const fixedSizes: Record<string, { width: number; height: number }> = {};
      for (const n of graph.nodes) fixedSizes[n.id] = { width: 220, height: 132 };
      const bp = extractPositions(baseline.items);
      const fp = extractPositions(r3bFull.items);
      const ipPositions: Record<string, Position> = {};
      for (const n of graph.nodes) {
        const pos = r3bIncr.positions[n.id];
        const size = adaptiveSizes[n.id];
        if (pos && size) ipPositions[n.id] = { x: pos.cx - size.width / 2, y: pos.cy - size.height / 2 };
      }

      const bm = computeLayoutMetrics(graph.nodes, graph.edges, bp, 220, 132, fixedSizes);
      const fm = computeLayoutMetrics(graph.nodes, graph.edges, fp, 220, 132, adaptiveSizes);
      const im = computeLayoutMetrics(graph.nodes, graph.edges, ipPositions, 220, 132, adaptiveSizes);

      revMetrics.push({
        revision: rev, nodeCount: graph.nodes.length, edgeCount: graph.edges.length,
        baseline: bm, r3bFull: fm,
        r3bIncremental: { ...im, displacement: r3bIncr.stats },
      });

      const s = r3bIncr.stats;
      console.log(`  rev ${padded}: ${graph.nodes.length}n | incr: median=${s?.medianDisplacement ?? '-'}px max=${s?.maxDisplacement ?? '-'}px cap=${s ? (s.capHitRate * 100).toFixed(0) + '%' : '-'}`);
    }

    allMetrics.push({ sequence: seq.name, trackNodeIds: seq.trackNodeIds, revisions: revMetrics });
  }

  fs.writeFileSync(METRICS_PATH, JSON.stringify(allMetrics, null, 2));
  console.log(`\n[replay] metrics → ${METRICS_PATH}`);

  // Screenshots
  const browser = await chromium.launch({ headless: true });
  for (const seq of sequences) {
    for (let rev = 0; rev < seq.revisions.length; rev++) {
      const padded = String(rev).padStart(2, '0');
      const prefix = `${seq.name}-${padded}`;
      for (const cand of ['baseline', 'r3bfull', 'incr'] as const) {
        const htmlPath = path.join(HTML_DIR, `${prefix}-${cand}.html`);
        if (!fs.existsSync(htmlPath)) continue;
        const page = await browser.newPage();
        try {
          await page.goto(`file:///${htmlPath.replace(/\\/g, '/')}`);
          await page.waitForLoadState('domcontentloaded');
          await page.waitForTimeout(200);
          await page.screenshot({ path: path.join(SHOT_DIR, `${prefix}-${cand}.png`), fullPage: true });
        } catch (e) {
          console.warn(`  截图失败 ${prefix}-${cand}: ${(e as Error).message.split('\n')[0]}`);
        }
        await page.close();
      }
    }
  }
  await browser.close();
  console.log(`[replay] 全部完成`);
}

void replayAll();
