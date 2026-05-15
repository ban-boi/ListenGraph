import type { MergedGraph, ViewType } from '@listen-graphic/schema';

// ---------------------------------------------------------------------------
// 拓扑检测辅助函数
// ---------------------------------------------------------------------------

/** 检测是否存在多跳因果链（A → causes → B → causes → C，至少两跳） */
function hasMultiHopCausalChain(graph: MergedGraph): boolean {
  const causesEdges = graph.edges.filter((e) => e.type === 'causes');
  const targetsSet = new Set(causesEdges.map((e) => e.target));
  return causesEdges.some((e) => targetsSet.has(e.source));
}

/** 检测是否存在跨 speaker 的边（边的 source 和 target 节点 speaker 不同） */
function hasCrossSpeakerEdges(graph: MergedGraph): boolean {
  const speakerMap = new Map<string, string | undefined>();
  for (const node of graph.nodes) {
    speakerMap.set(node.id, node.speaker);
  }
  return graph.edges.some((e) => {
    const s1 = speakerMap.get(e.source);
    const s2 = speakerMap.get(e.target);
    return s1 && s2 && s1 !== s2;
  });
}

/** 统计图中不同的 speaker 数量 */
function countUniqueSpeakers(graph: MergedGraph): number {
  const speakers = new Set<string>();
  for (const node of graph.nodes) {
    if (node.speaker) {
      speakers.add(node.speaker);
    }
  }
  return speakers.size;
}

/** 检测是否存在 claim 节点拥有 2+ 个结构性子节点（出边 targets，排除 follows） */
function hasClaimWithMultipleChildren(graph: MergedGraph): boolean {
  const structuralTypes = new Set(['causes', 'supports', 'example_of']);
  const childCounts = new Map<string, number>();
  for (const edge of graph.edges) {
    if (!structuralTypes.has(edge.type)) continue;
    childCounts.set(edge.source, (childCounts.get(edge.source) ?? 0) + 1);
  }
  const claimIds = new Set(
    graph.nodes.filter((n) => n.type === 'claim').map((n) => n.id),
  );
  return Array.from(childCounts.entries()).some(
    ([id, count]) => claimIds.has(id) && count >= 2,
  );
}

// ---------------------------------------------------------------------------
// 评分与选择
// ---------------------------------------------------------------------------

export function scoreViews(graph: MergedGraph): Record<ViewType, number> {
  const totalEdges = graph.edges.length;

  // 无边时所有基础分数为 0
  if (totalEdges === 0) {
    return { timeline: 0, causal: 0, comparison: 0, hierarchy: 0 };
  }

  // 统计各类边数量
  let causesCount = 0;
  let opposesCount = 0;
  let supportsCount = 0;
  let exampleOfCount = 0;
  // follows 不参与评分

  for (const edge of graph.edges) {
    switch (edge.type) {
      case 'causes':
        causesCount++;
        break;
      case 'opposes':
        opposesCount++;
        break;
      case 'supports':
        supportsCount++;
        break;
      case 'example_of':
        exampleOfCount++;
        break;
      // follows 不计入
    }
  }

  // 基础分数：使用比例，乘以 10 放大
  const scores: Record<ViewType, number> = {
    timeline: 0,
    causal: ((causesCount * 3 + supportsCount * 1) / totalEdges) * 10,
    comparison: ((opposesCount * 3) / totalEdges) * 10,
    hierarchy: ((exampleOfCount * 2 + supportsCount * 1) / totalEdges) * 10,
  };

  // 拓扑奖励
  if (hasMultiHopCausalChain(graph)) {
    scores.causal += 3;
  }
  // speaker 相关奖励已移除：当前 ASR 无可靠 speaker diarization，
  // 多 speaker 信号不应驱动 comparison 视图选择。
  // 当 ASR 能力补齐后，可基于 "跨 speaker + opposes/stance" 重新启用。
  if (hasClaimWithMultipleChildren(graph)) {
    scores.hierarchy += 2;
  }

  return scores;
}

export function pickDefaultView(graph: MergedGraph): ViewType {
  // 空图或无节点时返回 causal
  if (graph.nodes.length === 0) {
    return 'causal';
  }

  const scores = scoreViews(graph);

  // 收集非 timeline 的候选视图
  const candidates = (Object.entries(scores) as Array<[ViewType, number]>)
    .filter(([view]) => view !== 'timeline');

  // 找到最高分
  let maxScore = -Infinity;
  for (const [, score] of candidates) {
    if (score > maxScore) maxScore = score;
  }

  // 所有分数 <= 0 时兜底返回 causal（例如纯 follows 边且无拓扑奖励）
  if (maxScore <= 0) {
    return 'causal';
  }

  // 取分数最高的视图；tie-break 时 causal > comparison > hierarchy
  const TIE_BREAK_ORDER: ViewType[] = ['causal', 'comparison', 'hierarchy'];
  for (const preferred of TIE_BREAK_ORDER) {
    if (scores[preferred] === maxScore) {
      return preferred;
    }
  }

  return 'causal';
}
