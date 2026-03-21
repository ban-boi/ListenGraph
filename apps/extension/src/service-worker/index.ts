/**
 * Service Worker - Chrome MV3 扩展的后台服务
 *
 * 职责：
 * 1. 管理扩展生命周期（安装、点击图标）
 * 2. 协调 Offscreen Document（音频捕获）
 * 3. 协调 SessionOrchestrator（会话编排）
 * 4. 路由消息：Sidepanel ↔ Offscreen ↔ Service Worker
 */

import { SessionOrchestrator } from '../shared/orchestrator';

// ============ 全局状态 ============

let orchestrator: SessionOrchestrator | null = null;
let offscreenDocumentCreated = false;
let currentSessionId: string | null = null;

// ============ 扩展生命周期 ============

chrome.runtime.onInstalled.addListener(() => {
  console.log('[Service Worker] Listen Graphic 已安装');
  orchestrator = new SessionOrchestrator();
});

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;
  await chrome.sidePanel.open({ tabId: tab.id });
});

// ============ 消息路由 ============

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[Service Worker] 收到消息:', message.type, {
    target: message.target,
    from: sender.tab?.id,
  });

  // 来自 offscreen 的音频数据（没有 target 字段，通过 sender.url 判断）
  if (message.type === 'AUDIO_CHUNK_READY' && sender.url?.includes('offscreen')) {
    handleAudioChunkReady(message.payload)
      .then(() => sendResponse({ success: true }))
      .catch((err) => {
        console.error('[Service Worker] 处理音频 chunk 失败:', err);
        sendResponse({ success: false, error: err.message });
      });
    return true; // 保持消息通道开启
  }

  // 发往 service worker 的会话控制消息
  if (message.target === 'service-worker') {
    switch (message.type) {
      case 'SESSION_START':
        handleSessionStart(message.payload)
          .then((sessionId) => sendResponse({ success: true, sessionId }))
          .catch((err) => sendResponse({ success: false, error: err.message }));
        return true;

      case 'SESSION_STOP':
        handleSessionStop(message.payload)
          .then(() => sendResponse({ success: true }))
          .catch((err) => sendResponse({ success: false, error: err.message }));
        return true;

      default:
        console.log('[Service Worker] 未知消息类型:', message.type);
        sendResponse({ success: false, error: '未知消息类型' });
    }
    return true;
  }

  return false;
});

// ============ 消息处理函数 ============

/**
 * 处理音频块就绪消息
 * 将音频数据传递给 SessionOrchestrator 进行处理
 */
async function handleAudioChunkReady(payload: {
  audioData: ArrayBuffer;
  startMs: number;
  endMs: number;
}): Promise<void> {
  if (!orchestrator) {
    console.warn('[Service Worker] Orchestrator 未初始化，忽略音频数据');
    return;
  }

  console.log('[Service Worker] 处理音频 chunk:', {
    startMs: payload.startMs,
    endMs: payload.endMs,
    dataSize: payload.audioData.byteLength,
  });

  // 将 ArrayBuffer 转换为 Blob
  const audioBlob = new Blob([payload.audioData], { type: 'audio/webm' });

  // 添加到会话编排器
  await orchestrator.addAudioData(audioBlob, payload.startMs);

  // 通知 sidepanel 音频 chunk 已就绪
  await broadcastToSidepanel({
    type: 'AUDIO_CHUNK_READY',
    target: 'sidepanel',
    payload: { startMs: payload.startMs, endMs: payload.endMs },
  });

  console.log('[Service Worker] 音频 chunk 已添加到 orchestrator');
}

/**
 * 处理会话启动消息
 */
