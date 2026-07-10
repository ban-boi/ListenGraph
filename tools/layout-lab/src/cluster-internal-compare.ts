import fs from 'node:fs';
import path from 'node:path';
import type { MergedGraph, GraphNode, GraphEdge } from '@listen-graphic/schema';
import { partitionClusters } from './cluster-partition';
import { buildStableReactFlowDebugGraph } from '../../../apps/extension/src/sidepanel/graph-utils.ts';
import { toHierarchyRendererGraph } from '../../../packages/graph-renderers/src/hierarchy.ts';
import { layoutTopologicalLayers, layoutFanOut, layoutColumnGrouped, layoutForceDirected, layoutForceDirectedGravity, layoutForceDirectedWidthPenalty, computeLayoutMetrics, type Position, type LayoutMetrics } from './cluster-internal-layouts';
import { CARD_WIDTH, CARD_HEIGHT } from './round2-types';

const DUMP_PATH = path.resolve(import.meta.dirname, '../inputs/real-graphs-dump.json');
const OUTPUT_DIR = path.resolve(import.meta.dirname, '../outputs/cluster-internal-compare');

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
function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) + '…' : text;
}

// Render one layout as an HTML fragment (not a full page)
function renderLayoutFragment(
  title: string,
  nodes: GraphNode[],
  edges: GraphEdge[],
  positions: Record<string, Position>,
  metrics?: LayoutMetrics,
): string {
  const nodeById = new Map(nodes.map(n => [n.id, n]));

  let maxX = 0, maxY = 0;
  for (const pos of Object.values(positions)) {
    maxX = Math.max(maxX, pos.x + CARD_WIDTH);
    maxY = Math.max(maxY, pos.y + CARD_HEIGHT);
  }

  const validIds = new Set(Object.keys(positions));

  const itemDivs = nodes
    .filter(n => positions[n.id])
    .map(n => {
      const color = NODE_COLORS[n.type] ?? '#6b7280';
      const text = escapeHtml(truncate(n.text, 50));
      const speaker = n.speaker ? `<div style="font-size:10px;color:#888;">${escapeHtml(n.speaker)}</div>` : '';
      const pos = positions[n.id];
      return `<div style="position:absolute;left:${pos.x}px;top:${pos.y}px;width:${CARD_WIDTH}px;height:${CARD_HEIGHT}px;border:2px solid ${color};border-radius:8px;background:#fff;padding:6px;box-sizing:border-box;overflow:hidden;font-size:11px;">
        <div style="font-size:9px;color:${color};font-weight:600;text-transform:uppercase;">${n.type}</div>
        <div style="margin-top:3px;line-height:1.2;">${text}</div>${speaker}
      </div>`;
    }).join('\n');

  const edgesSvg = `<svg style="position:absolute;left:0;top:0;width:${maxX}px;height:${maxY}px;pointer-events:none;">
    ${edges
      .filter(e => validIds.has(e.source) && validIds.has(e.target))
      .map(e => {
        const s = positions[e.source], t = positions[e.target];
        const color = EDGE_COLORS[e.type] ?? '#6b7280';
        return `<line x1="${s.x + CARD_WIDTH/2}" y1="${s.y + CARD_HEIGHT/2}" x2="${t.x + CARD_WIDTH/2}" y2="${t.y + CARD_HEIGHT/2}" stroke="${color}" stroke-width="1" opacity="0.4" />`;
      }).join('\n')}
  </svg>`;

  const metricsHtml = metrics ? `<div class="metrics">
    宽高比: <b>${metrics.aspectRatio.toFixed(2)}</b> ·
    平均边长: <b>${metrics.avgEdgeLength}px</b> ·
    长边比例: <b>${(metrics.longEdgeRatio * 100).toFixed(0)}%</b> ·
    边穿越节点: <b>${metrics.edgeCrossings}</b>
  </div>` : '';

  return `<div class="layout-panel">
    <h3>${title}</h3>
    <div class="meta">${nodes.length} 节点 · ${edges.length} 边</div>
    ${metricsHtml}
    <div style="position:relative;width:${maxX}px;height:${maxY}px;overflow:auto;">
      ${edgesSvg}
      ${itemDivs}
    </div>
  </div>`;
}

