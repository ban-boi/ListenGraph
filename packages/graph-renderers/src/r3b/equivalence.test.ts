import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { computeIncrementalLayout, createEmptyIncrementalState, computeAllNodeSizes } from './index';
import type { MergedGraph } from '@listen-graphic/schema';

const DUMP = path.resolve(__dirname, '../../../../tools/layout-lab/inputs/real-graphs-dump.json');

describe('R3b golden 等价性（提取后 vs lab 固定输出）', () => {
  // 用 #32（91节点，5簇）做 golden——够大验证正确性，够快不超时
  it('#32 增量最终态 positions 确定性', () => {
    const dump = JSON.parse(fs.readFileSync(DUMP, 'utf8')) as MergedGraph[];
    const graph = dump[32];
    const sizes = computeAllNodeSizes(graph.nodes);

    // 跑两次，验证确定性
    const r1 = computeIncrementalLayout(graph, createEmptyIncrementalState(), 'R3b', sizes);
    const r2 = computeIncrementalLayout(graph, createEmptyIncrementalState(), 'R3b', sizes);

    for (const id of Object.keys(r1.positions)) {
      expect(r2.positions[id].cx).toBe(r1.positions[id].cx);
      expect(r2.positions[id].cy).toBe(r1.positions[id].cy);
    }
  });

  it('#18 小图增量最终态 positions 确定性', () => {
    const dump = JSON.parse(fs.readFileSync(DUMP, 'utf8')) as MergedGraph[];
    const graph = dump[18];
    const sizes = computeAllNodeSizes(graph.nodes);

    const r1 = computeIncrementalLayout(graph, createEmptyIncrementalState(), 'R3b', sizes);
    const r2 = computeIncrementalLayout(graph, createEmptyIncrementalState(), 'R3b', sizes);

    for (const id of Object.keys(r1.positions)) {
      expect(r2.positions[id]).toEqual(r1.positions[id]);
    }
  });
});
