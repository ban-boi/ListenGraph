/**
 * sw-types.ts
 *
 * Service Worker 模块间的共享类型定义。
 */

export type ServiceWorkerResponse = {
  success: boolean;
  error?: string;
  sessionId?: string;
  alreadyRunning?: boolean;
  providerError?: any;
  snapshot?: import('../shared/messages').RuntimeSnapshot;
  config?: import('@listen-graphic/schema').ProviderConfig;
  graphDisplaySettings?: import('../shared/messages').GraphDisplaySettings;
  debugData?: any;
  replayData?: any;
  exportData?: { filename: string; mimeType: string; content: string };
};
