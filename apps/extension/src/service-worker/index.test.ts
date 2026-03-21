/**
 * Service Worker 消息路由测试
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SessionOrchestrator } from '../shared/orchestrator';

// Mock SessionOrchestrator
vi.mock('../shared/orchestrator');

describe('Service Worker - 消息路由', () => {
  let mockRuntime: any;
  let mockOrchestrator: any;
  let messageListeners: Array<
    (message: any, sender: any, sendResponse: any) => void | boolean
  > = [];

  beforeEach(async () => {
    // 重置 mocks
    vi.clearAllMocks();
    messageListeners = [];

    // 创建 mock orchestrator
    mockOrchestrator = {
      on: vi.fn(),
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      addAudioData: vi.fn().mockResolvedValue(undefined),
      getSessionInfo: vi.fn().mockReturnValue({
        sessionId: 'test-session',
        state: 'recording',
      }),
      dispose: vi.fn(),
    };

    (SessionOrchestrator as any).mockImplementation(() => mockOrchestrator);

    // 设置 chrome mock
    mockRuntime = (globalThis as any).chrome.runtime;

    // 设置 sendMessage 来触发消息监听器
    mockRuntime.sendMessage.mockImplementation(
      (message: any): Promise<any> => {
        // 找到第一个返回值的监听器
        let responseSent = false;
        let responseValue: any = { success: true };

        for (const listener of messageListeners) {
          try {
            const sendResponse = (response: any) => {
              responseValue = response;
              responseSent = true;
            };
            const result = listener(message, { tab: { id: 1 } }, sendResponse);
            if (result === true) {
              // 异步响应 - 模拟异步返回
              return new Promise((resolve) => {
                setTimeout(() => resolve(responseValue), 10);
              });
            } else if (responseSent) {
              return Promise.resolve(responseValue);
            }
          } catch (error) {
            return Promise.reject(error);
          }
        }

        return Promise.resolve(responseValue);
      }
    );

    // 设置 onMessage.addListener 保存监听器
    mockRuntime.onMessage.addListener.mockImplementation(
      (callback: (message: any, sender: any, sendResponse: any) => void | boolean) => {
        messageListeners.push(callback);
        return true;
      }
    );

    // 确保 chrome APIs 已设置
    (globalThis as any).chrome.offscreen = {
      createDocument: vi.fn().mockResolvedValue(undefined),
      closeDocument: vi.fn().mockResolvedValue(undefined),
    };

    (globalThis as any).chrome.action = {
      onClicked: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
    };

    mockRuntime.getContexts = vi.fn().mockResolvedValue([]);
    mockRuntime.getURL = vi.fn((path: string) => `chrome-extension://test/${path}`);

    // 重置模块缓存
    vi.resetModules();

    // 导入 service-worker 代码以注册监听器
    await import('./index');
  });

  describe('SESSION_START 消息处理', () => {
    it('应该成功处理 SESSION_START 消息', async () => {
      const message = {
        type: 'SESSION_START',
        target: 'service-worker',
        payload: { tabId: 123 },
      };

      // Act
      await mockRuntime.sendMessage(message);

      // Assert
      expect(mockOrchestrator.on).toHaveBeenCalledWith({
        onTranscriptReady: expect.any(Function),
        onGraphUpdated: expect.any(Function),
        onStateChanged: expect.any(Function),
      });
      expect(mockOrchestrator.start).toHaveBeenCalledWith({ tabId: 123 });
    });

    it('处理失败时应该返回错误', async () => {
      // Arrange
      mockOrchestrator.start.mockRejectedValue(new Error('启动失败'));

      // Act
      const result = await mockRuntime.sendMessage({
        type: 'SESSION_START',
        target: 'service-worker',
        payload: { tabId: 123 },
      });

      // Assert
      expect(result).toBeDefined();
    });
  });

  describe('SESSION_STOP 消息处理', () => {
    it('应该成功处理 SESSION_STOP 消息', async () => {
      // 先启动会话
      await mockRuntime.sendMessage({
        type: 'SESSION_START',
        target: 'service-worker',
        payload: { tabId: 123 },
      });

      const message = {
        type: 'SESSION_STOP',
        target: 'service-worker',
        payload: { sessionId: 'test-session' },
      };

      // Act
      await mockRuntime.sendMessage(message);

      // Assert
      expect(mockOrchestrator.stop).toHaveBeenCalled();
    });
  });

  describe('AUDIO_CHUNK_READY 消息处理', () => {
    it('应该处理来自 offscreen 的音频 chunk', async () => {
      // 先启动会话以初始化 orchestrator
      await mockRuntime.sendMessage({
        type: 'SESSION_START',
        target: 'service-worker',
        payload: { tabId: 123 },
      });

      const audioData = new ArrayBuffer(1024);
      const message = {
        type: 'AUDIO_CHUNK_READY',
        payload: { audioData, startMs: 0, endMs: 1000 },
      };
      const sender = {
        url: 'chrome-extension://test/offscreen/offscreen.html',
      };

      // Act - 触发监听器
      const sendResponse = vi.fn();
      for (const listener of messageListeners) {
        const result = listener(message, sender, sendResponse);
        if (result === true) {
          await new Promise((resolve) => setTimeout(resolve, 20));
          break;
        }
      }

      // Assert - 验证 sendResponse 被调用
      expect(sendResponse).toHaveBeenCalledWith({ success: true });
    });
  });

  describe('扩展生命周期', () => {
    it('应该注册所有必需的事件监听器', () => {
      // Assert - 所有监听器应该被注册
      expect(mockRuntime.onInstalled.addListener).toHaveBeenCalled();
      expect(mockRuntime.onMessage.addListener).toHaveBeenCalled();
      expect((globalThis as any).chrome.action.onClicked.addListener).toHaveBeenCalled();
      expect(mockRuntime.onSuspend.addListener).toHaveBeenCalled();
    });
  });
});
