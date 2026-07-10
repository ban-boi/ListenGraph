import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const SHOT_DIR = path.join(ROOT, 'outputs/round4-screenshots');
const METRICS_PATH = path.join(ROOT, 'outputs/round4-metrics.json');

export function renderRound4Gallery(): void {
  const metrics = JSON.parse(fs.readFileSync(METRICS_PATH, 'utf8'));
  const rows: string[] = [];

  for (const seqData of metrics) {
    const seqName: string = seqData.sequence;
    const trackNodeIds: string[] = seqData.trackNodeIds ?? [];
    const revisions = seqData.revisions ?? [];
    const revCount = revisions.length;

    const revButtons = Array.from({ length: revCount }, (_, i) =>
      `<button class="rev-btn" data-seq="${seqName}" data-rev="${i}" onclick="showRev('${seqName}',${i})">${i}</button>`
    ).join('');

    const revPanes = revisions.map((rev: any, i: number) => {
      const padded = String(i).padStart(2, '0');
      const prefix = `${seqName}-${padded}`;
      const shot = (c: string) => {
        const p = path.join(SHOT_DIR, `${prefix}-${c}.png`);
        return fs.existsSync(p) ? `round4-screenshots/${prefix}-${c}.png` : '';
      };
      const disp = rev.r3bIncremental?.displacement;
      const dispStr = disp ? `中位:${disp.medianDisplacement}px 最大:${disp.maxDisplacement}px cap:${(disp.capHitRate * 100).toFixed(0)}%` : '首rev';
      return `<div class="rev-pane" id="${seqName}-${i}" style="display:none;">
        <div class="rev-info">rev ${i} · ${rev.nodeCount}节点 · ${dispStr}</div>
        <div class="candidates">
          <div class="cand"><h4>产品 stable</h4><img src="${shot('baseline')}" loading="lazy" /></div>
          <div class="cand"><h4>R3b 全量重算</h4><img src="${shot('r3bfull')}" loading="lazy" /></div>
          <div class="cand"><h4>R3b incremental</h4><img src="${shot('incr')}" loading="lazy" /></div>
        </div>
      </div>`;
    }).join('');

    rows.push(`
      <div class="seq-section">
        <h2>${seqName} <span class="track">追踪: ${trackNodeIds.join(', ')}</span></h2>
        <div class="rev-nav">${revButtons}</div>
        ${revPanes}
      </div>
    `);
  }

  const html = `<!DOCTYPE html><html lang="zh"><head><meta charset="utf-8"><title>Round 4 Incremental Stability</title>
<style>
body{font-family:system-ui,sans-serif;margin:16px;background:#fafafa}
.seq-section{background:#fff;border:1px solid #ddd;border-radius:6px;padding:12px;margin-bottom:20px}
.rev-nav{display:flex;gap:4px;margin-bottom:12px;flex-wrap:wrap}
.rev-btn{padding:4px 10px;border:1px solid #ccc;border-radius:4px;background:#f5f5f5;cursor:pointer;font-size:12px}
.rev-btn:hover{background:#e0e0e0}
.rev-btn.active{background:#3b82f6;color:#fff;border-color:#3b82f6}
.candidates{display:flex;gap:8px}
.cand{flex:1;min-width:0}
.cand img{width:100%;border:1px solid #eee}
.rev-info{font-size:12px;color:#666;margin-bottom:6px}
.track{font-size:11px;color:#999;font-weight:normal}
h2{font-size:15px;margin:0 0 8px}h4{margin:0 0 4px;font-size:12px;color:#666}
</style>
<script>
function showRev(seq, rev) {
  document.querySelectorAll('[id^="' + seq + '-"]').forEach(el => el.style.display = 'none');
  const pane = document.getElementById(seq + '-' + rev);
  if (pane) pane.style.display = 'block';
  document.querySelectorAll('.rev-btn[data-seq="' + seq + '"]').forEach(b => b.classList.remove('active'));
  const btn = document.querySelector('.rev-btn[data-seq="' + seq + '"][data-rev="' + rev + '"]');
  if (btn) btn.classList.add('active');
}
window.addEventListener('load', () => {
  document.querySelectorAll('.seq-section').forEach(sec => {
    const firstBtn = sec.querySelector('.rev-btn');
    if (firstBtn) firstBtn.click();
  });
});
</script>
</head><body>
<h1>Round 4: R3b 增量稳定性</h1>
<p>三候选逐 revision 对比。追踪节点应跨 revision 保持位置稳定。<br>
Go/No-Go：旧节点中位位移 <30px、最大 <100px、capHitRate <10%、最终态质量退化 <15%。</p>
${rows.join('')}
</body></html>`;

  fs.writeFileSync(path.join(ROOT, 'outputs/round4-gallery.html'), html);
  console.log(`[round4-gallery] 完成 → outputs/round4-gallery.html`);
}

renderRound4Gallery();
