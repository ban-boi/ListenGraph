import fs from 'node:fs';
import path from 'node:path';
import type { MergedGraph } from '@listen-graphic/schema';
import type { RenderModel, RenderItem } from './round2-types';
import { CARD_WIDTH, CARD_HEIGHT } from './round2-types';

const NODE_COLORS: Record<string, string> = {
  claim: '#3b82f6',
  reason: '#10b981',
  example: '#8b5cf6',
  question: '#f59e0b',
  conclusion: '#6b7280',
};

const EDGE_COLORS: Record<string, string> = {
  supports: '#10b981',
  opposes: '#ef4444',
  causes: '#f59e0b',
  follows: '#6b7280',
  example_of: '#8b5cf6',
};

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) + '…' : text;
}

export function renderModelToHtml(
  model: RenderModel,
  graph: MergedGraph,
  outputPath: string,
): void {
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));

  // 计算总画布尺寸
  let maxX = 0;
  let maxY = 0;
  for (const item of model.items) {
    if ('position' in item) {
      maxX = Math.max(maxX, item.position.x + CARD_WIDTH);
      maxY = Math.max(maxY, item.position.y + CARD_HEIGHT);
    }
  }
  for (const c of model.clusters) {
    maxX = Math.max(maxX, c.bounds.x + c.bounds.width);
    maxY = Math.max(maxY, c.bounds.y + c.bounds.height);
  }

  // cluster 背景层
  const clusterDivs = model.clusters
    .map((c) => {
      const bg = c.type === 'major' ? 'rgba(59,130,246,0.06)' : 'rgba(107,114,128,0.06)';
      const border = c.type === 'major' ? 'rgba(59,130,246,0.2)' : 'rgba(107,114,128,0.2)';
      return `<div style="position:absolute;left:${c.bounds.x}px;top:${c.bounds.y}px;width:${c.bounds.width}px;height:${c.bounds.height}px;background:${bg};border:1px dashed ${border};border-radius:8px;"></div>`;
    })
    .join('\n');

  // 节点/loose-note/summary 层
  const itemDivs = model.items
    .map((item) => {
      if (item.kind === 'fullNode') {
        const node = nodeById.get(item.nodeId);
        if (!node) return '';
        const color = NODE_COLORS[node.type] ?? '#6b7280';
        const text = escapeHtml(truncate(node.text, 60));
        const speaker = node.speaker ? `<div style="font-size:10px;color:#888;">${escapeHtml(node.speaker)}</div>` : '';
        return `<div style="position:absolute;left:${item.position.x}px;top:${item.position.y}px;width:${CARD_WIDTH}px;height:${CARD_HEIGHT}px;border:2px solid ${color};border-radius:8px;background:#fff;padding:8px;box-sizing:border-box;overflow:hidden;">
          <div style="font-size:10px;color:${color};font-weight:600;text-transform:uppercase;">${node.type}</div>
          <div style="font-size:12px;margin-top:4px;line-height:1.3;">${text}</div>
          ${speaker}
        </div>`;
      }
      if (item.kind === 'looseNoteItem') {
        const node = nodeById.get(item.nodeId);
        if (!node) return '';
        const color = NODE_COLORS[node.type] ?? '#6b7280';
        const text = escapeHtml(truncate(node.text, 30));
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

  // 边层（svg）
  const edgesSvg = model.edges.length > 0
    ? `<svg style="position:absolute;left:0;top:0;width:${maxX}px;height:${maxY}px;pointer-events:none;">
      ${model.edges
        .map((e) => {
          const srcItem = model.items.find((i) => 'nodeId' in i && i.nodeId === e.source);
          const tgtItem = model.items.find((i) => 'nodeId' in i && i.nodeId === e.target);
          if (!srcItem || !tgtItem || !('position' in srcItem) || !('position' in tgtItem)) return '';
          const sx = srcItem.position.x + CARD_WIDTH / 2;
          const sy = srcItem.position.y + CARD_HEIGHT / 2;
          const tx = tgtItem.position.x + CARD_WIDTH / 2;
          const ty = tgtItem.position.y + CARD_HEIGHT / 2;
          const color = EDGE_COLORS[e.type] ?? '#6b7280';
          return `<line x1="${sx}" y1="${sy}" x2="${tx}" y2="${ty}" stroke="${color}" stroke-width="1.5" opacity="0.5" />`;
        })
        .join('\n')}
    </svg>`
    : '';

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    body{margin:0;font-family:system-ui,sans-serif;}
    .canvas{position:relative;width:${maxX}px;height:${maxY}px;}
    .meta{position:fixed;top:0;left:0;background:rgba(0,0,0,0.8);color:#fff;padding:4px 10px;font-size:12px;z-index:999;}
  </style></head><body>
    <div class="meta">${model.meta.candidate} | #${model.meta.graphIndex} | ${model.meta.nodeCount}节点 ${model.meta.edgeCount}边 | ${model.meta.clusterCount}簇(${model.meta.majorCount}M/${model.meta.minorCount}m)</div>
    <div class="canvas">
      ${clusterDivs}
      ${edgesSvg}
      ${itemDivs}
    </div>
  </body></html>`;

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, html);
}
