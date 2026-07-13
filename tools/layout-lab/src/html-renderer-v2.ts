import fs from 'node:fs';
import path from 'node:path';
import type { MergedGraph } from '@listen-graphic/schema';
import type { RenderModel, RenderItem } from './round2-types';
import { computeNodeSize, truncateText } from './round3-types';

const NODE_COLORS: Record<string, string> = {
  claim: '#3b82f6', reason: '#10b981', example: '#8b5cf6',
  question: '#f59e0b', conclusion: '#6b7280',
};
const EDGE_COLORS: Record<string, string> = {
  supports: '#10b981', opposes: '#ef4444', causes: '#f59e0b',
  follows: '#6b7280', example_of: '#8b5cf6',
};

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function renderModelToHtmlV2(
  model: RenderModel,
  graph: MergedGraph,
  outputPath: string,
): void {
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));

  // 算每个节点的自适应尺寸
  const sizes: Record<string, { width: number; height: number }> = {};
  for (const n of graph.nodes) sizes[n.id] = computeNodeSize(n.text);

  // Normalize：shift 所有坐标让 minX/minY ≥ 0（修复力导向产生负坐标导致节点被截）
  let normMinX = Infinity, normMinY = Infinity;
  for (const item of model.items) {
    if ('position' in item) {
      normMinX = Math.min(normMinX, item.position.x);
      normMinY = Math.min(normMinY, item.position.y);
    }
  }
  for (const c of model.clusters) {
    normMinX = Math.min(normMinX, c.bounds.x);
    normMinY = Math.min(normMinY, c.bounds.y);
  }
  const shiftX = normMinX < 0 ? -normMinX : 0;
  const shiftY = normMinY < 0 ? -normMinY : 0;
  if (shiftX > 0 || shiftY > 0) {
    for (const item of model.items) {
      if ('position' in item) {
        item.position.x += shiftX;
        item.position.y += shiftY;
      }
    }
    for (const c of model.clusters) {
      c.bounds.x += shiftX;
      c.bounds.y += shiftY;
    }
  }

  // 算画布尺寸
  let maxX = 0, maxY = 0;
  for (const item of model.items) {
    if (item.kind === 'fullNode') {
      const s = sizes[item.nodeId];
      maxX = Math.max(maxX, item.position.x + s.width);
      maxY = Math.max(maxY, item.position.y + s.height);
    } else if (item.kind === 'looseNoteItem') {
      maxX = Math.max(maxX, item.position.x + 200);
      maxY = Math.max(maxY, item.position.y + 32);
    } else if (item.kind === 'clusterSummary') {
      maxX = Math.max(maxX, item.position.x + 200);
      maxY = Math.max(maxY, item.position.y + 80);
    }
  }
  for (const c of model.clusters) {
    maxX = Math.max(maxX, c.bounds.x + c.bounds.width);
    maxY = Math.max(maxY, c.bounds.y + c.bounds.height);
  }

  const clusterDivs = model.clusters
    .map((c) => {
      const bg = c.type === 'major' ? 'rgba(59,130,246,0.06)' : 'rgba(107,114,128,0.06)';
      const border = c.type === 'major' ? 'rgba(59,130,246,0.2)' : 'rgba(107,114,128,0.2)';
      return `<div style="position:absolute;left:${c.bounds.x}px;top:${c.bounds.y}px;width:${c.bounds.width}px;height:${c.bounds.height}px;background:${bg};border:1px dashed ${border};border-radius:8px;"></div>`;
    })
    .join('\n');

  const itemDivs = model.items
    .map((item) => {
      if (item.kind === 'fullNode') {
        const node = nodeById.get(item.nodeId);
        if (!node) return '';
        const s = sizes[item.nodeId];
        const color = NODE_COLORS[node.type] ?? '#6b7280';
        const text = escapeHtml(truncateText(node.text));
        const speaker = node.speaker ? `<div style="font-size:10px;color:#888;">${escapeHtml(node.speaker)}</div>` : '';
        return `<div style="position:absolute;left:${item.position.x}px;top:${item.position.y}px;width:${s.width}px;height:${s.height}px;border:2px solid ${color};border-radius:8px;background:#fff;padding:6px;box-sizing:border-box;overflow:hidden;font-size:11px;">
          <div style="font-size:9px;color:${color};font-weight:600;text-transform:uppercase;">${node.type}</div>
          <div style="margin-top:3px;line-height:1.2;">${text}</div>${speaker}
        </div>`;
      }
      if (item.kind === 'looseNoteItem') {
        const node = nodeById.get(item.nodeId);
        if (!node) return '';
        const color = NODE_COLORS[node.type] ?? '#6b7280';
        const text = escapeHtml(truncateText(node.text, 30));
        return `<div style="position:absolute;left:${item.position.x}px;top:${item.position.y}px;width:200px;height:32px;display:flex;align-items:center;gap:6px;border-bottom:1px solid #eee;">
          <span style="width:8px;height:8px;border-radius:50%;background:${color};flex-shrink:0;"></span>
          <span style="font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${text}</span>
        </div>`;
      }
      if (item.kind === 'clusterSummary') {
        return `<div style="position:absolute;left:${item.position.x}px;top:${item.position.y}px;width:200px;height:80px;border:2px dashed #aaa;border-radius:8px;background:#f9fafb;display:flex;flex-direction:column;align-items:center;justify-content:center;">
          <div style="font-size:12px;color:#666;font-weight:600;">未展开分区</div>
          <div style="font-size:11px;color:#999;margin-top:4px;">${item.nodeCount} 节点 · ${item.edgeCount} 边</div>
        </div>`;
      }
      return '';
    })
    .join('\n');

  // 边用实际节点中心
  const edgesSvg = model.edges.length > 0
    ? `<svg style="position:absolute;left:0;top:0;width:${maxX}px;height:${maxY}px;pointer-events:none;">
      ${model.edges.map((e) => {
        const srcItem = model.items.find((i) => 'nodeId' in i && i.nodeId === e.source);
        const tgtItem = model.items.find((i) => 'nodeId' in i && i.nodeId === e.target);
        if (!srcItem || !tgtItem || !('position' in srcItem) || !('position' in tgtItem)) return '';
        const ss = sizes[e.source] ?? { width: 200, height: 100 };
        const ts = sizes[e.target] ?? { width: 200, height: 100 };
        const sx = srcItem.position.x + ss.width / 2;
        const sy = srcItem.position.y + ss.height / 2;
        const tx = tgtItem.position.x + ts.width / 2;
        const ty = tgtItem.position.y + ts.height / 2;
        const color = EDGE_COLORS[e.type] ?? '#6b7280';
        return `<line x1="${sx}" y1="${sy}" x2="${tx}" y2="${ty}" stroke="${color}" stroke-width="1" opacity="0.4" />`;
      }).join('\n')}
    </svg>`
    : '';

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    body{margin:0;font-family:system-ui,sans-serif;}
    .canvas{position:relative;width:${maxX}px;height:${maxY}px;}
    .meta{position:fixed;top:0;left:0;background:rgba(0,0,0,0.8);color:#fff;padding:4px 10px;font-size:12px;z-index:999;}
  </style></head><body>
    <div class="meta">${model.meta.candidate} | #${model.meta.graphIndex} | ${model.meta.nodeCount}节点 ${model.meta.edgeCount}边 | ${model.meta.clusterCount}簇</div>
    <div class="canvas">${clusterDivs}${edgesSvg}${itemDivs}</div>
  </body></html>`;

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, html);
}
