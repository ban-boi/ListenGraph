/**
 * status-cards.ts
 *
 * 从 App.tsx 提取的纯函数，根据当前面板状态计算 ASR / Structurer 状态卡片数据。
 * Graph 摘要由 App.tsx 直接读取 panel 原始字段渲染。
 */

import type { StatusCardData } from './types';
import type { PanelState } from './panel-reducer';
import { formatRelativeAge, formatTime } from '@listen-graphic/ui';
import { bridgeHealthToTone } from './timeline-utils';
import { STRUCTURER_DELAYED_MS } from './constants';

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
}: StatusCardInputs): StatusCardData {
  const {
    sessionState,
    recentProviderError,
    bridgeHealth,
    lastTranscriptAt,
  } = panel;

  if (recentProviderError?.stage === 'asr') {
    return {
      label: 'ASR',
      status: 'error',
      detail: recentProviderError.message,
      tone: 'error',
    };
  }
  if (providerAsrType === 'external' && bridgeHealth.status !== 'idle') {
    return {
      label: 'ASR',
      status: bridgeHealth.status,
      detail:
        bridgeHealth.detail ??
        `最近稳定句子 ${formatRelativeAge(lastTranscriptAt, statusNowMs)}`,
      tone: bridgeHealthToTone(bridgeHealth.status),
    };
  }
  if (sessionState === 'transcribing') {
    return {
      label: 'ASR',
      status: 'processing',
      detail: `最近稳定句子 ${formatRelativeAge(lastTranscriptAt, statusNowMs)}`,
      tone: 'active',
    };
  }
  if (sessionState === 'capturing') {
    return {
      label: 'ASR',
      status: lastTranscriptAt ? 'stable ready' : 'listening',
      detail: `最近稳定句子 ${formatRelativeAge(lastTranscriptAt, statusNowMs)}`,
      tone: lastTranscriptAt ? 'success' : 'waiting',
    };
  }
  return {
    label: 'ASR',
    status: 'idle',
    detail: `最近稳定句子 ${formatRelativeAge(lastTranscriptAt, statusNowMs)}`,
    tone: 'neutral',
  };
}

/** 计算 Structurer 状态卡片 */
export function computeStructurerStatusCard({
  panel,
  statusNowMs,
}: StatusCardInputs): StatusCardData {
  const {
    sessionState,
    recentProviderError,
    structuringSince,
    pendingTranscriptCount,
    pendingWorkCount,
    currentStructurerTarget,
    stopPending,
    stopDrainPendingCount,
    lastStructurerRun,
    graph,
    lastTranscriptAt,
  } = panel;

  const structurerElapsedMs =
    sessionState === 'structuring' && structuringSince
      ? Math.max(statusNowMs - structuringSince, 0)
      : 0;

  if (recentProviderError?.stage === 'structurer') {
    return {
      label: 'Structurer',
      status: 'error',
      detail: recentProviderError.message,
      tone: 'error',
    };
  }
  if (sessionState === 'structuring') {
    const isCongested = pendingTranscriptCount >= 3 || pendingWorkCount >= 4;
    const status = isCongested
      ? 'congested'
      : structurerElapsedMs >= STRUCTURER_DELAYED_MS
        ? 'delayed'
        : 'processing';
    const targetDetail = currentStructurerTarget
      ? `target ${formatTime(currentStructurerTarget.transcriptEndMs)} / ${currentStructurerTarget.transcriptCharCount}字`
      : 'target unknown';
    const queueDetail =
      pendingTranscriptCount > 0 ? ` | backlog ${pendingTranscriptCount}` : '';
    const previewDetail = currentStructurerTarget?.transcriptPreview
      ? ` | "${currentStructurerTarget.transcriptPreview}"`
      : '';
    return {
      label: 'Structurer',
      status,
      detail:
        `${Math.max(Math.round(structurerElapsedMs / 100) / 10, 0)}s | ${targetDetail}${queueDetail}${previewDetail}` +
        (lastStructurerRun?.mode ? ` | ${lastStructurerRun.mode}` : ''),
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
      status: 'draining',
      detail: `stop 后剩余 ${stopDrainPendingCount} 个 work 未清空`,
      tone: 'warning',
    };
  }
  if (sessionState === 'capturing' && graph.nodes.length === 0) {
    return {
      label: 'Structurer',
      status: 'waiting bootstrap',
      detail:
        `图谱尚未建立 | 最近转写 ${formatRelativeAge(lastTranscriptAt, statusNowMs)}` +
        (pendingTranscriptCount > 0 ? ` | backlog ${pendingTranscriptCount}` : ''),
      tone: 'waiting',
    };
  }
  if (lastStructurerRun) {
    return {
      label: 'Structurer',
      status: lastStructurerRun.status,
      detail:
        `${lastStructurerRun.durationMs}ms` +
        (lastStructurerRun.errorCode ? ` | ${lastStructurerRun.errorCode}` : ''),
      tone: lastStructurerRun.status === 'success' ? 'success' : 'warning',
    };
  }
  return {
    label: 'Structurer',
    status: graph.nodes.length > 0 ? 'idle' : 'waiting',
    detail: graph.nodes.length > 0 ? '等待下一轮增量' : '等待可结构化上下文',
    tone: graph.nodes.length > 0 ? 'neutral' : 'waiting',
  };
}
