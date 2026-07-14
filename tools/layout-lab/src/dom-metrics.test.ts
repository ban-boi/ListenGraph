import { describe, expect, it } from 'vitest';
import { computeDomLayoutMetrics, type DomRect } from './dom-metrics';

describe('computeDomLayoutMetrics', () => {
  it('avgEdgeLength 只统计真实边，不是全节点对', () => {
    const rects: DomRect[] = [
      { id: 'graph-node-card-a', left: 0, top: 0, right: 100, bottom: 50 },
      { id: 'graph-node-card-b', left: 200, top: 0, right: 300, bottom: 50 },
      { id: 'graph-node-card-c', left: 400, top: 0, right: 500, bottom: 50 },
    ];
    const m = computeDomLayoutMetrics(
      rects,
      [{ source: 'a', target: 'b' }],
      { clearanceThreshold: 16 },
    );
    expect(m.avgEdgeLength).toBe(200); // centers: (50,25) → (250,25)
    expect(m.edgeCount).toBe(1);
    expect(m.pairCount).toBe(3);
  });

  it('报告 overlap / clearance / edgeEdgeCrossings 字段', () => {
    const rects: DomRect[] = [
      { id: 'graph-node-card-a', left: 0, top: 0, right: 80, bottom: 40 },
      { id: 'graph-node-card-b', left: 40, top: 0, right: 120, bottom: 40 },
    ];
    const m = computeDomLayoutMetrics(rects, [], { clearanceThreshold: 16 });
    expect(m.overlapPairs).toBe(1);
    expect(m.clearanceViolationPairs).toBeGreaterThanOrEqual(1);
    expect(typeof m.edgeEdgeCrossings).toBe('number');
    expect(typeof m.minClearance).toBe('number');
  });
});
