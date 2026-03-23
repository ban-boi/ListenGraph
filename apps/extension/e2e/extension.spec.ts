import {
  test,
  expect,
  chromium,
  type BrowserContext,
  type Worker as PlaywrightWorker,
} from '@playwright/test';
import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';
import { fileURLToPath } from 'url';

// 获取当前文件的目录
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 扩展的 dist 目录
const EXTENSION_PATH = path.resolve(__dirname, '../dist');

async function launchExtensionContext(userDataDir: string): Promise<{
  context: BrowserContext;
  extensionId: string;
  serviceWorker: PlaywrightWorker;
}> {
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    headless: true,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
    ],
  });

  let [serviceWorker] = context.serviceWorkers();
  if (!serviceWorker) {
    serviceWorker = await context.waitForEvent('serviceworker');
  }

  const extensionId = serviceWorker.url().split('/')[2];
  return { context, extensionId, serviceWorker };
}

async function seedExtensionSessionAssets(
  serviceWorker: PlaywrightWorker,
  seed: {
    runtimeState?: Record<string, unknown>;
    session: Record<string, unknown>;
    transcripts: Array<Record<string, unknown>>;
    graph: Record<string, unknown>;
  },
) {
  let lastError: unknown;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await serviceWorker.evaluate(async (payload) => {
        if (payload.runtimeState) {
          await chrome.storage.session.set({
            'listen-graphic-runtime-state': payload.runtimeState,
          });
        } else {
          await chrome.storage.session.remove('listen-graphic-runtime-state');
        }

        await new Promise<void>((resolve, reject) => {
          const request = indexedDB.open('listen-graphic-db', 10);

          request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains('sessions')) {
              db.createObjectStore('sessions', { keyPath: 'sessionId' });
            }
            if (!db.objectStoreNames.contains('transcriptChunks')) {
              db.createObjectStore('transcriptChunks', { keyPath: 'chunkId' });
            }
            if (!db.objectStoreNames.contains('segmentGraphs')) {
              db.createObjectStore('segmentGraphs', { keyPath: 'segmentId' });
            }
            if (!db.objectStoreNames.contains('mergedGraphs')) {
              db.createObjectStore('mergedGraphs', { keyPath: 'sessionId' });
            }
          };

          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            const db = request.result;
            const transaction = db.transaction(
              ['sessions', 'transcriptChunks', 'segmentGraphs', 'mergedGraphs'],
              'readwrite',
            );

            transaction.objectStore('sessions').put(payload.session);
            for (const transcript of payload.transcripts) {
              transaction.objectStore('transcriptChunks').put(transcript);
            }
            transaction.objectStore('mergedGraphs').put(payload.graph);

            transaction.onerror = () =>
              reject(transaction.error ?? new Error('写入 extension 测试资产失败'));
            transaction.oncomplete = () => {
              db.close();
              resolve();
            };
          };
        });
      }, seed);
      return;
    } catch (error) {
      lastError = error;
      const message = String(error);
      if (
        !message.includes('opening backing store') ||
        attempt === 2
      ) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }

  throw lastError;
}

async function saveProviderSettings(
  serviceWorker: PlaywrightWorker,
  config: Record<string, unknown>,
) {
  let lastError: unknown;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await serviceWorker.evaluate(async (providerConfig) => {
        await new Promise<void>((resolve, reject) => {
          const request = indexedDB.open('listen-graphic-db', 10);

          request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains('settings')) {
              db.createObjectStore('settings', { keyPath: 'key' });
            }
          };

          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            const db = request.result;
            const transaction = db.transaction(['settings'], 'readwrite');
            transaction.objectStore('settings').put({
              key: 'provider-config',
              value: providerConfig,
              updatedAt: Date.now(),
            });
            transaction.onerror = () =>
              reject(transaction.error ?? new Error('写入 provider settings 失败'));
            transaction.oncomplete = () => {
              db.close();
              resolve();
            };
          };
        });
      }, config);
      return;
    } catch (error) {
      lastError = error;
      const message = String(error);
      if (
        !message.includes('opening backing store') ||
        attempt === 2
      ) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }

  throw lastError;
}

