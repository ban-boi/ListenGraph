import fs from 'node:fs';
import path from 'node:path';
import type { MergedGraph } from '@listen-graphic/schema';
import { computeBaselinePositions } from './baseline-layout';
import { computeClusterLayoutA } from './cluster-layout';
import { computeClusterLayoutB } from './cluster-overview';

const ROOT = path.resolve(import.meta.dirname, '..');
const SHOT_DIR = path.join(ROOT, 'outputs/round2-screenshots');
const DUMP_PATH = path.join(ROOT, 'inputs/real-graphs-dump.json');

const SAMPLE_INDICES = [
  49, 41, 48, 34, 47, 40, 29, 28, 39, 61, 31, 46,
  37, 32, 58, 57,
  18, 21, 16, 12, 6,
  33, 51,
];

function category(idx: number): 'large' | 'small' {
  return idx >= 30 || [49, 41, 48, 34, 47, 40, 29, 28, 39, 61, 31, 46, 37, 32, 33, 51].includes(idx)
    ? 'large' : 'small';
}

export function renderRound2Gallery(): void {
  const dump = JSON.parse(fs.readFileSync(DUMP_PATH, 'utf8')) as MergedGraph[];
  const rows: string[] = [];
  const reviewTemplate: unknown[] = [];

  for (const idx of SAMPLE_INDICES) {
    const graph = dump[idx];
    if (!graph) continue;
    const padded = String(idx).padStart(2, '0');
    const cat = category(idx);
    const shot = (c: string) => {
      const p = path.join(SHOT_DIR, `${padded}-${c}.png`);
      return fs.existsSync(p) ? `round2-screenshots/${padded}-${c}.png` : '';
    };

    const baseline = computeBaselinePositions(graph, idx);
    const a = computeClusterLayoutA(graph, idx);
    const b = computeClusterLayoutB(graph, idx);

    const metaStr = (m: typeof baseline.meta) =>
      `${m.nodeCount}节点 ${m.edgeCount}边 ${m.clusterCount}簇(${m.majorCount}M/${m.minorCount}m)`;

    rows.push(`
      <div class="graph-row" data-index="${idx}" data-category="${cat}">
        <h3>#${idx} <span class="cat cat-${cat}">${cat === 'large' ? '大图' : '小图'}</span></h3>
        <div class="metas">
          <span><b>Baseline:</b> ${metaStr(baseline.meta)}</span>
          <span><b>A:</b> ${metaStr(a.meta)}</span>
          <span><b>B:</b> ${metaStr(b.meta)}</span>
        </div>
        <div class="candidates">
          <div class="cand"><h4>Baseline</h4><img src="${shot('baseline')}" loading="lazy" /></div>
          <div class="cand"><h4>Candidate A</h4><img src="${shot('A')}" loading="lazy" /></div>
          <div class="cand"><h4>Candidate B</h4><img src="${shot('B')}" loading="lazy" /></div>
        </div>
      </div>
    `);

    reviewTemplate.push({
      graphIndex: idx,
      category: cat,
      winner: '',
      aVsBaseline: '',
      bVsBaseline: '',
      smallHarm: cat === 'small' ? '' : null,
      notes: '',
    });
  }

  const html = `<!DOCTYPE html><html lang="zh"><head><meta charset="utf-8"><title>Round 2 Cluster-First Layout A/B</title>
<style>
body{font-family:system-ui,sans-serif;margin:16px;background:#fafafa}
.graph-row{background:#fff;border:1px solid #ddd;border-radius:6px;padding:12px;margin-bottom:16px}
.metas{display:flex;gap:16px;font-size:12px;color:#666;margin-bottom:8px}
.candidates{display:flex;gap:12px}
.cand{flex:1;min-width:0}
.cand img{width:100%;border:1px solid #eee;border-radius:4px}
.cat{font-size:11px;padding:1px 6px;border-radius:3px;color:#fff}
.cat-large{background:#d97706}.cat-small{background:#16a34a}
h3{margin:0 0 8px}h4{margin:0 0 4px;font-size:13px;color:#666}
</style></head><body>
<h1>Round 2: Cluster-First Layout A/B 对比</h1>
<p>${SAMPLE_INDICES.length} 条图 × 3 候选。主要看：大图是否不再"一片乱"？主话题能否一眼定位？小图是否没被伤害？</p>
${rows.join('')}
</body></html>`;

  fs.writeFileSync(path.join(ROOT, 'outputs/round2-gallery.html'), html);
  fs.writeFileSync(
    path.join(ROOT, 'outputs/round2-human-review-template.json'),
    JSON.stringify(reviewTemplate, null, 2),
  );
  console.log(`[round2-gallery] 完成 → outputs/round2-gallery.html + round2-human-review-template.json`);
}

renderRound2Gallery();
