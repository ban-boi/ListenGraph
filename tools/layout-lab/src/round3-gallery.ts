import fs from 'node:fs';
import path from 'node:path';
import type { MergedGraph } from '@listen-graphic/schema';
import { computeBaselinePositions } from './baseline-layout';
import { computeClusterForceLayout } from './cluster-force-layout';
import { computeLayoutMetrics, type Position, type LayoutMetrics } from './cluster-internal-layouts';
import { computeAllNodeSizes } from './round3-types';

const ROOT = path.resolve(import.meta.dirname, '..');
const SHOT_DIR = path.join(ROOT, 'outputs/round3-screenshots');
const DUMP_PATH = path.join(ROOT, 'inputs/real-graphs-dump.json');

const SAMPLE_INDICES = [
  49, 41, 48, 34, 47, 40, 29, 28, 39, 61, 31, 46,
  37, 32, 58, 57,
  18, 21, 16, 12, 6,
  33, 51,
];

function category(idx: number): 'large' | 'small' {
  return idx >= 30 || [49, 41, 48, 34, 47, 40, 29, 28, 39, 61, 31, 46, 37, 32, 33, 51].includes(idx) ? 'large' : 'small';
}

// Extract positions from RenderModel items (fullNode only)
function extractPositions(items: Array<{ kind: string; nodeId?: string; position?: Position }>): Record<string, Position> {
  const positions: Record<string, Position> = {};
  for (const item of items) {
    if (item.kind === 'fullNode' && item.nodeId && item.position) {
      positions[item.nodeId] = item.position;
    }
  }
  return positions;
}

// Count node overlap pairs (separate from edgeCrossings)
// sizes 参数控制用固定还是自适应尺寸
function countOverlaps(
  positions: Record<string, Position>,
  graph: MergedGraph,
  sizes: Record<string, { width: number; height: number }>,
): number {
  const ids = Object.keys(positions);
  let overlaps = 0;
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
      if (overlap) overlaps++;
    }
  }
  return overlaps;
}

export function renderRound3Gallery(): void {
  const dump = JSON.parse(fs.readFileSync(DUMP_PATH, 'utf8')) as MergedGraph[];
  const rows: string[] = [];
  const reviewTemplate: unknown[] = [];
  const allMetrics: unknown[] = [];

  for (const idx of SAMPLE_INDICES) {
    const graph = dump[idx];
    if (!graph) continue;
    const padded = String(idx).padStart(2, '0');
    const cat = category(idx);
    const shot = (c: string) => {
      const p = path.join(SHOT_DIR, `${padded}-${c}.png`);
      return fs.existsSync(p) ? `round3-screenshots/${padded}-${c}.png` : '';
    };

    const baseline = computeBaselinePositions(graph, idx);
    const r3a = computeClusterForceLayout(graph, idx, 'R3a');
    const r3b = computeClusterForceLayout(graph, idx, 'R3b');

    const bp = extractPositions(baseline.items);
    const ap = extractPositions(r3a.items);
    const bp2 = extractPositions(r3b.items);

    // 尺寸口径修正：baseline 用固定 220×132（产品实际），R3 用自适应尺寸
    const adaptiveSizes = computeAllNodeSizes(graph.nodes);
    const fixedSizes: Record<string, { width: number; height: number }> = {};
    for (const n of graph.nodes) fixedSizes[n.id] = { width: 220, height: 132 };

    const bm = computeLayoutMetrics(graph.nodes, graph.edges, bp, 220, 132, fixedSizes);
    const am = computeLayoutMetrics(graph.nodes, graph.edges, ap, 220, 132, adaptiveSizes);
    const bm2 = computeLayoutMetrics(graph.nodes, graph.edges, bp2, 220, 132, adaptiveSizes);

    // countOverlaps 同理：baseline 用固定尺寸
    const bo = countOverlaps(bp, graph, fixedSizes);
    const ao = countOverlaps(ap, graph, adaptiveSizes);
    const bo2 = countOverlaps(bp2, graph, adaptiveSizes);

    const metricsStr = (m: LayoutMetrics, overlaps: number) =>
      `宽高比:${m.aspectRatio.toFixed(2)} 边长:${m.avgEdgeLength} 长边:${(m.longEdgeRatio * 100).toFixed(0)}% 穿越:${m.edgeCrossings} 重叠:${overlaps}`;

    rows.push(`
      <div class="graph-row" data-index="${idx}" data-category="${cat}">
        <h3>#${idx} <span class="cat cat-${cat}">${cat === 'large' ? '大图' : '小图'}</span></h3>
        <div class="candidates">
          <div class="cand"><h4>Baseline</h4><div class="metrics">${metricsStr(bm, bo)}</div><img src="${shot('baseline')}" loading="lazy" /></div>
          <div class="cand"><h4>R3a（引力收窄）</h4><div class="metrics">${metricsStr(am, ao)}</div><img src="${shot('R3a')}" loading="lazy" /></div>
          <div class="cand"><h4>R3b（宽度惩罚）</h4><div class="metrics">${metricsStr(bm2, bo2)}</div><img src="${shot('R3b')}" loading="lazy" /></div>
        </div>
      </div>
    `);

    reviewTemplate.push({
      graphIndex: idx, category: cat,
      r3aWinner: '', r3aVsBaseline: '', r3bWinner: '', r3bVsBaseline: '',
      r3aVsR3b: '', smallHarm: cat === 'small' ? '' : null, notes: '',
    });

    allMetrics.push({
      graphIndex: idx, category: cat,
      baseline: { ...bm, overlaps: bo },
      r3a: { ...am, overlaps: ao },
      r3b: { ...bm2, overlaps: bo2 },
    });
  }

  const html = `<!DOCTYPE html><html lang="zh"><head><meta charset="utf-8"><title>Round 3 Force Layout A/B</title>
<style>
body{font-family:system-ui,sans-serif;margin:16px;background:#fafafa}
.graph-row{background:#fff;border:1px solid #ddd;border-radius:6px;padding:12px;margin-bottom:16px}
.candidates{display:flex;gap:12px}
.cand{flex:1;min-width:0}
.cand img{width:100%;border:1px solid #eee;border-radius:4px;margin-top:4px}
.metrics{font-size:11px;color:#666;background:#f5f5f5;padding:4px 6px;border-radius:3px}
.cat{font-size:11px;padding:1px 6px;border-radius:3px;color:#fff}
.cat-large{background:#d97706}.cat-small{background:#16a34a}
h3{margin:0 0 8px}h4{margin:0;font-size:13px;color:#666}
</style></head><body>
<h1>Round 3: 受约束力导向 + 自适应节点</h1>
<p>${SAMPLE_INDICES.length} 条图 × 3 候选。R3a/R3b 各自独立评分，任一满足门槛即 GO。</p>
<p>门槛：大图 70%+ 优于 baseline、小图不超 20% 更差、重叠率中位数 <30%、宽高比中位数 <0.5</p>
${rows.join('')}
</body></html>`;

  fs.writeFileSync(path.join(ROOT, 'outputs/round3-gallery.html'), html);
  fs.writeFileSync(path.join(ROOT, 'outputs/round3-human-review-template.json'), JSON.stringify(reviewTemplate, null, 2));
  fs.writeFileSync(path.join(ROOT, 'outputs/round3-metrics.json'), JSON.stringify(allMetrics, null, 2));
  console.log(`[round3-gallery] 完成 → gallery + review-template + metrics`);
}

renderRound3Gallery();