async function installProviderHarness(serviceWorker: PlaywrightWorker) {
  await serviceWorker.evaluate(async () => {
    const originalSendMessage = chrome.tabs.sendMessage.bind(chrome.tabs);
    Object.defineProperty(globalThis, '__listen_graph_original_send_message__', {
      value: originalSendMessage,
      configurable: true,
    });

    Object.defineProperty(chrome.tabs, 'sendMessage', {
      configurable: true,
      value: async (_tabId: number, message: { type?: string }) => {
        if (message?.type === 'START_CAPTURE' || message?.type === 'STOP_CAPTURE') {
          return { success: true };
        }
        if (message?.type === 'SEEK_TO_TIMESTAMP') {
          return { success: true };
        }
        return { success: false, error: `unexpected message: ${message?.type}` };
      },
    });

    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/audio/transcriptions')) {
          return new Response(
            JSON.stringify({
              text: '真实转写结果',
            }),
            {
              status: 200,
              headers: {
                'Content-Type': 'application/json',
              },
            },
          );
        }

        if (url.includes('/chat/completions')) {
          return new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      topic: '真实 E2E 主题',
                      nodes: [
                        {
                          id: 'node_real_e2e',
                          type: 'claim',
                          text: '真实结构化节点',
                        },
                      ],
                      edges: [],
                    }),
                  },
                },
              ],
            }),
            {
              status: 200,
              headers: {
                'Content-Type': 'application/json',
              },
            },
          );
        }

        throw new Error(`unexpected fetch url: ${url}`);
      },
    });
  });
}

async function readPersistedCounts(serviceWorker: PlaywrightWorker) {
  let lastError: unknown;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await serviceWorker.evaluate(async () => {
        return new Promise<{ transcriptCount: number; graphCount: number }>(
          (resolve, reject) => {
            const request = indexedDB.open('listen-graphic-db', 10);

            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
              const db = request.result;
              const transaction = db.transaction(
                ['transcriptChunks', 'mergedGraphs'],
                'readonly',
              );
              const transcriptRequest = transaction.objectStore('transcriptChunks').getAll();
              const graphRequest = transaction.objectStore('mergedGraphs').getAll();

              transaction.onerror = () =>
                reject(transaction.error ?? new Error('读取 persisted counts 失败'));
              transaction.oncomplete = () => {
                resolve({
                  transcriptCount: transcriptRequest.result.length,
                  graphCount: graphRequest.result.length,
                });
                db.close();
              };
            };
          },
        );
      });
    } catch (error) {
      lastError = error;
      if (
        !(error instanceof Error) ||
        !error.message.includes('opening backing store') ||
        attempt === 2
      ) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }

  throw lastError;
}

