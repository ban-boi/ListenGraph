import type { MergedGraph } from '@listen-graphic/schema';

/**
 * 按 timestampMs 把一张完整 real graph 切成增长序列（多个 revision）。
 *
 * 策略：把相同 timestampMs 的节点视作同批，按时间排序后贪心打包——
 * 当前批累计节点数加上当前 timestamp 的节点数若超过 batchSize 就先封箱，
 * 已封箱的节点（及其关联边）累积进每个 revision（增量语义）。
 *
 * 最后一个 revision 应与原图节点/边一致（完整性检查）。
 */
export function splitGraphByTimestamp(graph: MergedGraph, batchSize = 20): MergedGraph[] {
  const timestamps = [...new Set(graph.nodes.map((n) => n.timestampMs))].sort((a, b) => a - b);
  const batches: number[][] = [];
  let currentBatch: number[] = [];
  let currentSize = 0;
  for (const ts of timestamps) {
    const count = graph.nodes.filter((n) => n.timestampMs === ts).length;
    if (currentSize + count > batchSize && currentBatch.length > 0) {
      batches.push(currentBatch);
      currentBatch = [];
      currentSize = 0;
    }
    currentBatch.push(ts);
    currentSize += count;
  }
  if (currentBatch.length > 0) batches.push(currentBatch);

  const revisions: MergedGraph[] = [];
  const accumulatedNodeIds = new Set<string>();

  for (let i = 0; i < batches.length; i++) {
    const batchTimestamps = new Set(batches[i]);
    const newNodes = graph.nodes.filter((n) => batchTimestamps.has(n.timestampMs));
    for (const n of newNodes) accumulatedNodeIds.add(n.id);
    const validEdges = graph.edges.filter(
      (e) => accumulatedNodeIds.has(e.source) && accumulatedNodeIds.has(e.target),
    );
    revisions.push({
      ...graph,
      revision: i + 1,
      nodes: graph.nodes.filter((n) => accumulatedNodeIds.has(n.id)),
      edges: validEdges,
    });
  }
  return revisions;
}
