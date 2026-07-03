import fs from 'node:fs';
import path from 'node:path';
import type { Annotation, StructureMetrics, DetectorCheck } from './types';

const ROOT = path.resolve(import.meta.dirname, '..');
const readJson = (p: string) => JSON.parse(fs.readFileSync(p, 'utf8'));

// spec 6.1 抽样规则：选待人工详细校正的样本
export function buildReviewSample(
  annotations: Annotation[],
  metrics: Array<{ graphIndex: number; metrics: StructureMetrics; detector: DetectorCheck }>,
): number[] {
  const selected = new Set<number>();
  for (let i = 0; i < annotations.length; i++) {
    const a = annotations[i];
    const m = metrics[i].metrics;
    // 1. 低置信
    if (a.confidence === 'low') selected.add(i);
    // 2. 大图（10+ 节点）
    if (m.isLargeGraph) selected.add(i);
    // 3. detector/LLM 冲突
    if (a.detectorMismatch) selected.add(i);
    // 4. opposesCrossSpeakerRatio 极端值
    if (m.opposesCrossSpeakerRatio !== null && m.opposesCrossSpeakerRatio > 0.5) {
      selected.add(i);
    }
    if ((m.opposesCount ?? 0) > 0 && m.opposesCrossSpeakerRatio === 0) {
      selected.add(i);
    }
  }
  return Array.from(selected).sort((a, b) => a - b);
}

export function renderGallery(): void {
  const metricsDir = path.join(ROOT, 'outputs/metrics');
  const annotationsDir = path.join(ROOT, 'outputs/annotations');
  const screenshotsDir = path.join(ROOT, 'outputs/screenshots');

  const metricFiles = fs
    .readdirSync(metricsDir)
    .filter((f) => f.endsWith('.json'))
    .sort((a, b) => parseInt(a, 10) - parseInt(b, 10));

  const rows: string[] = [];
  const annotations: Array<Annotation | null> = [];
  const metricsMeta: Array<{ graphIndex: number; metrics: StructureMetrics; detector: DetectorCheck }> = [];

  for (const f of metricFiles) {
    const i = parseInt(f, 10);
    const padded = String(i).padStart(2, '0');
    const m = readJson(path.join(metricsDir, f));
    metricsMeta.push(m);

    // annotation 可能不存在（Task 8 未跑或部分跑）
    let a: Annotation | null = null;
    try {
      a = readJson(path.join(annotationsDir, `${padded}.json`));
    } catch {
      // 无 annotation
    }
    annotations.push(a);

    const shotPath = path.join(screenshotsDir, `${padded}.png`);
    const shotSrc = fs.existsSync(shotPath) ? `screenshots/${padded}.png` : '';

    const mm = m.metrics;
    rows.push(`
      <div class="card" data-index="${i}">
        <h3>#${i} <span class="det">${m.detector.pattern}</span> ${a?.confidence ? `<span class="conf conf-${a.confidence}">${a.confidence}</span>` : ''}</h3>
        <img src="${shotSrc}" loading="lazy" alt="graph ${i}" />
        <pre>nodes=${mm.nodeCount} edges=${mm.edgeCount} opposes=${mm.opposesCount} (ratio=${mm.opposesRatio ?? '-'}) crossSpk=${mm.opposesCrossSpeakerRatio ?? '-'} longLabel=${mm.longLabelNodeCount} components=${mm.connectedComponents}</pre>
        ${a ? `<p><b>语义：</b>${escapeHtml(a.semanticReading)}</p><p><b>失败：</b>${escapeHtml(a.layoutFailures.join('；'))}</p><p><b>处理：</b>${escapeHtml(a.visualTreatment)}</p>${a.detectorMismatch ? '<p class="mismatch">⚠ detector 可能误导</p>' : ''}` : '<p class="missing">（无 annotation — 需先跑 llm-annotate）</p>'}
      </div>
    `);
  }

  // 无 annotation 的图视为低置信（强制入选待审），避免漏审
  const safeAnnotations: Annotation[] = annotations.map((a, i) => a ?? {
    graphIndex: i,
    semanticReading: '(未标注)',
    layoutFailures: [],
    detectorMismatch: false,
    visualTreatment: '',
    confidence: 'low' as const,
  });
  const sample = buildReviewSample(safeAnnotations, metricsMeta);

  fs.mkdirSync(path.join(ROOT, 'outputs'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'outputs/review-sample.json'), JSON.stringify(sample, null, 2));

  const html = `<!DOCTYPE html><html lang="zh"><head><meta charset="utf-8"><title>第 1 轮布局诊断 Gallery</title>
<style>
body{font-family:system-ui,sans-serif;margin:16px;background:#fafafa;color:#222}
h1{font-size:20px}
.summary{background:#fff;padding:10px 14px;border-radius:6px;margin-bottom:16px;border:1px solid #ddd}
.card{background:#fff;border:1px solid #ddd;border-radius:6px;padding:12px;margin-bottom:12px}
.card h3{margin:0 0 8px;font-size:14px}
.card img{max-width:100%;max-height:500px;border:1px solid #eee;border-radius:4px;display:block;margin:6px 0}
.det{background:#eef;padding:1px 6px;border-radius:3px;font-size:12px}
.conf{font-size:11px;padding:1px 5px;border-radius:3px;color:#fff}
.conf-high{background:#16a34a}.conf-medium{background:#d97706}.conf-low{background:#dc2626}
pre{font-size:11px;background:#f5f5f5;padding:6px;border-radius:3px;overflow-x:auto}
.mismatch{color:#dc2626;font-weight:600}
.missing{color:#999;font-style:italic}
</style>
</head><body>
<h1>第 1 轮布局诊断 Gallery</h1>
<div class="summary">共 ${metricFiles.length} 条图 ｜ 待人工详细校正：<b>${sample.length}</b> 条（见 review-sample.json）｜ 全量缩略图建议快速扫一遍</div>
${rows.join('')}
</body></html>`;
  fs.writeFileSync(path.join(ROOT, 'outputs/gallery.html'), html);
  console.log(`[gallery] 完成 → outputs/gallery.html，待校正 ${sample.length} 条 → outputs/review-sample.json`);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

renderGallery();
