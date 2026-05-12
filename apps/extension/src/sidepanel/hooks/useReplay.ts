/**
 * useReplay.ts
 *
 * 从 App.tsx 提取的回放逻辑：
 * - replayOpen / replayPlaying / replayData 状态
 * - 回放相关回调函数
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import type { MergedGraph } from '@listen-graphic/schema';
import type { ReplaySessionData, AppMessage } from '../../shared/messages';
import type { PanelAction } from '../panel-reducer';

interface UseReplayOptions {
  sessionId: string | null;
  currentTimeMs: number;
  graph: MergedGraph;
  addLog: (msg: string) => void;
  dispatch: React.Dispatch<PanelAction>;
}

export function useReplay({ sessionId, currentTimeMs, graph, addLog, dispatch }: UseReplayOptions) {
  const [replayOpen, setReplayOpen] = useState(false);
  const [replayPlaying, setReplayPlaying] = useState(false);
  const [replayData, setReplayData] = useState<ReplaySessionData | null>(null);
  const currentTimeMsRef = useRef(currentTimeMs);
  currentTimeMsRef.current = currentTimeMs;

  // sessionId 变化时重置 replay
  useEffect(() => {
    setReplayOpen(false);
    setReplayPlaying(false);
    setReplayData(null);
  }, [sessionId]);

  // replay ticker
  useEffect(() => {
    if (!replayPlaying || !replayData) {
      return;
    }

    const timer = window.setInterval(() => {
      const prev = currentTimeMsRef.current;
      const next = Math.min(prev + 1000, replayData.durationMs);
      if (next >= replayData.durationMs) {
        setReplayPlaying(false);
      }
      dispatch({ type: 'PLAYBACK_TIME_UPDATED', payload: { currentTimeMs: next } });
    }, 1000);

    return () => window.clearInterval(timer);
  }, [replayData, replayPlaying, dispatch]);

  const handleToggleReplay = useCallback(async () => {
    if (replayOpen) {
      setReplayOpen(false);
      setReplayPlaying(false);
      return;
    }

    setReplayOpen(true);
    setReplayPlaying(false);

    if (!sessionId) {
      setReplayData(null);
      return;
    }

    try {
      const response = (await chrome.runtime.sendMessage({
        type: 'GET_REPLAY_SESSION',
        target: 'service-worker',
        payload: { sessionId },
      } as AppMessage)) as
        | { success: true; replayData: ReplaySessionData }
        | { success: false; error?: string };

      if (!response?.success) {
        addLog(`回放数据加载失败: ${response?.error || '未知错误'}`);
        return;
      }

      setReplayData(response.replayData);
      dispatch({ type: 'PLAYBACK_TIME_UPDATED', payload: { currentTimeMs: 0 } });
      dispatch({ type: 'SELECT_NODE', payload: { nodeId: null } });
    } catch (error) {
      const message = error instanceof Error ? error.message : '未知错误';
      addLog(`回放数据加载失败: ${message}`);
    }
  }, [addLog, dispatch, replayOpen, sessionId]);

  const handleReplayTogglePlay = useCallback(
    (timeMs: number) => {
      if (!replayData) return;
      if (timeMs >= replayData.durationMs) {
        dispatch({ type: 'PLAYBACK_TIME_UPDATED', payload: { currentTimeMs: 0 } });
        dispatch({ type: 'SELECT_NODE', payload: { nodeId: null } });
      }
      setReplayPlaying((prev) => !prev);
    },
    [dispatch, replayData],
  );

  const handleReplayScrub = useCallback(
    (nextTimeMs: number) => {
      setReplayPlaying(false);
      dispatch({ type: 'PLAYBACK_TIME_UPDATED', payload: { currentTimeMs: nextTimeMs } });
      if (graph.nodes.length === 0) {
        dispatch({ type: 'SELECT_NODE', payload: { nodeId: null } });
        return;
      }
      const nearest = graph.nodes.reduce((a, b) =>
        Math.abs(a.timestampMs - nextTimeMs) < Math.abs(b.timestampMs - nextTimeMs)
          ? a
          : b,
      );
      dispatch({ type: 'SELECT_NODE', payload: { nodeId: nearest.id } });
    },
    [dispatch, graph.nodes],
  );

  return {
    replayOpen,
    replayPlaying,
    replayData,
    handleToggleReplay,
    handleReplayTogglePlay,
    handleReplayScrub,
  };
}
