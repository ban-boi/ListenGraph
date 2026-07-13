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
import type { MergedGraph } from '@listen-graphic/schema';

// 计算节点重叠对数（spec 7.4 要求，独立于 edgeCrossings）
function countOverlapPairs(
  positions: Record<string, Position>,
  graph: MergedGraph,
  sizes: Record<string, { width: number; height: number }>,
): number {
  const ids = Object.keys(positions);
  let count = 0;
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = positions[ids[i]], b = positions[ids[j]];
      const sa = sizes[ids[i]] ?? { width: 220, height: 132 };
      const sb = sizes[ids[j]] ?? { width: 220, height: 132 };
      const overlap = !(
        a.x + sa.width + 10 <= b.x ||
        b.x + sb.width + 10 <= a.x ||
        a.y + sa.height + 10 <= b.y ||
        b.y + sb.height + 10 <= a.y
      );
      if (overlap) count++;
    }
  }
  return count;
}

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

    // Pass 1: 计算所有 revision 的三候选 + 收集 incr 位置（用于后续统一 shift）
    const revResults: Array<{
      graph: MergedGraph; rev: number;
      baseline: ReturnType<typeof computeBaselinePositions>;
      r3bFull: ReturnType<typeof computeClusterForceLayout>;
      r3bIncr: ReturnType<typeof computeIncrementalLayout>;
    }> = [];

    // 全局坐标偏移量：取最终 revision 的 incr min 坐标作为统一 shift
    let globalShiftX = 0, globalShiftY = 0;
    let globalMaxX = 0, globalMaxY = 0;

    for (let rev = 0; rev < seq.revisions.length; rev++) {
      const graph = seq.revisions[rev];
      const baseline = computeBaselinePositions(graph, rev);
      const r3bFull = computeClusterForceLayout(graph, rev, 'R3b');
      const r3bIncr = computeIncrementalLayout(graph, incrState);
      incrState = r3bIncr.state;
      revResults.push({ graph, rev, baseline, r3bFull, r3bIncr });
    }

    // 计算统一 shift：扫描所有 revision 的 incr 位置，找到全局 minX/minY
    for (const r of revResults) {
      const adaptiveSizes = computeAllNodeSizes(r.graph.nodes);
      for (const n of r.graph.nodes) {
        const pos = r.r3bIncr.positions[n.id];
        const size = adaptiveSizes[n.id];
        if (pos && size) {
          const tlX = pos.cx - size.width / 2;
          const tlY = pos.cy - size.height / 2;
          if (tlX < globalShiftX) globalShiftX = tlX;
          if (tlY < globalShiftY) globalShiftY = tlY;
          if (tlX + size.width > globalMaxX) globalMaxX = tlX + size.width;
          if (tlY + size.height > globalMaxY) globalMaxY = tlY + size.height;
        }
      }
    }
    // shift 让全局 min ≥ 0，画布尺寸 = 全局 max - shift
    const fixedCanvas = {
      width: Math.round(globalMaxX - globalShiftX),
      height: Math.round(globalMaxY - globalShiftY),
    };

    // Pass 2: 渲染 HTML（incr 用全局 shift + 固定画布）
    for (const r of revResults) {
      const { graph, rev, baseline, r3bFull, r3bIncr } = r;
      const padded = String(rev).padStart(2, '0');
      const prefix = `${seq.name}-${padded}`;
      const adaptiveSizes = computeAllNodeSizes(graph.nodes);

      renderModelToHtml(baseline, graph, path.join(HTML_DIR, `${prefix}-baseline.html`));
      renderModelToHtmlV2(r3bFull, graph, path.join(HTML_DIR, `${prefix}-r3bfull.html`));

      // Incremental：用全局 shift 而非每帧独立 normalize
      const incrItems = graph.nodes.map((n) => {
        const pos = r3bIncr.positions[n.id];
        if (!pos) return null;
        const size = adaptiveSizes[n.id];
        return { kind: 'fullNode' as const, nodeId: n.id, position: { x: pos.cx - size.width / 2 - globalShiftX, y: pos.cy - size.height / 2 - globalShiftY } };
      }).filter((x): x is NonNullable<typeof x> => x !== null);
      const incrEdges = graph.edges
        .filter((e) => r3bIncr.positions[e.source] && r3bIncr.positions[e.target])
        .map((e) => ({ source: e.source, target: e.target, type: e.type }));
      const incrModel: RenderModel = {
        items: incrItems, edges: incrEdges, clusters: [],
        meta: { candidate: 'R3b', graphIndex: rev, nodeCount: graph.nodes.length, edgeCount: graph.edges.length, clusterCount: 0, majorCount: 0, minorCount: 0 },
      };
      renderModelToHtmlV2(incrModel, graph, path.join(HTML_DIR, `${prefix}-incr.html`), fixedCanvas);

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

      const bo = countOverlapPairs(bp, graph, fixedSizes);
      const fo = countOverlapPairs(fp, graph, adaptiveSizes);
      const io = countOverlapPairs(ipPositions, graph, adaptiveSizes);

      revMetrics.push({
        revision: rev, nodeCount: graph.nodes.length, edgeCount: graph.edges.length,
        baseline: { ...bm, overlapPairs: bo },
        r3bFull: { ...fm, overlapPairs: fo },
        r3bIncremental: { ...im, overlapPairs: io, displacement: r3bIncr.stats },
      });

      const s = r3bIncr.stats;
      console.log(`  rev ${padded}: ${graph.nodes.length}n | incr: median=${s?.medianDisplacement ?? '-'}px max=${s?.maxDisplacement ?? '-'}px cap=${s ? (s.capHitRate * 100).toFixed(0) + '%' : '-'} overlap=${io}`);
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
