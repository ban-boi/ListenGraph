/**
 * useSessionControl.ts
 *
 * 从 App.tsx 提取的会话控制逻辑：
 * - handleStart / handleStop
 * - clearHistoricalContext / resetRuntimeUiState
 */

import { useCallback } from 'react';
import type { MergedGraph } from '@listen-graphic/schema';
import type { AppMessage } from '../../shared/messages';
import { createEmptyGraph, MOCK_TRANSCRIPTS, NODE_TYPES, EDGE_TYPES, SPEAKERS, isDevMode } from '../constants';
import type { PanelAction } from '../panel-reducer';
import type { TimelineEvent } from '../types';

interface UseSessionControlOptions {
  panel: {
    sessionId: string | null;
    sessionState: string;
  };
  dispatch: React.Dispatch<PanelAction>;
  addLog: (msg: string) => void;
  pushTimelineEvent: (event: TimelineEvent) => void;
  resetAutoTourState: () => void;
  resetLayoutCache: () => void;
  /** 清除上下文时额外的清理回调（如关闭 debug panel） */
  onClearContext?: () => void;
  userPinnedViewRef: React.MutableRefObject<boolean>;
  activeViewSessionRef: React.MutableRefObject<string | null>;
  transcriptIndexRef: React.MutableRefObject<number>;
  sessionStartTimeRef: React.MutableRefObject<number>;
  graphRef: React.MutableRefObject<MergedGraph>;
}

export function useSessionControl({
  panel,
  dispatch,
  addLog,
  pushTimelineEvent,
  resetAutoTourState,
  resetLayoutCache,
  onClearContext,
  userPinnedViewRef,
  activeViewSessionRef,
  transcriptIndexRef,
  sessionStartTimeRef,
  graphRef,
}: UseSessionControlOptions) {
  const clearHistoricalContext = useCallback(() => {
    dispatch({ type: 'RESET_CONTEXT' });
    userPinnedViewRef.current = false;
    activeViewSessionRef.current = null;
    resetAutoTourState();
    onClearContext?.();
  }, [dispatch, resetAutoTourState, userPinnedViewRef, activeViewSessionRef, onClearContext]);

  const resetRuntimeUiState = useCallback(() => {
    dispatch({ type: 'RESET_RUNTIME_UI' });
  }, [dispatch]);

  const handleStart = useCallback(() => {
    if (isDevMode) {
      const newSessionId = `session_${Date.now()}`;
      transcriptIndexRef.current = 0;
      sessionStartTimeRef.current = Date.now();

      dispatch({
        type: 'SESSION_STATE_CHANGED',
        payload: {
          state: 'capturing',
          sessionId: newSessionId,
          shouldPreserveView: false,
        },
      });
      userPinnedViewRef.current = false;
      dispatch({ type: 'RESET_RUNTIME_UI' });

      const initialGraph: MergedGraph = {
        sessionId: newSessionId,
        revision: 0,
        topics: [{ topicId: 't1', title: '当前话题', startMs: 0, endMs: 0 }],
        nodes: [],
        edges: [],
        updatedAt: Date.now(),
      };
      dispatch({
        type: 'MERGED_GRAPH_UPDATED',
        payload: {
          graph: initialGraph,
          shouldPreserveView: false,
          previousGraph: createEmptyGraph(),
          addedNodeIds: [],
          anchorNodeIds: [],
        },
      });

      addLog(`会话开始: ${newSessionId}`);
      addLog('状态: capturing (开发模式)');
      return;
    }

    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      if (!tabs[0]?.id) return;
      clearHistoricalContext();
      dispatch({
        type: 'SESSION_STATE_CHANGED',
        payload: { state: 'capturing', sessionId: null, shouldPreserveView: false },
      });
      resetRuntimeUiState();

      const res = await chrome.runtime.sendMessage({
        type: 'SESSION_START',
        target: 'service-worker',
        payload: { tabId: tabs[0].id, sourceType: 'tab' },
      } as AppMessage);
      if (res?.success) {
        dispatch({
          type: 'SESSION_STATE_CHANGED',
          payload: {
            state: 'capturing',
            sessionId: res.sessionId,
            shouldPreserveView: false,
          },
        });
        dispatch({ type: 'SET_STOP_PENDING', payload: { stopPending: false } });
        userPinnedViewRef.current = false;
        addLog(`已启动: ${res.sessionId}`);
      } else {
        dispatch({ type: 'SET_STOP_PENDING', payload: { stopPending: false } });
        dispatch({
          type: 'SESSION_STATE_CHANGED',
          payload: { state: 'error', sessionId: null, shouldPreserveView: false },
        });
        addLog(`失败: ${res?.error}`);
      }
    });
  }, [
    addLog,
    clearHistoricalContext,
    dispatch,
    resetRuntimeUiState,
    transcriptIndexRef,
    sessionStartTimeRef,
    userPinnedViewRef,
  ]);

  const handleStop = useCallback(() => {
    if (isDevMode) {
      dispatch({
        type: 'SESSION_STATE_CHANGED',
        payload: { state: 'idle', sessionId: null, shouldPreserveView: false },
      });
      addLog('状态: idle');
      addLog('会话已停止');
      return;
    }

    if (!panel.sessionId) return;
    dispatch({ type: 'SET_STOP_PENDING', payload: { stopPending: true } });
    pushTimelineEvent({
      id: `tl-stop-${Date.now()}`,
      timestamp: Date.now(),
      stage: 'system',
      message: '已请求停止',
      detail: '等待 service worker 清理当前会话',
      tone: 'warning',
    });
    void chrome.runtime.sendMessage({
      type: 'SESSION_STOP',
      target: 'service-worker',
      payload: { sessionId: panel.sessionId },
    } as AppMessage);
  }, [dispatch, panel.sessionId, pushTimelineEvent, addLog]);

  return {
    clearHistoricalContext,
    resetRuntimeUiState,
    handleStart,
    handleStop,
  };
}