async function handleSessionStart(payload: { tabId: number }): Promise<string> {
  console.log('[Service Worker] 启动会话，标签页 ID:', payload.tabId);

  // 确保 orchestrator 已初始化
  if (!orchestrator) {
    orchestrator = new SessionOrchestrator();
  }

  // 注册回调
  orchestrator.on({
    onTranscriptReady: async (transcript) => {
      await broadcastToSidepanel({
        type: 'TRANSCRIPT_READY',
        target: 'sidepanel',
        payload: { transcript },
      });
    },
    onGraphUpdated: async (graph) => {
      await broadcastToSidepanel({
        type: 'MERGED_GRAPH_UPDATED',
        target: 'sidepanel',
        payload: { graph },
      });
    },
    onStateChanged: async (state) => {
      const sessionInfo = orchestrator?.getSessionInfo();
      if (sessionInfo) {
        await broadcastToSidepanel({
          type: 'SESSION_STATE_CHANGED',
          target: 'sidepanel',
          payload: {
            sessionId: sessionInfo.sessionId,
            state: sessionInfo.state,
          },
        });
      }
    },
  });

  // 确保 offscreen document 已创建
  await ensureOffscreenDocumentCreated();

  // 启动会话编排器
  await orchestrator.start({ tabId: payload.tabId });

  // 获取会话 ID
  const sessionInfo = orchestrator.getSessionInfo();
  if (!sessionInfo) {
    throw new Error('无法获取会话信息');
  }

  currentSessionId = sessionInfo.sessionId;

  // 通知 offscreen document 开始捕获音频
  const captureResponse = await chrome.runtime.sendMessage({
    type: 'START_CAPTURE',
    target: 'offscreen',
  });

  if (!captureResponse?.success) {
    // 如果捕获失败，停止会话
    await orchestrator.stop();
    throw new Error(captureResponse?.error || '启动音频捕获失败');
  }

  console.log('[Service Worker] 会话已启动:', sessionInfo.sessionId);
  return sessionInfo.sessionId;
}

/**
 * 处理会话停止消息
 */
async function handleSessionStop(payload: { sessionId: string }): Promise<void> {
  console.log('[Service Worker] 停止会话:', payload.sessionId);

  // 通知 offscreen document 停止捕获音频
  try {
    await chrome.runtime.sendMessage({
      type: 'STOP_CAPTURE',
      target: 'offscreen',
    });
  } catch (error) {
    console.warn('[Service Worker] 通知 offscreen 停止捕获失败:', error);
  }

  // 停止会话编排器
  if (orchestrator) {
    await orchestrator.stop();
  }

  currentSessionId = null;

  // 通知 sidepanel 状态变更
  await broadcastToSidepanel({
    type: 'SESSION_STATE_CHANGED',
    target: 'sidepanel',
    payload: { sessionId: payload.sessionId, state: 'idle' },
  });

  console.log('[Service Worker] 会话已停止');
}

// ============ 辅助函数 ============

/**
 * 广播消息到 sidepanel
 */
async function broadcastToSidepanel(message: {
  type: string;
  target: string;
  payload?: unknown;
}): Promise<void> {
  try {
    // 尝试发送到所有可能的监听器
    await chrome.runtime.sendMessage(message);
  } catch (error) {
    // sidepanel 可能未打开，忽略错误
    console.debug('[Service Worker] 广播到 sidepanel 失败（可能未打开）:', error);
  }
}

/**
 * 确保 offscreen document 已创建
 */
async function ensureOffscreenDocumentCreated(): Promise<void> {
  if (offscreenDocumentCreated) {
    return;
  }

  try {
    // 检查是否已存在 offscreen document
    const existingContexts = await (chrome.runtime.getContexts as any)({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
    });

    if (existingContexts && existingContexts.length > 0) {
      offscreenDocumentCreated = true;
      return;
    }

    // 创建 offscreen document
    await (chrome.offscreen.createDocument as any)({
      url: chrome.runtime.getURL('offscreen/offscreen.html'),
      reasons: ['USER_MEDIA'],
      justification: '使用 AudioWorklet 处理音频捕获（MV3 限制）',
    });

    offscreenDocumentCreated = true;
    console.log('[Service Worker] Offscreen document 已创建');
  } catch (error) {
    // 如果已存在，忽略错误
    if (
      error instanceof Error &&
      (error.message.includes('offscreen') ||
        error.message.includes('already exists'))
    ) {
      offscreenDocumentCreated = true;
      return;
    }
    console.error('[Service Worker] 创建 offscreen document 失败:', error);
    throw error;
  }
}

// ============ 清理资源 ============

chrome.runtime.onSuspend.addListener(() => {
  console.log('[Service Worker] 即将休眠，清理资源');
  orchestrator?.dispose();
  orchestrator = null;
});
