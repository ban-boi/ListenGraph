/**
 * 布局引擎适配器接口。
 * 统一坐标语义：所有 adapter 返回 center positions + sizes。
 */
import type { MergedGraph } from '@listen-graphic/schema';

import { computeClusterForceLayout } from './cluster-force-layout';
import { computeAllNodeSizes } from './round3-types';
import type { RenderModel } from './round2-types';

/** 中心点坐标 */
export type CenterPos = { cx: number; cy: number };

/** 节点尺寸 */
export type NodeSize = { width: number; height: number };

/** 布局结果 */
export type LayoutResult = {
  /** 节点中心点坐标 */
  positions: Record<string, CenterPos>;
  /** 节点尺寸 */
  sizes: Record<string, NodeSize>;
  /** 算法标识 */
  algorithmId: string;
  /** 算法版本（commit hash 或版本号） */
  algorithmVersion: string;
};

/** 布局引擎适配器 */
export type LayoutEngineAdapter = {
  id: string;
  version: string;
  computeLayout(graph: MergedGraph): LayoutResult;
};

/**
 * R3b 布局引擎适配器。
 * 调用 computeClusterForceLayout，将 RenderModel（top-left）转换为 center positions。
 */
export function createR3bAdapter(): LayoutEngineAdapter {
  return {
    id: 'r3b',
    version: 'round3',
    computeLayout(graph: MergedGraph): LayoutResult {
      const allSizes = computeAllNodeSizes(graph.nodes);
      const renderModel: RenderModel = computeClusterForceLayout(graph, 0, 'R3b', allSizes);

      const positions: Record<string, CenterPos> = {};
      const sizes: Record<string, NodeSize> = {};

      for (const item of renderModel.items) {
        if ('nodeId' in item) {
          const nodeId = item.nodeId;
          const size = allSizes[nodeId] ?? { width: 220, height: 132 };
          positions[nodeId] = {
            cx: item.position.x + size.width / 2,
            cy: item.position.y + size.height / 2,
          };
          sizes[nodeId] = size;
        }
      }

      return {
        positions,
        sizes,
        algorithmId: 'r3b',
        algorithmVersion: 'round3',
      };
    },
  };
}
