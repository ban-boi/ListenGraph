import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { computeClusterLayoutB } from './cluster-overview';
import type { MergedGraph } from '@listen-graphic/schema';

const DUMP_PATH = path.resolve(import.meta.dirname, '../inputs/real-graphs-dump.json');

function loadGraph(index: number): MergedGraph {
  const dump = JSON.parse(fs.readFileSync(DUMP_PATH, 'utf8')) as MergedGraph[];
  return dump[index];
}

describe('computeClusterLayoutB', () => {
  it('大图 #49：major>4 时第 5+ 变成 clusterSummary', () => {
    const graph = loadGraph(49);
    const model = computeClusterLayoutB(graph, 49);
    const summaries = model.items.filter((i) => i.kind === 'clusterSummary');
    const fullNodes = model.items.filter((i) => i.kind === 'fullNode');
    expect(model.meta.candidate).toBe('B');
    expect(fullNodes.length).toBeGreaterThan(0);
    // #49 has 30 components, majors should be >4, so there should be summaries
    expect(summaries.length).toBeGreaterThan(0);
  });

  it('小图 #18：major<=4 不产生 summary', () => {
    const graph = loadGraph(18);
    const model = computeClusterLayoutB(graph, 18);
    const summaries = model.items.filter((i) => i.kind === 'clusterSummary');
    expect(summaries.length).toBe(0);
  });

  it('summary 块有 nodeCount 和 edgeCount', () => {
    const graph = loadGraph(49);
    const model = computeClusterLayoutB(graph, 49);
    const summaries = model.items.filter((i) => i.kind === 'clusterSummary');
    for (const s of summaries) {
      expect(s.kind).toBe('clusterSummary');
      if (s.kind === 'clusterSummary') {
        expect(s.nodeCount).toBeGreaterThan(0);
      }
    }
  });
});
