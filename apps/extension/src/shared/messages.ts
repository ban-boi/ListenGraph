export type AppMessage =
  | { type: 'SESSION_START'; payload: { tabId: number } }
  | { type: 'SESSION_STOP'; payload: { sessionId: string } }
  | { type: 'PLAYBACK_TIME_UPDATED'; payload: { currentTimeMs: number } }
  | { type: 'ERROR'; payload: { code: string; message: string } };
