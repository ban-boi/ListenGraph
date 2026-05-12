/**
 * useLogResize.ts
 *
 * 从 App.tsx 提取的日志面板拖拽调整高度逻辑。
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { clampLogPanelHeight } from '../timeline-utils';
import { DEFAULT_LOG_PANEL_HEIGHT } from '../constants';

export function useLogResize() {
  const [logPanelHeight, setLogPanelHeight] = useState(DEFAULT_LOG_PANEL_HEIGHT);
  const logResizeStartRef = useRef<{ pointerY: number; height: number } | null>(null);

  const stopLogResize = useCallback(() => {
    logResizeStartRef.current = null;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }, []);

  const handleLogResizeMove = useCallback((clientY: number) => {
    const resizeState = logResizeStartRef.current;
    if (!resizeState) {
      return;
    }

    const deltaY = resizeState.pointerY - clientY;
    setLogPanelHeight(clampLogPanelHeight(resizeState.height + deltaY));
  }, []);

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      handleLogResizeMove(event.clientY);
    };
    const handleMouseUp = () => {
      stopLogResize();
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      stopLogResize();
    };
  }, [handleLogResizeMove, stopLogResize]);

  const handleLogResizeStart = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      logResizeStartRef.current = {
        pointerY: event.clientY,
        height: logPanelHeight,
      };
      document.body.style.cursor = 'row-resize';
      document.body.style.userSelect = 'none';
      event.preventDefault();
    },
    [logPanelHeight],
  );

  return {
    logPanelHeight,
    handleLogResizeStart,
  };
}