async function createStaticServer(root: string) {
  const server = http.createServer((req, res) => {
    const requestPath = req.url === '/' ? '/sidepanel.html' : req.url ?? '/sidepanel.html';
    const filePath = path.join(root, requestPath.replace(/^\//, ''));

    if (!fs.existsSync(filePath)) {
      res.statusCode = 404;
      res.end('Not Found');
      return;
    }

    const content = fs.readFileSync(filePath);
    if (filePath.endsWith('.html')) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
    } else if (filePath.endsWith('.js')) {
      res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    } else if (filePath.endsWith('.css')) {
      res.setHeader('Content-Type', 'text/css; charset=utf-8');
    }
    res.end(content);
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('无法启动静态文件服务器');
  }

  return {
    server,
    url: `http://127.0.0.1:${address.port}`,
  };
}

test.describe('Build Verification Tests', () => {
  test('dist 目录应该包含所有必需文件', () => {
    const requiredFiles = [
      'manifest.json',
      'service-worker.js',
      'sidepanel.html',
      'sidepanel/sidepanel.js',
      'content-script/content-script.js',
      'offscreen/audio-processor.worklet.js',
    ];

    for (const file of requiredFiles) {
      const filePath = path.join(EXTENSION_PATH, file);
      expect(fs.existsSync(filePath), `${file} 应该存在于 dist/`).toBeTruthy();
    }
  });

  test('manifest.json 应该配置正确', () => {
    const manifestPath = path.join(EXTENSION_PATH, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));

    expect(manifest.manifest_version).toBe(3);
    expect(manifest.permissions).toContain('tabCapture');
    expect(manifest.permissions).toContain('offscreen');
    expect(manifest.permissions).toContain('sidePanel');
    expect(manifest.side_panel).toBeDefined();
    expect(manifest.side_panel.default_path).toBe('sidepanel.html');
    expect(manifest.background.type).toBe('module');
  });

  test('service-worker.js 应该使用正确的架构', () => {
    const swPath = path.join(EXTENSION_PATH, 'service-worker.js');
    const content = fs.readFileSync(swPath, 'utf-8');

    expect(content).toContain('NODE_CLICKED');
    expect(content).toContain('MERGED_GRAPH_UPDATED');
    expect(content).not.toContain('executeScript');
  });

  test('offscreen 目录应该存在', () => {
    // 检查 offscreen 可能在不同位置
    const offscreenPaths = [
      path.join(EXTENSION_PATH, 'offscreen'),
      path.join(EXTENSION_PATH, 'src/offscreen'),
    ];

    const offscreenExists = offscreenPaths.some((p) => fs.existsSync(p));
    expect(offscreenExists, 'offscreen 目录应该存在').toBeTruthy();
  });

  test('构建产物 sidepanel 可以展示 Debug 面板', async ({ page }) => {
    const { server, url } = await createStaticServer(EXTENSION_PATH);

    await page.addInitScript(() => {
      const listeners: Array<(message: unknown) => void> = [];
      (window as typeof window & { chrome: unknown }).chrome = {
        runtime: {
          sendMessage: async (message: { type?: string }) => {
            if (message?.type === 'GET_RUNTIME_SNAPSHOT') {
              return {
                success: true,
                snapshot: {
                  sessionId: 'session_debug_e2e',
                  state: 'stopped',
                  currentTimeMs: 30000,
                  currentView: 'timeline',
                  currentViewPinned: false,
                  graph: {
                    sessionId: 'session_debug_e2e',
                    revision: 1,
                    topics: [],
                    nodes: [
                      {
                        id: 'n1',
                        type: 'claim',
                        text: '调试节点',
                        timestampMs: 0,
                        status: 'confirmed',
                      },
                    ],
                    edges: [],
                    viewHints: {
                      defaultView: 'timeline',
                      scores: {
                        timeline: 3,
                        causal: 1,
                        comparison: 0,
                        flow: 0,
                        hierarchy: 0,
                      },
                    },
                    updatedAt: Date.now(),
                  },
                },
              };
            }
            if (message?.type === 'GET_DEBUG_SESSION') {
              return {
                success: true,
                debugData: {
                  session: {
                    sessionId: 'session_debug_e2e',
                    sourceType: 'tab',
                    createdAt: 100,
                    endedAt: 200,
                  },
                  transcripts: [
                    {
                      chunkId: 'chunk_1',
                      sessionId: 'session_debug_e2e',
                      text: 'E2E 调试转写',
                      startMs: 0,
                      endMs: 30000,
                      provider: 'mock-asr',
                    },
                  ],
                  graph: {
                    sessionId: 'session_debug_e2e',
                    revision: 1,
                    topics: [],
                    nodes: [
                      {
                        id: 'n1',
                        type: 'claim',
                        text: '调试节点',
                        timestampMs: 0,
                        status: 'confirmed',
                      },
                    ],
                    edges: [],
                    viewHints: {
                      defaultView: 'timeline',
                      scores: {
                        timeline: 3,
                        causal: 1,
                        comparison: 0,
                        flow: 0,
                        hierarchy: 0,
                      },
                    },
                    updatedAt: 200,
                  },
                },
              };
            }
            return { success: true };
          },
          onMessage: {
            addListener: (listener: (message: unknown) => void) => {
              listeners.push(listener);
            },
            removeListener: (listener: (message: unknown) => void) => {
              const index = listeners.indexOf(listener);
              if (index >= 0) listeners.splice(index, 1);
            },
          },
        },
        tabs: {
          query: (_query: unknown, callback: (tabs: Array<{ id: number }>) => void) =>
            callback([{ id: 1 }]),
        },
      };
    });

    try {
      await page.goto(`${url}/sidepanel.html`);
      await page.locator('button').filter({ hasText: /^调试$/ }).click();
      await expect(page.getByTestId('debug-panel')).toBeVisible();
      await expect(page.getByText('E2E 调试转写')).toBeVisible();
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  test('构建产物 sidepanel 可以展示 Replay 面板并推进时间', async ({ page }) => {
    const { server, url } = await createStaticServer(EXTENSION_PATH);

    await page.addInitScript(() => {
      const listeners: Array<(message: unknown) => void> = [];
      (window as typeof window & { chrome: unknown }).chrome = {
        runtime: {
          sendMessage: async (message: { type?: string }) => {
            if (message?.type === 'GET_RUNTIME_SNAPSHOT') {
              return {
                success: true,
                snapshot: {
                  sessionId: 'session_replay_e2e',
                  state: 'stopped',
                  currentTimeMs: 0,
                  currentView: 'timeline',
                  currentViewPinned: false,
                  graph: {
                    sessionId: 'session_replay_e2e',
                    revision: 1,
                    topics: [],
                    nodes: [
                      {
                        id: 'n1',
                        type: 'claim',
                        text: '回放节点',
                        timestampMs: 0,
                        status: 'confirmed',
                      },
                    ],
                    edges: [],
                    viewHints: {
                      defaultView: 'timeline',
                      scores: {
                        timeline: 3,
                        causal: 1,
                        comparison: 0,
                        flow: 0,
                        hierarchy: 0,
                      },
                    },
                    updatedAt: Date.now(),
                  },
                },
              };
            }
            if (message?.type === 'GET_REPLAY_SESSION') {
              return {
                success: true,
                replayData: {
                  session: {
                    sessionId: 'session_replay_e2e',
                    sourceType: 'tab',
                    createdAt: 100,
                    endedAt: 200,
                  },
                  transcripts: [
                    {
                      chunkId: 'chunk_1',
                      sessionId: 'session_replay_e2e',
                      text: 'E2E 回放转写',
                      startMs: 0,
                      endMs: 3000,
                      provider: 'mock-asr',
                    },
                  ],
                  graph: {
                    sessionId: 'session_replay_e2e',
                    revision: 1,
                    topics: [],
                    nodes: [
                      {
                        id: 'n1',
                        type: 'claim',
                        text: '回放节点',
                        timestampMs: 0,
                        status: 'confirmed',
                      },
                    ],
                    edges: [],
                    viewHints: {
                      defaultView: 'timeline',
                      scores: {
                        timeline: 3,
                        causal: 1,
                        comparison: 0,
                        flow: 0,
                        hierarchy: 0,
                      },
                    },
                    updatedAt: 200,
                  },
                  durationMs: 3000,
                },
              };
            }
            return { success: true };
          },
          onMessage: {
            addListener: (listener: (message: unknown) => void) => {
              listeners.push(listener);
            },
            removeListener: (listener: (message: unknown) => void) => {
              const index = listeners.indexOf(listener);
              if (index >= 0) listeners.splice(index, 1);
            },
          },
        },
        tabs: {
          query: (_query: unknown, callback: (tabs: Array<{ id: number }>) => void) =>
            callback([{ id: 1 }]),
        },
      };
    });

    try {
      await page.goto(`${url}/sidepanel.html`);
      await page.locator('button').filter({ hasText: /^回放$/ }).click();
      await expect(page.getByTestId('replay-panel')).toBeVisible();
      await page.locator('button').filter({ hasText: /^播放$/ }).click();
      await expect(page.locator('button').filter({ hasText: /^暂停$/ })).toBeVisible();
      await expect(page.getByText('回放当前时间: 0:01')).toBeVisible({ timeout: 3000 });
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  test('构建产物 sidepanel 可以通过 provider 风格消息链路生成图谱', async ({ page }) => {
    const { server, url } = await createStaticServer(EXTENSION_PATH);

    await page.addInitScript(() => {
      const listeners: Array<(message: unknown) => void> = [];
      const storageKey = 'listen-graphic-provider-e2e-state';
      const defaultProviderConfig = {
        asr: {
          type: 'mock',
          mode: 'direct',
          model: 'mock-asr',
          language: 'zh',
        },
        structurer: {
          type: 'mock',
          mode: 'direct',
          model: 'mock-structurer',
          language: 'zh',
        },
      };
      const defaultTranscript = {
        chunkId: 'chunk_provider_e2e',
        sessionId: 'session_provider_e2e',
        text: '真实转写结果',
        startMs: 0,
        endMs: 30000,
        provider: 'openai-asr',
      };
      const defaultGraph = {
        sessionId: 'session_provider_e2e',
        revision: 1,
        topics: [],
        nodes: [
          {
            id: 'node_real_e2e',
            type: 'claim',
            text: '真实结构化节点',
            timestampMs: 0,
            status: 'confirmed',
          },
        ],
        edges: [],
        viewHints: {
          defaultView: 'causal',
          scores: {
            causal: 3,
            timeline: 0,
            comparison: 0,
            flow: 0,
            hierarchy: 0,
          },
        },
        updatedAt: 200,
      };
      const defaultRuntimeSnapshot = {
        sessionId: null,
        state: 'idle',
        graph: null,
        currentTimeMs: 0,
        currentView: undefined,
        currentViewPinned: false,
        providerSummary: {
          asr: {
            type: 'mock',
            mode: 'direct',
            model: 'mock-asr',
            language: 'zh',
            apiKeyConfigured: false,
            sessionTokenConfigured: false,
          },
          structurer: {
            type: 'mock',
            mode: 'direct',
            model: 'mock-structurer',
            language: 'zh',
            apiKeyConfigured: false,
            sessionTokenConfigured: false,
          },
        },
        lastProviderError: null,
      };

      const loadState = () => {
        const saved = localStorage.getItem(storageKey);
        if (!saved) {
          return {
            providerConfig: defaultProviderConfig,
            transcript: defaultTranscript,
            graph: defaultGraph,
            runtimeSnapshot: defaultRuntimeSnapshot,
          };
        }

        return JSON.parse(saved);
      };

      const persistState = () => {
        localStorage.setItem(
          storageKey,
          JSON.stringify({
            providerConfig,
            transcript,
            graph,
            runtimeSnapshot,
          }),
        );
      };

      let {
        providerConfig,
        transcript,
        graph,
        runtimeSnapshot,
      } = loadState();

      const broadcast = (message: unknown) => {
        for (const listener of listeners) {
          listener(message);
        }
      };

      const summarizeProviders = (config: typeof providerConfig) => ({
        asr: {
          type: config.asr.type,
          mode: config.asr.mode,
          endpoint: config.asr.endpoint,
          model: config.asr.model,
          language: config.asr.language,
          apiKeyConfigured: Boolean(config.asr.apiKey),
          sessionTokenConfigured: Boolean(config.asr.sessionToken),
        },
        structurer: {
          type: config.structurer.type,
          mode: config.structurer.mode,
          endpoint: config.structurer.endpoint,
          model: config.structurer.model,
          language: config.structurer.language,
          apiKeyConfigured: Boolean(config.structurer.apiKey),
          sessionTokenConfigured: Boolean(config.structurer.sessionToken),
        },
      });

      (window as typeof window & { chrome: unknown }).chrome = {
        runtime: {
          sendMessage: async (message: { type?: string; payload?: any }) => {
            switch (message?.type) {
              case 'GET_RUNTIME_SNAPSHOT':
                return { success: true, snapshot: runtimeSnapshot };
              case 'GET_PROVIDER_SETTINGS':
                return { success: true, config: providerConfig };
              case 'SAVE_PROVIDER_SETTINGS':
                providerConfig = message.payload.config;
                runtimeSnapshot = {
                  ...runtimeSnapshot,
                  providerSummary: summarizeProviders(providerConfig),
                };
                persistState();
                return { success: true };
              case 'AUDIO_CHUNK_READY':
                runtimeSnapshot = {
                  ...runtimeSnapshot,
                  sessionId: 'session_provider_e2e',
                  state: 'capturing',
                  graph,
                  currentTimeMs: 30000,
                };
                broadcast({
                  type: 'SESSION_STATE_CHANGED',
                  target: 'sidepanel',
                  payload: {
                    sessionId: 'session_provider_e2e',
                    state: 'capturing',
                  },
                });
                broadcast({
                  type: 'TRANSCRIPT_READY',
                  target: 'sidepanel',
                  payload: {
                    transcript,
                  },
                });
                broadcast({
                  type: 'MERGED_GRAPH_UPDATED',
                  target: 'sidepanel',
                  payload: {
                    graph,
                  },
                });
                persistState();
                return { success: true };
              case 'GET_DEBUG_SESSION':
                return {
                  success: true,
                  debugData: {
                    session: {
                      sessionId: 'session_provider_e2e',
                      sourceType: 'tab',
                      createdAt: 100,
                    },
                    transcripts: [transcript],
                    graph,
                    providerSummary: runtimeSnapshot.providerSummary,
                    lastProviderError: null,
                  },
                };
              default:
                return { success: true };
            }
          },
          onMessage: {
            addListener: (listener: (message: unknown) => void) => {
              listeners.push(listener);
            },
            removeListener: (listener: (message: unknown) => void) => {
              const index = listeners.indexOf(listener);
              if (index >= 0) listeners.splice(index, 1);
            },
          },
        },
        tabs: {
          query: (_query: unknown, callback: (tabs: Array<{ id: number }>) => void) =>
            callback([{ id: 1 }]),
        },
      };
    });

    try {
      await page.goto(`${url}/sidepanel.html`);
      await page.locator('button').filter({ hasText: /^设置$/ }).click();
      await page.locator('select[aria-label="ASR Provider Type"]').selectOption('openai');
      await page.locator('input[aria-label="ASR Endpoint"]').fill('https://api.openai.com/v1');
      await page.locator('input[aria-label="ASR Model"]').fill('gpt-4o-mini-transcribe');
      await page.locator('input[aria-label="ASR API Key"]').fill('test-asr-secret');
      await page
        .locator('select[aria-label="Structurer Provider Type"]')
        .selectOption('openai');
      await page
        .locator('input[aria-label="Structurer Endpoint"]')
        .fill('https://api.openai.com/v1');
      await page.locator('input[aria-label="Structurer Model"]').fill('gpt-4.1-mini');
      await page
        .locator('input[aria-label="Structurer API Key"]')
        .fill('test-structurer-secret');
      await page.locator('button').filter({ hasText: /^保存设置$/ }).click();

      const chunkResponse = await page.evaluate(async () => {
        return chrome.runtime.sendMessage({
          type: 'AUDIO_CHUNK_READY',
          target: 'service-worker',
          payload: {
            audioData: [1, 2, 3, 4],
            startMs: 0,
            endMs: 30000,
          },
        });
      });

      expect(chunkResponse.success).toBe(true);
      await expect(page.getByText('真实结构化节点')).toBeVisible({ timeout: 5000 });
      await page.reload();
      await expect(page.getByText('真实结构化节点')).toBeVisible();
      await page.locator('button').filter({ hasText: /^调试$/ }).click();
      await expect(page.getByTestId('debug-panel')).toBeVisible();
      await expect(page.getByText(/openai/)).toBeVisible();
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  test('真实扩展 sidepanel 可以读取 runtime/storage 资产，并在重启后从 IndexedDB 回退恢复', async ({}, testInfo) => {
    const userDataDir = testInfo.outputPath('extension-user-data');
    fs.mkdirSync(userDataDir, { recursive: true });
    let seededContext: Awaited<ReturnType<typeof launchExtensionContext>> | null = null;
    let fallbackContext: Awaited<ReturnType<typeof launchExtensionContext>> | null = null;

    const graph = {
      sessionId: 'session_real_extension',
      revision: 1,
      topics: [],
      nodes: [
        {
          id: 'n1',
          type: 'claim',
          text: '真实扩展节点',
          timestampMs: 0,
          status: 'confirmed',
        },
      ],
      edges: [],
      viewHints: {
        defaultView: 'timeline',
        scores: {
          timeline: 3,
          causal: 1,
          comparison: 0,
          flow: 0,
          hierarchy: 0,
        },
      },
      updatedAt: 200,
    };

    try {
      seededContext = await launchExtensionContext(userDataDir);
      await seedExtensionSessionAssets(seededContext.serviceWorker, {
        runtimeState: {
          currentSession: {
            sessionId: 'session_real_extension',
            tabId: 1,
            state: 'stopped',
          },
          transcriptWindow: [
            {
              chunkId: 'chunk_2',
              sessionId: 'session_real_extension',
              text: '真实扩展第二段转写',
              startMs: 30000,
              endMs: 60000,
              provider: 'mock-asr',
            },
          ],
          mergedGraph: graph,
          chunkIndex: 2,
          currentTimeMs: 60000,
          currentView: 'timeline',
          currentViewPinned: false,
          pendingSessionFinalize: null,
        },
        session: {
          sessionId: 'session_real_extension',
          sourceType: 'tab',
          createdAt: 100,
          endedAt: 200,
        },
        transcripts: [
          {
            chunkId: 'chunk_1',
            sessionId: 'session_real_extension',
            text: '真实扩展第一段转写',
            startMs: 0,
            endMs: 30000,
            provider: 'mock-asr',
          },
          {
            chunkId: 'chunk_2',
            sessionId: 'session_real_extension',
            text: '真实扩展第二段转写',
            startMs: 30000,
            endMs: 60000,
            provider: 'mock-asr',
          },
        ],
        graph,
      });

      const page = await seededContext.context.newPage();
      await page.goto(`chrome-extension://${seededContext.extensionId}/sidepanel.html`);
      await expect(page.getByText('会话: session_real_extension')).toBeVisible();

      await page.locator('button').filter({ hasText: /^调试$/ }).click();
      await expect(page.getByTestId('debug-panel')).toBeVisible();
      await expect(page.getByText('真实扩展第一段转写')).toBeVisible();

      await page.locator('button').filter({ hasText: /^回放$/ }).click();
      await expect(page.getByTestId('replay-panel')).toBeVisible();
      await page.locator('button').filter({ hasText: /^播放$/ }).click();
      await expect(page.locator('button').filter({ hasText: /^暂停$/ })).toBeVisible();
      await expect(page.getByText('回放当前时间: 0:01')).toBeVisible({ timeout: 3000 });
      await seededContext.context.close();
      seededContext = null;

      fallbackContext = await launchExtensionContext(userDataDir);
      const runtimeStateAfterRestart = await fallbackContext.serviceWorker.evaluate(
        async () => chrome.storage.session.get('listen-graphic-runtime-state'),
      );
      expect(runtimeStateAfterRestart['listen-graphic-runtime-state']).toBeUndefined();
      const fallbackPage = await fallbackContext.context.newPage();

      await fallbackPage.goto(`chrome-extension://${fallbackContext.extensionId}/sidepanel.html`);
      await expect(fallbackPage.getByText('会话: session_real_extension')).toBeVisible();
      await expect(fallbackPage.getByText('当前时间: 1:00')).toBeVisible();
      await expect(fallbackPage.getByText('真实扩展节点')).toBeVisible();

      await fallbackPage.locator('button').filter({ hasText: /^调试$/ }).click();
      await expect(fallbackPage.getByTestId('debug-panel')).toBeVisible();
      await expect(fallbackPage.getByText('真实扩展第一段转写')).toBeVisible();

      await fallbackPage.locator('button').filter({ hasText: /^回放$/ }).click();
      await expect(fallbackPage.getByTestId('replay-panel')).toBeVisible();
      await expect(fallbackPage.getByText('回放时长: 1:00')).toBeVisible();
      await fallbackContext.context.close();
      fallbackContext = null;
    } finally {
      if (fallbackContext) {
        await fallbackContext.context.close();
      }
      if (seededContext) {
        await seededContext.context.close();
      }
      fs.rmSync(userDataDir, { recursive: true, force: true });
    }
  });
});
