import type {
  TimelineStage,
  TimelineTone,
  TimelineEvent,
  StatusCardTone,
} from './types';
import {
  MIN_LOG_PANEL_HEIGHT,
  MAX_LOG_PANEL_HEIGHT,
  MAX_TIMELINE_EVENTS,
} from './constants';

// ===== 日志面板高度 =====

export function clampLogPanelHeight(nextHeight: number) {
  const viewportMax = typeof window === 'undefined'
    ? MAX_LOG_PANEL_HEIGHT
    : Math.min(MAX_LOG_PANEL_HEIGHT, Math.floor(window.innerHeight * 0.6));
  return Math.min(Math.max(nextHeight, MIN_LOG_PANEL_HEIGHT), viewportMax);
}

// ===== 格式化工具 =====

export function formatErrorStageLabel(stage: 'asr' | 'structurer') {
  return stage === 'asr' ? 'ASR' : 'Structurer';
}

export function formatRelativeAge(timestamp: number | null | undefined, now = Date.now()) {
  if (!timestamp) {
    return '暂无';
  }

  const diffMs = Math.max(now - timestamp, 0);
  if (diffMs < 1000) {
    return '刚刚';
  }
  if (diffMs < 60_000) {
    return `${Math.floor(diffMs / 1000)}s 前`;
  }
  return `${Math.floor(diffMs / 60_000)}m 前`;
}

// ===== 时间轴事件操作 =====

export function createTimelineEvent(params: {
  stage: TimelineStage;
  message: string;
  detail?: string;
  tone?: TimelineTone;
  transientKey?: string;
  aggregationKey?: string;
}): TimelineEvent {
  return {
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    timestamp: Date.now(),
    stage: params.stage,
    message: params.message,
    detail: params.detail,
    tone: params.tone ?? 'neutral',
    transientKey: params.transientKey,
    aggregationKey: params.aggregationKey,
    repeatCount: 1,
  };
}

export function upsertTimelineEvent(
  previous: TimelineEvent[],
  next: TimelineEvent,
) {
  const withoutTransient = next.transientKey
    ? previous.filter((entry) => entry.transientKey !== next.transientKey)
    : previous;
  if (next.aggregationKey) {
    const existingIndex = withoutTransient.findIndex(
      (entry) => entry.aggregationKey === next.aggregationKey,
    );
    if (existingIndex >= 0) {
      const existing = withoutTransient[existingIndex];
      const merged: TimelineEvent = {
        ...existing,
        ...next,
        id: next.id,
        timestamp: next.timestamp,
        repeatCount: (existing.repeatCount ?? 1) + 1,
      };
      return [
        merged,
        ...withoutTransient.slice(0, existingIndex),
        ...withoutTransient.slice(existingIndex + 1),
      ].slice(0, MAX_TIMELINE_EVENTS);
    }
  }
  return [next, ...withoutTransient].slice(0, MAX_TIMELINE_EVENTS);
}

export function stripTimelineTransientEvents(previous: TimelineEvent[], transientKey: string) {
  return previous.filter((entry) => entry.transientKey !== transientKey);
}

export function finalizeTransientEvent(
  previous: TimelineEvent[],
  transientKey: string,
  updates: Partial<TimelineEvent>,
): TimelineEvent[] {
  return previous.map((entry) =>
    entry.transientKey === transientKey
      ? { ...entry, ...updates, transientKey: undefined }
      : entry,
  );
}

// ===== 时间轴格式化 =====

export function formatTimelineTimestamp(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString();
}

export function classifyProgressTone(params: {
  isStructurerFinished: boolean;
  isStructurerFailed: boolean;
  isStopDrain: boolean;
  progressMessage: string;
}): TimelineTone {
  if (params.isStructurerFinished) return 'success';
  if (params.isStructurerFailed) return 'error';
  if (params.isStopDrain || params.progressMessage.includes('等待') || params.progressMessage.includes('连接中')) return 'warning';
  return 'neutral';
}

// ===== 状态卡片 =====

export function bridgeHealthToTone(status: string): StatusCardTone {
  if (status === 'error') return 'error';
  if (status === 'listening') return 'success';
  if (status === 'connecting') return 'warning';
  return 'waiting';
}

export function formatTimelineStageLabel(stage: TimelineStage) {
  switch (stage) {
    case 'asr':
      return 'ASR';
    case 'structurer':
      return 'Structurer';
    case 'graph':
      return 'Graph';
    default:
      return 'System';
  }
}

export function getTimelineToneStyles(tone: TimelineTone) {
  switch (tone) {
    case 'success':
      return {
        borderColor: '#14532d',
        badgeBackground: '#14532d',
        badgeColor: '#dcfce7',
        textColor: '#dcfce7',
        detailColor: '#86efac',
      };
    case 'warning':
      return {
        borderColor: '#92400e',
        badgeBackground: '#92400e',
        badgeColor: '#fef3c7',
        textColor: '#fde68a',
        detailColor: '#fbbf24',
      };
    case 'error':
      return {
        borderColor: '#991b1b',
        badgeBackground: '#991b1b',
        badgeColor: '#fee2e2',
        textColor: '#fecaca',
        detailColor: '#fca5a5',
      };
    default:
      return {
        borderColor: '#334155',
        badgeBackground: '#0f172a',
        badgeColor: '#cbd5e1',
        textColor: '#e2e8f0',
        detailColor: '#94a3b8',
      };
  }
}

export function getStatusCardStyles(tone: StatusCardTone) {
  switch (tone) {
    case 'active':
      return {
        backgroundColor: '#eff6ff',
        borderColor: '#93c5fd',
        titleColor: '#1d4ed8',
        statusColor: '#1e40af',
        detailColor: '#2563eb',
      };
    case 'waiting':
      return {
        backgroundColor: '#f0f9ff',
        borderColor: '#bae6fd',
        titleColor: '#0369a1',
        statusColor: '#075985',
        detailColor: '#0284c7',
      };
    case 'success':
      return {
        backgroundColor: '#ecfdf5',
        borderColor: '#86efac',
        titleColor: '#166534',
        statusColor: '#166534',
        detailColor: '#15803d',
      };
    case 'warning':
      return {
        backgroundColor: '#fffbeb',
        borderColor: '#fcd34d',
        titleColor: '#92400e',
        statusColor: '#b45309',
        detailColor: '#b45309',
      };
    case 'congested':
      return {
        backgroundColor: '#fff7ed',
        borderColor: '#fdba74',
        titleColor: '#9a3412',
        statusColor: '#c2410c',
        detailColor: '#ea580c',
      };
    case 'error':
      return {
        backgroundColor: '#fef2f2',
        borderColor: '#fca5a5',
        titleColor: '#991b1b',
        statusColor: '#991b1b',
        detailColor: '#b91c1c',
      };
    default:
      return {
        backgroundColor: '#f8fafc',
        borderColor: '#dbe4ee',
        titleColor: '#475569',
        statusColor: '#0f172a',
        detailColor: '#64748b',
      };
  }
}

// ===== 时间格式化 =====

export function formatTime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}

// ===== 导出 =====

export function timelineEventsToExportLines(events: TimelineEvent[]) {
  return events.map((event) => {
    const base = `[${formatTimelineTimestamp(event.timestamp)}] ${formatTimelineStageLabel(event.stage)}: ${event.message}`;
    return event.detail ? `${base} | ${event.detail}` : base;
  });
}
