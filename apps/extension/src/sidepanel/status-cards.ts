/**
 * status-cards.ts
 *
 * 纯函数：根据当前面板状态计算 ASR / Structurer / Graph 状态卡片数据。
 * 三个 composer 均只返回 label / detail / tone（PipelineModuleData，无 status 字段）。
 */

import type { MergedGraph } from '@listen-graphic/schema';
import type { PipelineModuleData } from './types';
import type { AutoTourStatus, LastGraphDelta } from './types';
import type { PanelState } from './panel-reducer';
import { formatRelativeAge } from '@listen-graphic/ui';
import { bridgeHealthToTone } from './timeline-utils';
import { STRUCTURER_DELAYED_MS } from './constants';

// ===== Graph 优先级状态机时间窗 =====

/** 新增增量被视为"刚生成"的时间窗（毫秒） */
const GRAPH_FRESH_DELTA_MS = 1000;
/** 合并后图谱被视为"最近回显"的时间窗（毫秒） */
const GRAPH_RECENT_REPLAY_MS = 5000;

function graphCountDetail(prefix: string, graph: MergedGraph) {
  return `${prefix}${graph.nodes.length} 节点 · ${graph.edges.length} 关系`;
}

interface StatusCardInputs {
  panel: PanelState;
  providerAsrType: string;
  statusNowMs: number;
}

/** 计算 ASR 状态卡片 */
export function computeAsrStatusCard({
  panel,
  providerAsrType,
  statusNowMs,
}: StatusCardInputs): PipelineModuleData {
  const {
    sessionState,
    recentProviderError,
    bridgeHealth,
    lastTranscriptAt,
  } = panel;

  if (recentProviderError?.stage === 'asr') {
    return {
      label: 'ASR',
      detail: recentProviderError.message,
      tone: 'error',
    };
  }
  if (providerAsrType === 'external' && bridgeHealth.status !== 'idle') {
    return {
      label: 'ASR',
      detail:
        bridgeHealth.detail ??
        `最近稳定句子 ${formatRelativeAge(lastTranscriptAt, statusNowMs)}`,
      tone: bridgeHealthToTone(bridgeHealth.status),
    };
  }

  // 优先使用最近一句稳定转写尾部作为 detail
  const tailText = panel.lastTranscriptTail?.text.trim();
  const fallbackDetail = lastTranscriptAt
    ? `最近稳定句子 ${formatRelativeAge(lastTranscriptAt, statusNowMs)}`
    : '等待转写';

  if (sessionState === 'transcribing') {
    return {
      label: 'ASR',
      detail: tailText || fallbackDetail,
      tone: 'active',
    };
  }
  if (sessionState === 'capturing') {
    return {
      label: 'ASR',
      detail: tailText || fallbackDetail,
      tone: tailText ? 'success' : 'waiting',
    };
  }
  // F1：idle 分支使用单个 neutral（计划遗留的无效三元已收敛）
  return {
    label: 'ASR',
    detail: tailText || fallbackDetail,
    tone: 'neutral',
  };
}

