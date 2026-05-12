/**
 * useTimeline.ts
 *
 * 从 App.tsx 提取的时间轴相关逻辑：
 * - structurer 慢速检测 effect
 * - transcript backlog 追踪 effect
 * - pushTimelineEvent / clearTimelineTransient / finalizeTimelineTransient / addLog callbacks
 */

import { useCallback, useEffect, useRef } from 'react';
import type { TimelineEvent } from '../types';
import { createTimelineEvent } from '../timeline-utils';
import { STRUCTURER_DELAYED_MS } from '../constants';
import type { PanelAction } from '../panel-reducer';

interface UseTimelineOptions {
  /** 当前面板状态的快照字段 */
  sessionState: string;
  sessionId: string | null;
  structuringSince: number | null;
  statusNowMs: number;
  pendingTranscriptCount: number;
  currentStructurerTarget: {
    transcriptId?: string;
    transcriptEndMs?: number;
    transcriptCharCount?: number;
    transcriptPreview?: string;
  } | null;
  dispatch: React.Dispatch<PanelAction>;
}

export function useTimeline({
  sessionState,
  sessionId,
  structuringSince,
  statusNowMs,
  pendingTranscriptCount,
  currentStructurerTarget,
  dispatch,
}: UseTimelineOptions) {
  const structurerSlowEventKeyRef = useRef<string | null>(null);
  const previousPendingTranscriptCountRef = useRef(0);

  const pushTimelineEvent = useCallback(
    (event: TimelineEvent) => {
      dispatch({ type: 'PUSH_TIMELINE_EVENT', payload: { event } });
    },
    [dispatch],
  );

  const clearTimelineTransient = useCallback(
    (transientKey: string) => {
      dispatch({ type: 'CLEAR_TIMELINE_TRANSIENT', payload: { transientKey } });
    },
    [dispatch],
  );

  const finalizeTimelineTransient = useCallback(
    (transientKey: string, updates: Partial<TimelineEvent>) => {
      dispatch({
        type: 'FINALIZE_TIMELINE_TRANSIENT',
        payload: { transientKey, updates },
      });
    },
    [dispatch],
  );

  const addLog = useCallback(
    (msg: string) => {
      pushTimelineEvent(createTimelineEvent({ stage: 'system', message: msg }));
    },
    [pushTimelineEvent],
  );

  // structurer 慢速检测
  useEffect(() => {
    if (sessionState !== 'structuring' || !structuringSince) {
      structurerSlowEventKeyRef.current = null;
      return;
    }

    const slowEventKey = `${sessionId ?? 'unknown'}:${structuringSince}`;
    if (
      statusNowMs - structuringSince >= STRUCTURER_DELAYED_MS &&
      structurerSlowEventKeyRef.current !== slowEventKey
    ) {
      structurerSlowEventKeyRef.current = slowEventKey;
      pushTimelineEvent(
        createTimelineEvent({
          stage: 'structurer',
          message: 'Structurer slow',
          detail: `${Math.round((statusNowMs - structuringSince) / 100) / 10}s 仍未返回`,
          tone: 'warning',
        }),
      );
    }
  }, [pushTimelineEvent, sessionId, sessionState, statusNowMs, structuringSince]);

  // transcript backlog 追踪
  useEffect(() => {
    const previous = previousPendingTranscriptCountRef.current;
    if (
      sessionState === 'structuring' &&
      pendingTranscriptCount > previous &&
      pendingTranscriptCount > 0
    ) {
      pushTimelineEvent(
        createTimelineEvent({
          stage: 'structurer',
          message: `Transcript queued behind current structurer`,
          detail: `backlog ${pendingTranscriptCount} | target ${currentStructurerTarget?.transcriptId ?? 'unknown'}`,
          tone: pendingTranscriptCount >= 3 ? 'warning' : 'neutral',
          aggregationKey: 'structurer-queue-growth',
        }),
      );
    }
    previousPendingTranscriptCountRef.current = pendingTranscriptCount;
  }, [
    currentStructurerTarget?.transcriptId,
    pendingTranscriptCount,
    pushTimelineEvent,
    sessionState,
  ]);

  return {
    pushTimelineEvent,
    clearTimelineTransient,
    finalizeTimelineTransient,
    addLog,
  };
}
