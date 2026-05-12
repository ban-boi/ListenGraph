/**
 * useAutoTour.ts
 *
 * 从 App.tsx 提取的自动导览逻辑：
 * - autoTourStatus / autoTourProgress 状态
 * - 所有 auto-tour refs
 * - auto-tour callbacks 和 timer cleanup
 */

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { getViewportForBounds } from 'reactflow';
import type { MergedGraph, ViewType } from '@listen-graphic/schema';
import type { Node, Edge } from 'reactflow';
import type {
  AutoTourSeed,
  AutoTourBatch,
  AutoTourStatus,
  DebugViewArtifact,
  StableLayoutCache,
} from '../types';
import {
  getAutoRevealAnchorNodeIds,
  getNodeBounds,
  mergeViewBounds,
  expandViewBounds,
  ensureMinimumBoundsSize,
  getAutoRevealMinimumBoundsSize,
  isViewportCloseToTarget,
  buildAutoTourBatches,
} from '../auto-tour-utils';
import {
  AUTO_REVEAL_PADDING,
  AUTO_REVEAL_DURATION_MS,
  USER_VIEWPORT_COOLDOWN_MS,
  AUTO_TOUR_RESUME_DELAY_MS,
} from '../constants';
import type { ReactFlowInstance } from 'reactflow';

interface UseAutoTourOptions {
  graph: MergedGraph;
  currentView: ViewType;
  /** debugViewArtifacts 通过 ref 传入以避免闭包陈旧问题 */
  debugViewArtifactsRef: React.MutableRefObject<Record<ViewType, DebugViewArtifact>>;
  /** flowEdges 通过 ref 传入 */
  flowEdgesRef: React.MutableRefObject<Edge[]>;
  flowContainerRef: React.RefObject<HTMLDivElement | null>;
  reactFlowInstanceRef: React.RefObject<ReactFlowInstance | null>;
  /** 重置 auto tour 时的回调（用于重置 layoutCache 等） */
  onReset?: () => void;
}