/** 计算 Structurer 状态卡片 */
export function computeStructurerStatusCard({
  panel,
  statusNowMs,
}: StatusCardInputs): PipelineModuleData {
  const {
    sessionState,
    recentProviderError,
    structuringSince,
    pendingTranscriptCount,
    pendingWorkCount,
    stopPending,
    stopDrainPendingCount,
    graph,
  } = panel;

  const structurerElapsedMs =
    sessionState === 'structuring' && structuringSince
      ? Math.max(statusNowMs - structuringSince, 0)
      : 0;

  if (recentProviderError?.stage === 'structurer') {
    return {
      label: 'Structurer',
      detail: recentProviderError.message,
      tone: 'error',
    };
  }
  if (sessionState === 'structuring') {
    // 局部 status 仅用于推导 tone（detail 不再展示 status 文案）
    const isCongested = pendingTranscriptCount >= 3 || pendingWorkCount >= 4;
    const status = isCongested
      ? 'congested'
      : structurerElapsedMs >= STRUCTURER_DELAYED_MS
        ? 'delayed'
        : 'processing';
    const queueCount = Math.max(pendingTranscriptCount, pendingWorkCount);
    const elapsedText = `${Math.max(Math.round(structurerElapsedMs / 100) / 10, 0)}s`;
    const pressureText = queueCount > 0 ? `排队 ${queueCount}` : '队列 0';
    return {
      label: 'Structurer',
      detail: `${elapsedText} · ${pressureText}`,
      tone:
        status === 'processing'
          ? 'active'
          : status === 'congested'
            ? 'congested'
            : 'warning',
    };
  }
  if (stopPending && stopDrainPendingCount > 0) {
    return {
      label: 'Structurer',
      detail: `排空 剩余 ${stopDrainPendingCount} · 正在收尾`,
      tone: 'warning',
    };
  }
  if (sessionState === 'capturing' && graph.nodes.length === 0) {
    return {
      label: 'Structurer',
      detail:
        pendingTranscriptCount > 0
          ? `等待建图 · 排队 ${pendingTranscriptCount}`
          : '等待可结构化上下文',
      tone: 'waiting',
    };
  }
  return {
    label: 'Structurer',
    detail: graph.nodes.length > 0 ? '队列 0' : '等待可结构化上下文',
    tone: graph.nodes.length > 0 ? 'neutral' : 'waiting',
  };
}

// ===== Graph 优先级状态机 =====

export interface GraphStatusCardInputs {
  graph: MergedGraph;
  pendingWorkCount: number;
  recentStructurerError: PanelState['recentProviderError'];
  lastGraphDelta: LastGraphDelta;
  lastGraphUpdatedAt: number | null;
  statusNowMs: number;
  tourStatus: AutoTourStatus;
  tourProgress: { current: number; total: number };
}

/**
 * Graph 状态卡片优先级（高 → 低）：
 * 1. structurer 错误 → 保留旧图
 * 2. 新增增量 ≤ 1000ms → 新增 X 节点
 * 3. 导览中 → 导览 cur/total
 * 4. 导览暂停 → 导览暂停 cur/total
 * 5. 空图 → 等待图谱数据（优先级实质高于回显/稳定）
 * 6. 回显 ≤ 5000ms → 回显 X 节点
 * 7. 稳定 → 图谱已稳定
 *
 * 注意：空图检查在回显/稳定之前——空图时回显/稳定会产出"图谱已稳定 · 0 节点 · 0
 * 关系"的误导文案，故空图优先返回"等待图谱数据"。
 */
export function computeGraphStatusCard({
  graph,
  pendingWorkCount,
  recentStructurerError,
  lastGraphDelta,
  lastGraphUpdatedAt,
  statusNowMs,
  tourStatus,
  tourProgress,
}: GraphStatusCardInputs): PipelineModuleData {
  if (recentStructurerError?.stage === 'structurer') {
    return {
      label: 'Graph',
      detail: `保留旧图 · 待处理 ${pendingWorkCount}`,
      tone: 'error',
    };
  }

  if (
    lastGraphDelta &&
    statusNowMs - lastGraphDelta.at <= GRAPH_FRESH_DELTA_MS
  ) {
    return {
      label: 'Graph',
      detail: `新增 ${lastGraphDelta.addedNodeCount} 节点 · ${lastGraphDelta.addedEdgeCount} 关系`,
      tone: 'active',
    };
  }

  if (tourStatus === 'touring') {
    return {
      label: 'Graph',
      detail: `导览 ${tourProgress.current}/${tourProgress.total}`,
      tone: 'success',
    };
  }

  if (tourStatus === 'paused') {
    return {
      label: 'Graph',
      detail: `导览暂停 ${tourProgress.current}/${tourProgress.total}`,
      tone: 'warning',
    };
  }

  if (graph.nodes.length === 0) {
    return {
      label: 'Graph',
      detail: '等待图谱数据',
      tone: 'neutral',
    };
  }

  if (
    lastGraphUpdatedAt &&
    statusNowMs - lastGraphUpdatedAt <= GRAPH_RECENT_REPLAY_MS
  ) {
    return {
      label: 'Graph',
      detail: graphCountDetail('回显 ', graph),
      tone: 'success',
    };
  }

  return {
    label: 'Graph',
    detail: graphCountDetail('图谱已稳定 · ', graph),
    tone: 'success',
  };
}