function main() {
  const dump = JSON.parse(fs.readFileSync(DUMP_PATH, 'utf8')) as MergedGraph[];
  const graph = dump[49];

  // Partition and get the largest cluster
  const partition = partitionClusters(graph);
  const largestCluster = partition.clusters[0]; // already sorted by size desc

  console.log(`[compare] graph #49, largest cluster: ${largestCluster.nodeIds.length} nodes, ${largestCluster.edges.length} edges`);

  const clusterNodeIds = new Set(largestCluster.nodeIds);
  const clusterNodes = graph.nodes.filter(n => clusterNodeIds.has(n.id));
  const clusterEdges = graph.edges.filter(e => clusterNodeIds.has(e.source) && clusterNodeIds.has(e.target) && e.source !== e.target);

  // 1. Baseline: use buildStableReactFlowDebugGraph on this sub-graph
  const subGraph: MergedGraph = { ...graph, nodes: clusterNodes, edges: clusterEdges };
  const rendererGraph = toHierarchyRendererGraph(subGraph);
  const baselineResult = buildStableReactFlowDebugGraph({
    rendererGraph, view: 'hierarchy', currentTimeMs: 0,
    selectedNodeId: null, previousLayoutState: { positions: {} },
  });
  const baselinePositions = baselineResult.layoutState.positions;

  // 2. Strategy A: Topological layers
  const positionsA = layoutTopologicalLayers(clusterNodes, clusterEdges);

  // 3. Strategy B: Fan-out
  const positionsB = layoutFanOut(clusterNodes, clusterEdges);

  // 4. Strategy C: Column grouped
  const positionsC = layoutColumnGrouped(clusterNodes, clusterEdges);

  // 5. Strategy D: Force-directed
  const positionsD = layoutForceDirected(clusterNodes, clusterEdges);

  // 6. Strategy D1: Force + gravity
  const positionsD1 = layoutForceDirectedGravity(clusterNodes, clusterEdges);

  // 7. Strategy D2: Force + width penalty
  const positionsD2 = layoutForceDirectedWidthPenalty(clusterNodes, clusterEdges);

  // Metrics for all 7 layouts
  const baselineMetrics = computeLayoutMetrics(clusterNodes, clusterEdges, baselinePositions);
  const metricsA = computeLayoutMetrics(clusterNodes, clusterEdges, positionsA);
  const metricsB = computeLayoutMetrics(clusterNodes, clusterEdges, positionsB);
  const metricsC = computeLayoutMetrics(clusterNodes, clusterEdges, positionsC);
  const metricsD = computeLayoutMetrics(clusterNodes, clusterEdges, positionsD);
  const metricsD1 = computeLayoutMetrics(clusterNodes, clusterEdges, positionsD1);
  const metricsD2 = computeLayoutMetrics(clusterNodes, clusterEdges, positionsD2);

  // Generate comparison HTML
  const fragments = [
    renderLayoutFragment('Baseline（当前布局·层级视图）', clusterNodes, clusterEdges, baselinePositions, baselineMetrics),
    renderLayoutFragment('Strategy A：拓扑分层', clusterNodes, clusterEdges, positionsA, metricsA),
    renderLayoutFragment('Strategy B：扇形展开', clusterNodes, clusterEdges, positionsB, metricsB),
    renderLayoutFragment('Strategy C：列内分组', clusterNodes, clusterEdges, positionsC, metricsC),
    renderLayoutFragment('Strategy D：力导向（铺成面）', clusterNodes, clusterEdges, positionsD, metricsD),
    renderLayoutFragment('Strategy D1：力导向 + 中心轴引力', clusterNodes, clusterEdges, positionsD1, metricsD1),
    renderLayoutFragment('Strategy D2：力导向 + 软宽度惩罚', clusterNodes, clusterEdges, positionsD2, metricsD2),
  ];

  const html = `<!DOCTYPE html><html lang="zh"><head><meta charset="utf-8"><title>簇内布局策略对比</title>
<style>
body{font-family:system-ui,sans-serif;margin:16px;background:#fafafa}
.layout-panel{background:#fff;border:1px solid #ddd;border-radius:6px;padding:12px;margin-bottom:20px}
.layout-panel h3{margin:0 0 4px;font-size:15px}
.meta{font-size:12px;color:#888;margin-bottom:8px}
.metrics{font-size:12px;background:#f0f9ff;border:1px solid #bae6fd;padding:6px 8px;border-radius:4px;margin-bottom:8px;color:#0c4a6e}
h1{font-size:18px}
.desc{background:#fffbeb;border:1px solid #fde68a;padding:10px;border-radius:6px;margin-bottom:16px;font-size:13px;line-height:1.5}
</style></head><body>
<h1>簇内布局策略对比</h1>
<div class="desc">
  用 graph #49 最大簇（${largestCluster.nodeIds.length} 节点 ${largestCluster.edges.length} 边）测试 7 种排布策略。<br>
  <b>主要看：连接线是否还"砍一刀断十根"？哪种排布让连线方向和排布方向更一致？宽高比越低越适合窄面板（侧边栏/移动端竖屏）。</b><br>
  <b>Baseline</b>：当前层级视图（固定两列 x=60/x=340）<br>
  <b>Strategy A</b>：拓扑分层（BFS 深度分层，同层横向排开，层间纵向连线）<br>
  <b>Strategy B</b>：扇形展开（子节点围绕父节点横向展开，树状）<br>
  <b>Strategy C</b>：列内分组（保持两列，但同一父节点的子节点紧凑放一起，不同父节点间加间隔）<br>
  <b>Strategy D</b>：力导向（节点互斥+边弹簧，自然展开成 2D 面，连线短的优先靠近）<br>
  <b>Strategy D1</b>：力导向 + 中心轴引力（温和地把节点往中间收，目标宽度 600px）<br>
  <b>Strategy D2</b>：力导向 + 软宽度惩罚（只在节点超出 600px 宽度时推回，宽度内自由展开）
</div>
${fragments.join('\n')}
</body></html>`;

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const outPath = path.join(OUTPUT_DIR, 'cluster-internal-compare.html');
  fs.writeFileSync(outPath, html);
  console.log(`[compare] 完成 → ${outPath}`);
}

main();
