import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { computeClusterForceLayout } from './cluster-force-layout';
import type { MergedGraph } from '@listen-graphic/schema';

const DUMP_PATH = path.resolve(import.meta.dirname, '../inputs/real-graphs-dump.json');
function loadGraph(i: number): MergedGraph {
  return (JSON.parse(fs.readFileSync(DUMP_PATH, 'utf8')) as MergedGraph[])[i];
}

describe('computeClusterForceLayout', () => {
  it('R3a 大图 #41：产出坐标 + cluster 元信息', () => {
    const graph = loadGraph(41);
    const result = computeClusterForceLayout(graph, 41, 'R3a');
    expect(result.meta.candidate).toBe('R3a');
    expect(result.meta.clusterCount).toBeGreaterThan(0);
    expect(result.items.length).toBeGreaterThan(0);
    const positioned = result.items.filter((i) => 'position' in i);
    expect(positioned.length).toBe(graph.nodes.length);
  });

  it('R3b 大图 #41：产出坐标 + cluster 元信息', () => {
    const graph = loadGraph(41);
    const result = computeClusterForceLayout(graph, 41, 'R3b');
    expect(result.meta.candidate).toBe('R3b');
    expect(result.items.length).toBeGreaterThan(0);
  });

  it('小图 #18 不伤害：所有节点有坐标', () => {
    const graph = loadGraph(18);
    const result = computeClusterForceLayout(graph, 18, 'R3a');
    const positioned = result.items.filter((i) => 'position' in i);
    expect(positioned.length).toBe(graph.nodes.length);
  });

  it('cluster bounds 不重叠', () => {
    const graph = loadGraph(32);
    const result = computeClusterForceLayout(graph, 32, 'R3b');
    for (let i = 0; i < result.clusters.length; i++) {
      for (let j = i + 1; j < result.clusters.length; j++) {
        const a = result.clusters[i].bounds;
        const b = result.clusters[j].bounds;
        const overlaps = !(
          a.x + a.width + 10 <= b.x ||
          b.x + b.width + 10 <= a.x ||
          a.y + a.height + 10 <= b.y ||
          b.y + b.height + 10 <= a.y
        );
        expect(overlaps).toBe(false);
      }
    }
  });
});
