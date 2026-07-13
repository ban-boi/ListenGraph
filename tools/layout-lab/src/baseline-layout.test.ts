import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { computeBaselinePositions } from './baseline-layout';
import { buildStableReactFlowDebugGraph, getRendererGraph } from '../../../apps/extension/src/sidepanel/graph-utils.ts';
import type { MergedGraph } from '@listen-graphic/schema';

const DUMP_PATH = path.resolve(import.meta.dirname, '../inputs/real-graphs-dump.json');

function loadGraph(index: number): MergedGraph {
  const dump = JSON.parse(fs.readFileSync(DUMP_PATH, 'utf8')) as MergedGraph[];
  return dump[index];
}

describe('computeBaselinePositions 等价验证', () => {
  // 抽 3 张图：大图 #49、中图 #32、小图 #18
  const testIndices = [49, 32, 18];

  for (const idx of testIndices) {
    it(`graph #${idx} 的 positions 与 buildStableReactFlowDebugGraph 一致（固定 causal view）`, () => {
      const graph = loadGraph(idx);
      const view = 'causal' as const;
      const rendererGraph = getRendererGraph(graph, view);

      // 直接调产品函数
      const productResult = buildStableReactFlowDebugGraph({
        rendererGraph,
        view,
        currentTimeMs: 0,
        selectedNodeId: null,
        previousLayoutState: { positions: {} },
      });
      const productPositions = productResult.layoutState.positions;

      // 调 lab 封装
      const labModel = computeBaselinePositions(graph, idx);

      // 逐节点对比 x/y
      const nodeIds = Object.keys(productPositions);
      expect(nodeIds.length).toBeGreaterThan(0);
      for (const nodeId of nodeIds) {
        const pp = productPositions[nodeId];
        const labItem = labModel.items.find(
          (i) => 'nodeId' in i && i.nodeId === nodeId,
        );
        expect(labItem).toBeDefined();
        if (labItem && 'position' in labItem) {
          expect(labItem.position.x).toBe(pp.x);
          expect(labItem.position.y).toBe(pp.y);
        }
      }
    });
  }
});
