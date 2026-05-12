// content-script-bridge.ts — 内容脚本通信桥接
// 从 index.ts 提取：sendMessageToContentScript、ensureContentScriptInjected、
// isMissingReceiverError、buildContentScriptStartPayload

import type { ProviderConfig } from '@listen-graphic/schema';
import type { AppMessage } from '../shared/messages';
import { createTencentRealtimeSessionConfig } from './tencent-realtime';
import type { RuntimeStateContainer } from './runtime-state';

const CONTENT_SCRIPT_FILE = 'content-script/content-script.js';

export async function sendMessageToContentScript<TResponse = any>(
  tabId: number,
  message: Extract<AppMessage, { target: 'content-script' }>,
): Promise<TResponse> {
  try {
    return await chrome.tabs.sendMessage(tabId, message) as TResponse;
  } catch (error) {
    if (!isMissingReceiverError(error)) {
      throw error;
    }

    await ensureContentScriptInjected(tabId);
    return await chrome.tabs.sendMessage(tabId, message) as TResponse;
  }
}

export async function ensureContentScriptInjected(tabId: number) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: [CONTENT_SCRIPT_FILE],
  });
}

export function isMissingReceiverError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }

  return (
    error.message.includes('Receiving end does not exist') ||
    error.message.includes('Could not establish connection')
  );
}

export async function buildContentScriptStartPayload(
  S: RuntimeStateContainer,
): Promise<Extract<AppMessage, { type: 'START_CAPTURE' }>['payload']> {
  if (S.activeProviderConfig.asr.transport !== 'ws') {
    return { transport: 'batch' };
  }

  if (S.activeProviderConfig.asr.type === 'external') {
    return {
      transport: 'ws',
      stream: {
        providerType: 'external',
        provider: 'local-asr-bridge',
        endpoint: S.activeProviderConfig.asr.endpoint,
        protocol: S.activeProviderConfig.asr.bridgeProtocol ?? 'lg-asr-ws-v1',
        authToken: S.activeProviderConfig.asr.bridgeAuthToken,
        sampleRate: 16_000,
        frameDurationMs: 40,
      },
    };
  }

  if (S.activeProviderConfig.asr.type !== 'tencent') {
    return { transport: 'batch' };
  }

  const sessionConfig = await createTencentRealtimeSessionConfig(S.activeProviderConfig.asr);
  return {
    transport: 'ws',
    stream: {
      providerType: 'tencent',
      provider: 'tencent-asr',
      endpoint: sessionConfig.signedUrl,
      sampleRate: 16_000,
      frameDurationMs: 40,
    },
    tencentRealtime: {
      signedUrl: sessionConfig.signedUrl,
      sampleRate: 16_000,
      frameDurationMs: 40,
    },
  };
}
