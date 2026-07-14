import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { computeIncrementalLayout, createEmptyIncrementalState, computeAllNodeSizes } from './index';
import type { MergedGraph } from '@listen-graphic/schema';

/**
 * 等价性 + 确定性测试。
 *
 * 修复 B1/M1（review finding）：
 * - 旧实现读取 gitignored 的 tools/layout-lab/inputs/real-graphs-dump.json，
 *   新 clone / CI 必抛 ENOENT；且只断言 r1===r2（确定性），未对比 golden baseline，
 *   名为"等价性"实则没有验证提取后行为不变。
 * - 现改用 graph-fixtures 里 git 跟踪的合成 sequence（seq-late-burst 最终态，16 节点），
 *   并嵌入提取时录制的 golden positions 快照，精确对比每个节点坐标，
 *   一旦内核输出漂移即可捕获。
 */
const here = dirname(fileURLToPath(import.meta.url));
const seqPath = join(here, '../../../../packages/graph-fixtures/fixtures/sequences/seq-late-burst.json');
const seq = JSON.parse(readFileSync(seqPath, 'utf8')) as { steps: Array<{ graph: MergedGraph }> };
const graph = seq.steps[seq.steps.length - 1].graph;

/**
 * Golden positions：提取内核到 graph-renderers 时（commit dc36ef8）录制。
 * 坐标圆整到 0.01px。任何内核改动若导致这些坐标漂移，测试会失败——
 * 这是"提取等价性"的真正回归保护（改动合法时需显式更新此快照）。
 */
const GOLDEN_POSITIONS: Record<string, { cx: number; cy: number }> = {
  n1: { cx: 303.83, cy: 148.03 },
  n2: { cx: 523.47, cy: 120.44 },
  n3: { cx: 444.83, cy: 380.8 },
  n4: { cx: 519.86, cy: 254.18 },
  n5: { cx: 248.44, cy: 416.34 },
  n6: { cx: 132.48, cy: 323.48 },
  n7: { cx: 327.92, cy: 306.25 },
  n8: { cx: 78.55, cy: 203.06 },
  n9: { cx: 316.82, cy: -20.01 },
  n10: { cx: 83.79, cy: 69.48 },
  n11: { cx: 126.82, cy: -51.59 },
  n12: { cx: 506.82, cy: -11.53 },
  n13: { cx: 354.25, cy: -171.33 },
  n14: { cx: 389.84, cy: -404.99 },
  n15: { cx: 420.9, cy: -612.66 },
  n16: { cx: 448.64, cy: -799.95 },
};

describe('R3b 等价性与确定性（合成 fixture + golden baseline）', () => {
  it('golden baseline：每个节点坐标与提取时录制的快照一致', () => {
    const sizes = computeAllNodeSizes(graph.nodes);
    const result = computeIncrementalLayout(graph, createEmptyIncrementalState(), 'R3b', sizes);

    // 每个节点都必须有 golden 记录且坐标精确匹配（容差 0.01px）
    for (const id of Object.keys(GOLDEN_POSITIONS)) {
      expect(result.positions[id], `节点 ${id} 应存在于输出`).toBeDefined();
      expect(result.positions[id].cx).toBeCloseTo(GOLDEN_POSITIONS[id].cx, 1);
      expect(result.positions[id].cy).toBeCloseTo(GOLDEN_POSITIONS[id].cy, 1);
    }
    // 输出不应多出未知节点
    expect(Object.keys(result.positions).sort()).toEqual(Object.keys(GOLDEN_POSITIONS).sort());
  });

  it('确定性：同一输入跑两次，positions 完全一致', () => {
    const sizes = computeAllNodeSizes(graph.nodes);
    const r1 = computeIncrementalLayout(graph, createEmptyIncrementalState(), 'R3b', sizes);
    const r2 = computeIncrementalLayout(graph, createEmptyIncrementalState(), 'R3b', sizes);

    for (const id of Object.keys(r1.positions)) {
      expect(r2.positions[id].cx).toBe(r1.positions[id].cx);
      expect(r2.positions[id].cy).toBe(r1.positions[id].cy);
    }
  });
});
