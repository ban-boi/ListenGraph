/**
 * useChromeMessages.ts
 *
 * 从 App.tsx 提取的 Chrome 消息监听逻辑：
 * - 生产模式下监听来自 service worker 的消息
 * - 将所有 setState 替换为 dispatch
 */

import { useEffect } from 'react';
import type { MergedGraph } from '@listen-graphic/schema';
import type { AppMessage } from '../../shared/messages';
import { isDevMode } from '../constants';
import { getAddedNodeIds, getAutoRevealAnchorNodeIds } from '../auto-tour-utils';
import type { PanelAction } from '../panel-reducer';
import type { TimelineEvent, AutoTourStatus, AutoTourSeed } from '../types';

interface UseChromeMessagesOptions {
  dispatch: React.Dispatch<PanelAction>;
  providerAsrType: string;
  activeViewSessionRef: React.MutableRefObject<string | null>;
  graphRef: React.MutableRefObject<MergedGraph>;
  asrUtteranceIndexRef: React.MutableRefObject<number>;
  userPinnedViewRef: React.MutableRefObject<boolean>;
  finalizeTimelineTransient: (
    transientKey: string,
    updates: Partial<TimelineEvent>,
  ) => void;
  resetAutoTourState: (nextStatus?: AutoTourStatus) => void;
  setAutoTourSeed: (seed: AutoTourSeed | null) => void;
}

export function useChromeMessages({
  dispatch,
  providerAsrType,
  activeViewSessionRef,
  graphRef,
  asrUtteranceIndexRef,
  userPinnedViewRef,
  finalizeTimelineTransient,
  resetAutoTourState,
  setAutoTourSeed,
}: UseChromeMessagesOptions) {
  useEffect(() => {
    if (isDevMode) return;

    const handleMessage = (message: AppMessage) => {
      if (message.target && message.target !== 'sidepanel') return;
      switch (message.type) {
        case 'SESSION_STATE_CHANGED': {
          const p = message.payload;

          if (p.state === 'stopped') {
            if (p.mergedGraph) {
              const mergedGraph = p.mergedGraph;
              const shouldPreserveView =
                activeViewSessionRef.current === mergedGraph.sessionId;
              dispatch({
                type: 'SESSION_STATE_CHANGED',
                payload: {
                  ...p,
                  shouldPreserveView,
                },
              });
              userPinnedViewRef.current = p.currentViewPinned ?? false;
              activeViewSessionRef.current = mergedGraph.sessionId;
            } else {
              dispatch({
                type: 'SESSION_STATE_CHANGED',
                payload: {
                  ...p,
                  shouldPreserveView: false,
                },
              });
              userPinnedViewRef.current = false;
              activeViewSessionRef.current = null;
              resetAutoTourState();
            }
          } else {
            dispatch({
              type: 'SESSION_STATE_CHANGED',
              payload: {
                ...p,
                shouldPreserveView:
                  activeViewSessionRef.current === p.mergedGraph?.sessionId,
              },
            });

            if (p.state === 'idle') {
              userPinnedViewRef.current = false;
              activeViewSessionRef.current = null;
              resetAutoTourState();
            }
          }
          break;
        }
        case 'TRANSCRIPT_READY': {
          const utteranceKey = `asr-utterance-${asrUtteranceIndexRef.current}`;
          dispatch({
            type: 'TRANSCRIPT_READY',
            payload: {
              transcript: message.payload.transcript,
              utteranceKey,
            },
          });
          break;
        }
        case 'PROVIDER_PROGRESS': {
          const { stage, message: progressMessage } = message.payload;
          const asrSlice = message.payload.asrSliceType;
          if (asrSlice === 0) {
            asrUtteranceIndexRef.current++;
          }

          dispatch({
            type: 'PROVIDER_PROGRESS',
            payload: {
              stage,
              message: progressMessage,
              asrSliceType: asrSlice,
              asrUtteranceIndex: asrUtteranceIndexRef.current,
              isExternalAsr: providerAsrType === 'external',
            },
          });
          break;
        }
        case 'MERGED_GRAPH_UPDATED': {
          const nextGraph = message.payload.graph;
          const shouldPreserveView =
            activeViewSessionRef.current === nextGraph.sessionId;
          const previousGraph = graphRef.current;
          const addedNodeIds = getAddedNodeIds(previousGraph, nextGraph);
          const anchorNodeIds = getAutoRevealAnchorNodeIds({
            addedNodeIds,
            previousGraph,
            nextGraph,
          });

          dispatch({
            type: 'MERGED_GRAPH_UPDATED',
            payload: {
              graph: nextGraph,
              shouldPreserveView,
              previousGraph,
              addedNodeIds,
              anchorNodeIds,
            },
          });

          graphRef.current = nextGraph;
          activeViewSessionRef.current = nextGraph.sessionId;

          if (addedNodeIds.length > 0) {
            setAutoTourSeed({
              sessionId: nextGraph.sessionId,
              revision: nextGraph.revision,
              nodeIds: addedNodeIds,
              anchorNodeIds,
            });
          }
          break;
        }
        case 'PLAYBACK_TIME_UPDATED':
          dispatch({
            type: 'PLAYBACK_TIME_UPDATED',
            payload: { currentTimeMs: message.payload.currentTimeMs },
          });
          break;
        case 'ERROR':
          dispatch({
            type: 'ERROR',
            payload: {
              code: message.payload.code,
              message: message.payload.message,
            },
          });
          break;
      }
    };
    chrome.runtime.onMessage.addListener(handleMessage);
    return () => chrome.runtime.onMessage.removeListener(handleMessage);
  }, [
    dispatch,
    providerAsrType,
    activeViewSessionRef,
    graphRef,
    asrUtteranceIndexRef,
    userPinnedViewRef,
    finalizeTimelineTransient,
    resetAutoTourState,
    setAutoTourSeed,
  ]);
}