export function useAutoTour({
  graph,
  currentView,
  debugViewArtifactsRef,
  flowEdgesRef,
  flowContainerRef,
  reactFlowInstanceRef,
  onReset,
}: UseAutoTourOptions) {
  const [autoTourStatus, setAutoTourStatus] = useState<AutoTourStatus>('idle');
  const [autoTourProgress, setAutoTourProgress] = useState<{
    current: number;
    total: number;
  }>({ current: 0, total: 0 });

  const pendingAutoTourRef = useRef<AutoTourSeed | null>(null);
  const autoTourBatchesRef = useRef<AutoTourBatch[]>([]);
  const autoTourCurrentIndexRef = useRef(-1);
  const autoTourResumeIndexRef = useRef(0);
  const autoTourAdvanceTimerRef = useRef<number | null>(null);
  const autoTourResumeTimerRef = useRef<number | null>(null);
  const lastAutoTourKeyRef = useRef<string | null>(null);
  const userViewportInteractingRef = useRef(false);
  const lastUserViewportChangeAtRef = useRef(0);

  const clearAutoTourAdvanceTimer = useCallback(() => {
    if (autoTourAdvanceTimerRef.current !== null) {
      window.clearTimeout(autoTourAdvanceTimerRef.current);
      autoTourAdvanceTimerRef.current = null;
    }
  }, []);

  const clearAutoTourResumeTimer = useCallback(() => {
    if (autoTourResumeTimerRef.current !== null) {
      window.clearTimeout(autoTourResumeTimerRef.current);
      autoTourResumeTimerRef.current = null;
    }
  }, []);

  const resetAutoTourState = useCallback(
    (nextStatus: AutoTourStatus = 'idle') => {
      clearAutoTourAdvanceTimer();
      clearAutoTourResumeTimer();
      autoTourBatchesRef.current = [];
      autoTourCurrentIndexRef.current = -1;
      autoTourResumeIndexRef.current = 0;
      pendingAutoTourRef.current = null;
      lastAutoTourKeyRef.current = null;
      setAutoTourStatus(nextStatus);
      setAutoTourProgress({ current: 0, total: 0 });
      onReset?.();
    },
    [clearAutoTourAdvanceTimer, clearAutoTourResumeTimer, onReset],
  );

  useEffect(
    () => () => {
      clearAutoTourAdvanceTimer();
      clearAutoTourResumeTimer();
    },
    [clearAutoTourAdvanceTimer, clearAutoTourResumeTimer],
  );

  const buildAutoTourTargetBounds = useCallback(
    (batch: AutoTourBatch) => {
      const inst = reactFlowInstanceRef.current;
      const el = flowContainerRef.current;
      if (!inst?.getViewport || !el) {
        return null;
      }

      const containerWidth = el.clientWidth ?? 0;
      const containerHeight = el.clientHeight ?? 0;
      if (containerWidth < 2 || containerHeight < 2) {
        return null;
      }

      const currentViewport = inst.getViewport();
      const artifactsForView = debugViewArtifactsRef.current[currentView];
      if (!artifactsForView) {
        return null;
      }
      const nodeIds = new Set([...batch.nodeIds, ...batch.anchorNodeIds]);
      const targetNodes = artifactsForView.reactFlow.nodes.filter(
        (node) => nodeIds.has(node.id),
      );
      const mergedBounds = mergeViewBounds(targetNodes.map(getNodeBounds));
      if (!mergedBounds) {
        return null;
      }

      const paddedBounds = expandViewBounds(mergedBounds, AUTO_REVEAL_PADDING);
      const minimumBoundsSize = getAutoRevealMinimumBoundsSize({
        containerWidth,
        containerHeight,
        currentZoom: currentViewport.zoom || 1,
      });
      const targetBounds = ensureMinimumBoundsSize({
        bounds: paddedBounds,
        minimumWidth: minimumBoundsSize.minimumWidth,
        minimumHeight: minimumBoundsSize.minimumHeight,
      });

      const viewportForBounds = getViewportForBounds(
        {
          x: targetBounds.left,
          y: targetBounds.top,
          width: targetBounds.right - targetBounds.left,
          height: targetBounds.bottom - targetBounds.top,
        },
        containerWidth,
        containerHeight,
        0.3,
        2,
        0,
      );

      return {
        currentViewport,
        targetViewport: viewportForBounds,
        targetBounds,
      };
    },
    [currentView, flowContainerRef, reactFlowInstanceRef],
  );

  const playAutoTourBatch = useCallback(
    (index: number) => {
      const batch = autoTourBatchesRef.current[index];
      if (!batch) {
        setAutoTourStatus('idle');
        return;
      }

      const inst = reactFlowInstanceRef.current;
      const target = buildAutoTourTargetBounds(batch);
      if (!inst?.fitBounds || !target) {
        setAutoTourStatus('idle');
        return;
      }

      autoTourCurrentIndexRef.current = index;
      autoTourResumeIndexRef.current = index + 1;
      setAutoTourStatus('touring');
      setAutoTourProgress({
        current: index + 1,
        total: autoTourBatchesRef.current.length,
      });

      inst.fitBounds(
        {
          x: target.targetBounds.left,
          y: target.targetBounds.top,
          width: target.targetBounds.right - target.targetBounds.left,
          height: target.targetBounds.bottom - target.targetBounds.top,
        },
        {
          duration: AUTO_REVEAL_DURATION_MS,
          padding: 0,
        },
      );

      clearAutoTourAdvanceTimer();
      autoTourAdvanceTimerRef.current = window.setTimeout(() => {
        const nextIndex = index + 1;
        if (nextIndex >= autoTourBatchesRef.current.length) {
          clearAutoTourAdvanceTimer();
          setAutoTourStatus('idle');
          return;
        }
        playAutoTourBatch(nextIndex);
      }, AUTO_REVEAL_DURATION_MS + batch.dwellMs);
    },
    [buildAutoTourTargetBounds, clearAutoTourAdvanceTimer, reactFlowInstanceRef],
  );

  const scheduleAutoTourResume = useCallback(() => {
    clearAutoTourResumeTimer();
    autoTourResumeTimerRef.current = window.setTimeout(() => {
      const nextIndex = autoTourResumeIndexRef.current;
      if (nextIndex >= autoTourBatchesRef.current.length) {
        setAutoTourStatus('idle');
        return;
      }
      playAutoTourBatch(nextIndex);
    }, AUTO_TOUR_RESUME_DELAY_MS);
  }, [clearAutoTourResumeTimer, playAutoTourBatch]);

  const pauseAutoTour = useCallback(() => {
    if (autoTourBatchesRef.current.length === 0) {
      return;
    }

    clearAutoTourAdvanceTimer();
    const nextReadableIndex = Math.min(
      autoTourResumeIndexRef.current + 1,
      autoTourBatchesRef.current.length,
    );
    setAutoTourStatus('paused');
    setAutoTourProgress({
      current: nextReadableIndex,
      total: autoTourBatchesRef.current.length,
    });
    scheduleAutoTourResume();
  }, [clearAutoTourAdvanceTimer, scheduleAutoTourResume]);

  const maybeStartAutoTour = useCallback(() => {
    const pending = pendingAutoTourRef.current;
    if (
      !pending ||
      pending.sessionId !== graph.sessionId ||
      pending.revision !== graph.revision
    ) {
      return;
    }

    if (
      userViewportInteractingRef.current ||
      Date.now() - lastUserViewportChangeAtRef.current < USER_VIEWPORT_COOLDOWN_MS
    ) {
      return;
    }

    const inst = reactFlowInstanceRef.current;
    const el = flowContainerRef.current;
    if (!inst?.getViewport || !el) {
      return;
    }

    const autoTourKey = `${pending.sessionId}:${pending.revision}:${currentView}`;
    if (lastAutoTourKeyRef.current === autoTourKey) {
      return;
    }

    const artifactsForView = debugViewArtifactsRef.current[currentView];
    if (!artifactsForView) {
      return;
    }

    const batches = buildAutoTourBatches({
      seed: pending,
      flowNodes: artifactsForView.reactFlow.nodes,
      flowEdges: flowEdgesRef.current,
      containerWidth: el.clientWidth ?? 0,
      containerHeight: el.clientHeight ?? 0,
      currentZoom: inst.getViewport().zoom || 1,
    });
    if (batches.length === 0) {
      pendingAutoTourRef.current = null;
      return;
    }

    const firstTarget = buildAutoTourTargetBounds(batches[0]);
    if (
      batches.length === 1 &&
      firstTarget &&
      isViewportCloseToTarget({
        current: firstTarget.currentViewport,
        target: firstTarget.targetViewport,
      })
    ) {
      pendingAutoTourRef.current = null;
      return;
    }

    autoTourBatchesRef.current = batches;
    autoTourCurrentIndexRef.current = -1;
    autoTourResumeIndexRef.current = 0;
    pendingAutoTourRef.current = null;
    lastAutoTourKeyRef.current = autoTourKey;
    playAutoTourBatch(0);
  }, [
    buildAutoTourTargetBounds,
    currentView,
    flowContainerRef,
    graph.revision,
    graph.sessionId,
    playAutoTourBatch,
    reactFlowInstanceRef,
  ]);

  /** 在 MERGED_GRAPH_UPDATED 消息中调用，设置 pending seed */
  const setAutoTourSeed = useCallback(
    (seed: AutoTourSeed | null) => {
      clearAutoTourAdvanceTimer();
      clearAutoTourResumeTimer();
      autoTourBatchesRef.current = [];
      autoTourCurrentIndexRef.current = -1;
      autoTourResumeIndexRef.current = 0;
      pendingAutoTourRef.current = seed;
      lastAutoTourKeyRef.current = null;
      setAutoTourStatus('idle');
      setAutoTourProgress({ current: 0, total: 0 });
    },
    [clearAutoTourAdvanceTimer, clearAutoTourResumeTimer],
  );

  return {
    autoTourStatus,
    autoTourProgress,
    userViewportInteractingRef,
    lastUserViewportChangeAtRef,
    pendingAutoTourRef,
    resetAutoTourState,
    pauseAutoTour,
    maybeStartAutoTour,
    setAutoTourSeed,
  };
}
