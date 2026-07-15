/**
 * 布局引擎适配器接口。
 * 统一坐标语义：所有 adapter 返回 center positions + sizes。
 */
import type { MergedGraph } from '@listen-graphic/schema';
import {
  computeIncrementalLayout,
  createEmptyIncrementalState,
  computeRealNodeSize,
} from '@listen-graphic/graph-renderers';

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

/**
 * 产品 R3b 布局引擎适配器。
 *
 * 走产品真实路径：computeIncrementalLayout(空状态首帧) + computeRealNodeSize(readable)。
 * 与 LabR3bAdapter 的差异：
 * - LabR3bAdapter 用 computeClusterForceLayout + computeAllNodeSizes（lab 真相源/调参基准）
 * - ProductR3bAdapter 用 computeIncrementalLayout(emptyState) + 产品卡片真实尺寸
 *
 * 方案 1.5 后两者首帧等价（都经 computeInitialClusterLayout 分簇堆叠），
 * 但尺寸口径不同（产品节点含 speaker/timestamp 行高、更宽），
 * 故 baseline 必须用 product adapter 独立录制，不能混用 lab baseline。
 *
 * 发布门（regression/holdout/round5）应使用此 adapter，因为它测的是产品真实渲染路径。
 */
export function createProductR3bAdapter(): LayoutEngineAdapter {
  return {
    id: 'r3b-product',
    version: 'round3',
    computeLayout(graph: MergedGraph): LayoutResult {
      // 产品尺寸口径：完整卡片（含 speaker/timestamp 行高、readable padding）
      const sizes: Record<string, NodeSize> = {};
      for (const n of graph.nodes) {
        const s = computeRealNodeSize(n.text, n.type, !!n.speaker, true, 'readable');
        sizes[n.id] = { width: s.width, height: s.height };
      }
      // 产品布局路径：增量首帧（空状态 → computeInitialClusterLayout 分簇堆叠）
      const result = computeIncrementalLayout(graph, createEmptyIncrementalState(), 'R3b', sizes);

      const positions: Record<string, CenterPos> = {};
      for (const n of graph.nodes) {
        const p = result.positions[n.id];
        if (p) positions[n.id] = { cx: p.cx, cy: p.cy };
      }

      return {
        positions,
        sizes,
        algorithmId: 'r3b-product',
        algorithmVersion: 'round3',
      };
    },
  };
}
