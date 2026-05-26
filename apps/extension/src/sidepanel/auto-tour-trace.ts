export type AutoTourTraceEvent = {
  at: number;
  event: string;
  details?: Record<string, unknown>;
};

const MAX_AUTO_TOUR_TRACE_EVENTS = 200;
const GLOBAL_TRACE_KEY = '__LISTENGRAPH_AUTO_TOUR_TRACE__';

declare global {
  interface Window {
    __LISTENGRAPH_AUTO_TOUR_TRACE__?: AutoTourTraceEvent[];
    __LISTENGRAPH_AUTO_TOUR_TRACE_VERBOSE__?: boolean;
  }
}

function getTraceBuffer() {
  window[GLOBAL_TRACE_KEY] ??= [];
  return window[GLOBAL_TRACE_KEY];
}

export function recordAutoTourTrace(
  event: string,
  details?: Record<string, unknown>,
) {
  if (typeof window === 'undefined') {
    return;
  }

  const buffer = getTraceBuffer();
  buffer.push({
    at: Date.now(),
    event,
    details,
  });
  if (buffer.length > MAX_AUTO_TOUR_TRACE_EVENTS) {
    buffer.splice(0, buffer.length - MAX_AUTO_TOUR_TRACE_EVENTS);
  }

  if (window.__LISTENGRAPH_AUTO_TOUR_TRACE_VERBOSE__) {
    console.debug('[ListenGraph auto-tour]', event, details ?? {});
  }
}

export function getAutoTourTrace() {
  if (typeof window === 'undefined') {
    return [];
  }
  return [...getTraceBuffer()];
}
