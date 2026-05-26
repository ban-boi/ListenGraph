/**
 * useAutoTour.ts
 *
 * 从 App.tsx 提取的自动导览逻辑：
 * - autoTourStatus / autoTourProgress 状态
 * - 所有 auto-tour refs
 * - auto-tour callbacks 和 timer cleanup
 * - 两阶段导览：结构揭示 + 阅读聚焦
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { getViewportForBounds } from 'reactflow';
import type { MergedGraph, ViewType } from '@listen-graphic/schema';
import type { Node, Edge } from 'reactflow';
import type {
  AutoTourSeed,
  AutoTourStage,
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
  buildTwoStageAutoTourStages,
} from '../auto-tour-utils';
import {
  AUTO_REVEAL_PADDING,
  AUTO_REVEAL_DURATION_MS,
  USER_VIEWPORT_COOLDOWN_MS,
  AUTO_TOUR_RESUME_DELAY_MS,
} from '../constants';
import { recordAutoTourTrace } from '../auto-tour-trace';
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
  autoFitMinReadableFontPx: number;
  graphNodeBodyFontPx: number;
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
  autoFitMinReadableFontPx,
  graphNodeBodyFontPx,
  onReset,
}: UseAutoTourOptions) {
  const [autoTourStatus, setAutoTourStatus] = useState<AutoTourStatus>('idle');
  const [autoTourProgress, setAutoTourProgress] = useState<{
    current: number;
    total: number;
  }>({ current: 0, total: 0 });
  const [activeAutoTourStage, setActiveAutoTourStage] =
    useState<AutoTourStage | null>(null);

  const pendingAutoTourRef = useRef<AutoTourSeed | null>(null);
  const autoTourBatchesRef = useRef<AutoTourStage[]>([]);
  const autoTourCurrentIndexRef = useRef(-1);
  const autoTourResumeIndexRef = useRef(0);
  const autoTourAdvanceTimerRef = useRef<number | null>(null);
  const autoTourResumeTimerRef = useRef<number | null>(null);
  const lastAutoTourKeyRef = useRef<string | null>(null);
  const userViewportInteractingRef = useRef(false);
  const lastUserViewportChangeAtRef = useRef(0);
  const autoTourQueueRef = useRef<AutoTourStage[][]>([]);
  const pendingAutoTourSeedsRef = useRef<AutoTourSeed[]>([]);
  const pendingSeedRetryTimerRef = useRef<number | null>(null);
  const programmaticViewportChangeCountRef = useRef(0);
  const programmaticViewportChangeUntilRef = useRef(0);
  const maybeStartAutoTourRef = useRef<() => void>(() => {});

  const getRuntimeTraceState = useCallback(
    () => ({
      sessionId: graph.sessionId,
      revision: graph.revision,
      currentView,
      pending: pendingAutoTourRef.current
        ? {
            revision: pendingAutoTourRef.current.revision,
            nodeIds: pendingAutoTourRef.current.nodeIds,
            anchorNodeIds: pendingAutoTourRef.current.anchorNodeIds,
          }
        : null,
      pendingSeedCount: pendingAutoTourSeedsRef.current.length,
      batchCount: autoTourBatchesRef.current.length,
      queueCount: autoTourQueueRef.current.length,
      currentIndex: autoTourCurrentIndexRef.current,
      resumeIndex: autoTourResumeIndexRef.current,
      hasAdvanceTimer: autoTourAdvanceTimerRef.current !== null,
      hasResumeTimer: autoTourResumeTimerRef.current !== null,
      hasPendingRetryTimer: pendingSeedRetryTimerRef.current !== null,
      userInteracting: userViewportInteractingRef.current,
      lastUserViewportAgeMs: Date.now() - lastUserViewportChangeAtRef.current,
      programmaticCount: programmaticViewportChangeCountRef.current,
      programmaticRemainingMs: Math.max(
        0,
        programmaticViewportChangeUntilRef.current - Date.now(),
      ),
    }),
    [currentView, graph.revision, graph.sessionId],
  );

  const trace = useCallback(
    (event: string, details?: Record<string, unknown>) => {
      recordAutoTourTrace(event, {
        ...getRuntimeTraceState(),
        ...details,
      });
    },
    [getRuntimeTraceState],
  );

  const isProgrammaticViewportChange = useCallback(
    () =>
      programmaticViewportChangeCountRef.current > 0 ||
      Date.now() < programmaticViewportChangeUntilRef.current,
    [],
  );

  const withProgrammaticViewportChange = useCallback((action: () => void) => {
    programmaticViewportChangeCountRef.current += 1;
    programmaticViewportChangeUntilRef.current = Math.max(
      programmaticViewportChangeUntilRef.current,
      Date.now() + AUTO_REVEAL_DURATION_MS + 120,
    );
    try {
      trace('programmatic-viewport-start');
      action();
    } finally {
      queueMicrotask(() => {
        programmaticViewportChangeCountRef.current = Math.max(
          0,
          programmaticViewportChangeCountRef.current - 1,
        );
        trace('programmatic-viewport-release');
      });
    }
  }, [trace]);

  const schedulePendingAutoTourDrain = useCallback(() => {
    trace('schedule-pending-drain');
    queueMicrotask(() => {
      trace('run-pending-drain');
      maybeStartAutoTourRef.current();
    });
  }, [trace]);

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

  const clearPendingSeedRetryTimer = useCallback(() => {
    if (pendingSeedRetryTimerRef.current !== null) {
      window.clearTimeout(pendingSeedRetryTimerRef.current);
      pendingSeedRetryTimerRef.current = null;
    }
  }, []);

  const clearCompletedAutoTourUnit = useCallback(() => {
    autoTourBatchesRef.current = [];
    autoTourCurrentIndexRef.current = -1;
    autoTourResumeIndexRef.current = 0;
    setActiveAutoTourStage(null);
  }, []);

  const resetAutoTourState = useCallback(
    (nextStatus: AutoTourStatus = 'idle') => {
      clearAutoTourAdvanceTimer();
      clearAutoTourResumeTimer();
      clearPendingSeedRetryTimer();
      clearCompletedAutoTourUnit();
      pendingAutoTourRef.current = null;
      pendingAutoTourSeedsRef.current = [];
      autoTourQueueRef.current = [];
      lastAutoTourKeyRef.current = null;
      setAutoTourStatus(nextStatus);
      setAutoTourProgress({ current: 0, total: 0 });
      onReset?.();
    },
    [
      clearAutoTourAdvanceTimer,
      clearAutoTourResumeTimer,
      clearPendingSeedRetryTimer,
      clearCompletedAutoTourUnit,
      onReset,
    ],
  );

  useEffect(
    () => () => {
      clearAutoTourAdvanceTimer();
      clearAutoTourResumeTimer();
      clearPendingSeedRetryTimer();
    },
    [clearAutoTourAdvanceTimer, clearAutoTourResumeTimer, clearPendingSeedRetryTimer],
  );

  const buildAutoTourTargetBounds = useCallback(
    (stage: AutoTourStage) => {
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
      const nodeIds = new Set([...stage.nodeIds, ...stage.anchorNodeIds]);
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
      const stage = autoTourBatchesRef.current[index];
      if (!stage) {
        trace('play-no-stage', { index });
        setActiveAutoTourStage(null);
        setAutoTourStatus('idle');
        const nextUnit = autoTourQueueRef.current.shift();
        if (nextUnit) {
          trace('play-shift-next-unit', { nextStageCount: nextUnit.length });
          autoTourBatchesRef.current = nextUnit;
          autoTourCurrentIndexRef.current = -1;
          autoTourResumeIndexRef.current = 0;
          playAutoTourBatch(0);
          return;
        }
        clearCompletedAutoTourUnit();
        schedulePendingAutoTourDrain();
        return;
      }

      const inst = reactFlowInstanceRef.current;
      const target = buildAutoTourTargetBounds(stage);
      if (!inst?.fitBounds || !target) {
        trace('play-target-unavailable', {
          index,
          hasFitBounds: Boolean(inst?.fitBounds),
          hasTarget: Boolean(target),
          containerWidth: flowContainerRef.current?.clientWidth ?? null,
          containerHeight: flowContainerRef.current?.clientHeight ?? null,
        });
        setActiveAutoTourStage(null);
        setAutoTourStatus('idle');
        clearAutoTourResumeTimer();
        autoTourResumeTimerRef.current = window.setTimeout(() => {
          playAutoTourBatch(index);
        }, AUTO_TOUR_RESUME_DELAY_MS);
        return;
      }

      autoTourCurrentIndexRef.current = index;
      autoTourResumeIndexRef.current = index + 1;
      setActiveAutoTourStage(stage);
      setAutoTourStatus('touring');
      setAutoTourProgress({
        current: index + 1,
        total: autoTourBatchesRef.current.length,
      });
      trace('play-fit-bounds', {
        index,
        stageKind: stage.kind,
        nodeIds: stage.nodeIds,
        anchorNodeIds: stage.anchorNodeIds,
        targetBounds: target.targetBounds,
        currentViewport: target.currentViewport,
        targetViewport: target.targetViewport,
      });

      withProgrammaticViewportChange(() => {
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
      });

      clearAutoTourAdvanceTimer();
      autoTourAdvanceTimerRef.current = window.setTimeout(() => {
        const nextIndex = index + 1;
        if (nextIndex >= autoTourBatchesRef.current.length) {
          trace('advance-finished-unit', { index });
          clearAutoTourAdvanceTimer();
          setActiveAutoTourStage(null);
          const nextUnit = autoTourQueueRef.current.shift();
          if (nextUnit) {
            trace('advance-shift-next-unit', { nextStageCount: nextUnit.length });
            autoTourBatchesRef.current = nextUnit;
            autoTourCurrentIndexRef.current = -1;
            autoTourResumeIndexRef.current = 0;
            playAutoTourBatch(0);
            return;
          }
          clearCompletedAutoTourUnit();
          setAutoTourStatus('idle');
          schedulePendingAutoTourDrain();
          return;
        }
        trace('advance-next-stage', { nextIndex });
        playAutoTourBatch(nextIndex);
      }, AUTO_REVEAL_DURATION_MS + stage.dwellMs);
    },
    [
      buildAutoTourTargetBounds,
      clearAutoTourAdvanceTimer,
      clearCompletedAutoTourUnit,
      clearAutoTourResumeTimer,
      flowContainerRef,
      reactFlowInstanceRef,
      schedulePendingAutoTourDrain,
      trace,
      withProgrammaticViewportChange,
    ],
  );

  const scheduleAutoTourResume = useCallback(() => {
    clearAutoTourResumeTimer();
    trace('schedule-resume');
    autoTourResumeTimerRef.current = window.setTimeout(() => {
      const nextIndex = autoTourResumeIndexRef.current;
      if (nextIndex >= autoTourBatchesRef.current.length) {
        const nextUnit = autoTourQueueRef.current.shift();
        if (nextUnit) {
          trace('resume-shift-next-unit', { nextStageCount: nextUnit.length });
          autoTourBatchesRef.current = nextUnit;
          autoTourCurrentIndexRef.current = -1;
          autoTourResumeIndexRef.current = 0;
          playAutoTourBatch(0);
          return;
        }
        clearCompletedAutoTourUnit();
        setAutoTourStatus('idle');
        schedulePendingAutoTourDrain();
        return;
      }
      trace('resume-next-stage', { nextIndex });
      playAutoTourBatch(nextIndex);
    }, AUTO_TOUR_RESUME_DELAY_MS);
  }, [
    clearAutoTourResumeTimer,
    clearCompletedAutoTourUnit,
    playAutoTourBatch,
    schedulePendingAutoTourDrain,
    trace,
  ]);

  const pauseAutoTour = useCallback((options?: { force?: boolean }) => {
    if (!options?.force && isProgrammaticViewportChange()) {
      trace('pause-ignored-programmatic');
      return;
    }
    if (autoTourBatchesRef.current.length === 0) {
      trace('pause-ignored-no-batches');
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
    trace('pause', { forced: Boolean(options?.force), nextReadableIndex });
    scheduleAutoTourResume();
  }, [clearAutoTourAdvanceTimer, isProgrammaticViewportChange, scheduleAutoTourResume, trace]);

  const handleViewportMoveStart = useCallback((event?: unknown) => {
    if (!event && isProgrammaticViewportChange()) {
      trace('move-start-ignored-programmatic');
      return;
    }
    userViewportInteractingRef.current = true;
    lastUserViewportChangeAtRef.current = Date.now();
    trace('move-start', { hasEvent: Boolean(event) });
    pauseAutoTour({ force: true });
  }, [isProgrammaticViewportChange, pauseAutoTour, trace]);

  const handleViewportMoveEnd = useCallback((event?: unknown) => {
    if (!event && isProgrammaticViewportChange()) {
      trace('move-end-ignored-programmatic');
      return;
    }
    const wasUserInteracting = userViewportInteractingRef.current;
    userViewportInteractingRef.current = false;
    if (!wasUserInteracting) {
      trace('move-end-ignored-not-interacting', { hasEvent: Boolean(event) });
      return;
    }
    lastUserViewportChangeAtRef.current = Date.now();
    trace('move-end', { hasEvent: Boolean(event) });
    pauseAutoTour({ force: true });
    queueMicrotask(() => {
      trace('move-end-drain');
      maybeStartAutoTourRef.current();
    });
  }, [isProgrammaticViewportChange, pauseAutoTour, trace]);

  const restorePendingSeed = useCallback(
    (pending: AutoTourSeed, fromSeedQueue: boolean) => {
      if (fromSeedQueue) {
        pendingAutoTourSeedsRef.current.unshift(pending);
        return;
      }
      pendingAutoTourRef.current = pending;
    },
    [],
  );

  const schedulePendingSeedRetry = useCallback(() => {
    if (
      pendingSeedRetryTimerRef.current ||
      (!pendingAutoTourRef.current && pendingAutoTourSeedsRef.current.length === 0)
    ) {
      trace('pending-retry-skipped');
      return;
    }
    trace('schedule-pending-retry');
    pendingSeedRetryTimerRef.current = window.setTimeout(() => {
      pendingSeedRetryTimerRef.current = null;
      trace('run-pending-retry');
      maybeStartAutoTourRef.current();
    }, AUTO_TOUR_RESUME_DELAY_MS);
  }, [trace]);

  const isUserViewportCooldownActive = useCallback(() => {
    const ageMs = Date.now() - lastUserViewportChangeAtRef.current;
    if (userViewportInteractingRef.current) {
      if (ageMs < AUTO_TOUR_RESUME_DELAY_MS) {
        return true;
      }
      userViewportInteractingRef.current = false;
      trace('clear-stale-user-interaction', { ageMs });
      return false;
    }
    return ageMs < USER_VIEWPORT_COOLDOWN_MS;
  }, [trace]);

  const maybeStartAutoTour = useCallback(() => {
    trace('maybe-start-enter');
    // 取出待处理的 seed（优先直接 pending，其次从队列 shift）
    // 队列中的 seed 仅在 nodeIds 不再存在于当前图谱时才被丢弃，
    // 允许旧 revision 的 seed 在当前布局上正常播放。
    let pending = pendingAutoTourRef.current;
    let fromSeedQueue = false;
    if (!pending && pendingAutoTourSeedsRef.current.length > 0) {
      pending = pendingAutoTourSeedsRef.current.shift() ?? null;
      fromSeedQueue = Boolean(pending);
    }
    if (!pending) {
      trace('maybe-start-no-pending');
      return;
    }
    const currentNodeIds = new Set(graph.nodes.map((n) => n.id));
    if (
      pending.sessionId !== graph.sessionId ||
      !pending.nodeIds.every((id) => currentNodeIds.has(id))
    ) {
      trace('maybe-start-drop-stale-seed', {
        pendingSessionId: pending.sessionId,
        pendingRevision: pending.revision,
        missingNodeIds: pending.nodeIds.filter((id) => !currentNodeIds.has(id)),
      });
      return;
    }

    if (isUserViewportCooldownActive()) {
      trace('maybe-start-blocked-cooldown', {
        fromSeedQueue,
        cooldownRemainingMs: Math.max(
          0,
          USER_VIEWPORT_COOLDOWN_MS -
            (Date.now() - lastUserViewportChangeAtRef.current),
        ),
      });
      restorePendingSeed(pending, fromSeedQueue);
      schedulePendingSeedRetry();
      return;
    }

    clearPendingSeedRetryTimer();

    const inst = reactFlowInstanceRef.current;
    const el = flowContainerRef.current;
    if (!inst?.getViewport || !el) {
      trace('maybe-start-blocked-instance', {
        hasInstance: Boolean(inst),
        hasGetViewport: Boolean(inst?.getViewport),
        hasContainer: Boolean(el),
      });
      restorePendingSeed(pending, fromSeedQueue);
      schedulePendingSeedRetry();
      return;
    }

    const containerWidth = el.clientWidth ?? 0;
    const containerHeight = el.clientHeight ?? 0;
    if (containerWidth < 2 || containerHeight < 2) {
      trace('maybe-start-blocked-size', { containerWidth, containerHeight });
      restorePendingSeed(pending, fromSeedQueue);
      schedulePendingSeedRetry();
      return;
    }

    const autoTourKey = `${pending.sessionId}:${[...pending.nodeIds].sort().join(',')}:${currentView}`;
    if (
      lastAutoTourKeyRef.current === autoTourKey &&
      autoTourBatchesRef.current.length > 0
    ) {
      trace('maybe-start-skip-duplicate-key', { autoTourKey });
      return;
    }

    const artifactsForView = debugViewArtifactsRef.current[currentView];
    if (!artifactsForView) {
      trace('maybe-start-blocked-artifacts', { currentView });
      restorePendingSeed(pending, fromSeedQueue);
      schedulePendingSeedRetry();
      return;
    }

    const minReadableZoom = graphNodeBodyFontPx > 0
      ? autoFitMinReadableFontPx / graphNodeBodyFontPx
      : 1;

    const stages = buildTwoStageAutoTourStages({
      seed: pending,
      flowNodes: artifactsForView.reactFlow.nodes,
      flowEdges: flowEdgesRef.current,
      containerWidth,
      containerHeight,
      currentZoom: inst.getViewport().zoom || 1,
      minReadableZoom,
    });
    if (stages.length === 0) {
      trace('maybe-start-no-stages', {
        pendingRevision: pending.revision,
        nodeIds: pending.nodeIds,
        anchorNodeIds: pending.anchorNodeIds,
      });
      restorePendingSeed(pending, fromSeedQueue);
      schedulePendingSeedRetry();
      return;
    }

    const firstTarget = buildAutoTourTargetBounds(stages[0]);
    if (
      stages.length === 1 &&
      firstTarget &&
      isViewportCloseToTarget({
        current: firstTarget.currentViewport,
        target: firstTarget.targetViewport,
      })
    ) {
      trace('maybe-start-skip-close-to-target', {
        autoTourKey,
        currentViewport: firstTarget.currentViewport,
        targetViewport: firstTarget.targetViewport,
      });
      lastAutoTourKeyRef.current = autoTourKey;
      pendingAutoTourRef.current = null;
      return;
    }

    // 如果当前有活跃导览，将新阶段排入队列
    if (autoTourBatchesRef.current.length > 0) {
      trace('maybe-start-queue-stages', {
        autoTourKey,
        stageCount: stages.length,
      });
      autoTourQueueRef.current.push(stages);
      pendingAutoTourRef.current = null;
      return;
    }

    pendingAutoTourRef.current = null;
    autoTourBatchesRef.current = stages;
    autoTourCurrentIndexRef.current = -1;
    autoTourResumeIndexRef.current = 0;
    lastAutoTourKeyRef.current = autoTourKey;
    trace('maybe-start-play-now', {
      autoTourKey,
      stageCount: stages.length,
      firstStage: stages[0],
    });
    playAutoTourBatch(0);
  }, [
    autoFitMinReadableFontPx,
    buildAutoTourTargetBounds,
    clearPendingSeedRetryTimer,
    currentView,
    flowContainerRef,
    graph.nodes,
    graph.sessionId,
    graphNodeBodyFontPx,
    playAutoTourBatch,
    reactFlowInstanceRef,
    isUserViewportCooldownActive,
    restorePendingSeed,
    schedulePendingSeedRetry,
    trace,
  ]);

  maybeStartAutoTourRef.current = maybeStartAutoTour;

  /** 在 MERGED_GRAPH_UPDATED 消息中调用，设置 pending seed */
  const setAutoTourSeed = useCallback(
    (seed: AutoTourSeed | null) => {
      if (!seed) {
        trace('set-seed-clear');
        clearAutoTourAdvanceTimer();
        clearAutoTourResumeTimer();
        autoTourQueueRef.current = [];
        clearCompletedAutoTourUnit();
        pendingAutoTourRef.current = null;
        pendingAutoTourSeedsRef.current = [];
        lastAutoTourKeyRef.current = null;
        setAutoTourStatus('idle');
        setAutoTourProgress({ current: 0, total: 0 });
        return;
      }

      if (
        pendingAutoTourRef.current ||
        autoTourBatchesRef.current.length > 0 ||
        autoTourQueueRef.current.length > 0
      ) {
        trace('set-seed-queued', {
          seedRevision: seed.revision,
          nodeIds: seed.nodeIds,
          anchorNodeIds: seed.anchorNodeIds,
        });
        pendingAutoTourSeedsRef.current.push(seed);
        return;
      }

      trace('set-seed-pending', {
        seedRevision: seed.revision,
        nodeIds: seed.nodeIds,
        anchorNodeIds: seed.anchorNodeIds,
      });
      pendingAutoTourRef.current = seed;
      lastAutoTourKeyRef.current = null;
      setAutoTourStatus('idle');
      setAutoTourProgress({ current: 0, total: 0 });
      schedulePendingAutoTourDrain();
    },
    [
      clearAutoTourAdvanceTimer,
      clearAutoTourResumeTimer,
      clearCompletedAutoTourUnit,
      schedulePendingAutoTourDrain,
      trace,
    ],
  );

  return {
    autoTourStatus,
    autoTourProgress,
    activeAutoTourStage,
    lastUserViewportChangeAtRef,
    userViewportInteractingRef,
    pendingAutoTourRef,
    resetAutoTourState,
    pauseAutoTour,
    maybeStartAutoTour,
    setAutoTourSeed,
    withProgrammaticViewportChange,
    handleViewportMoveStart,
    handleViewportMoveEnd,
  };
}
