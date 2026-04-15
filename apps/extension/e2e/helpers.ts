import { expect, chromium, type BrowserContext, type Page, type TestInfo, type Worker as PlaywrightWorker } from '@playwright/test';
import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';
import { fileURLToPath } from 'url';
import type {
  AppMessage,
  DebugSessionData,
  ExportFormat,
  ReplaySessionData,
  RuntimeSnapshot,
} from '../src/shared/messages';
import type { ProviderConfig } from '@listen-graphic/schema';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const EXTENSION_PATH = path.resolve(__dirname, '../dist');
export const FIXTURE_ROOT = path.resolve(__dirname, './fixtures');

export async function launchExtensionContext(userDataDir: string): Promise<{
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

export async function createStaticServer(root: string) {
  const server = http.createServer((req, res) => {
    const requestPath = req.url === '/' ? '/index.html' : req.url ?? '/index.html';
    const filePath = path.join(root, requestPath.replace(/^\//, ''));

    if (!fs.existsSync(filePath)) {
      res.statusCode = 404;
      res.end('Not Found');
      return;
    }

    const content = fs.readFileSync(filePath);
    const extension = path.extname(filePath).toLowerCase();
    const contentTypes: Record<string, string> = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.wav': 'audio/wav',
      '.mp3': 'audio/mpeg',
      '.m4a': 'audio/mp4',
      '.flac': 'audio/flac',
    };
    const contentType = contentTypes[extension];
    if (contentType) {
      res.setHeader('Content-Type', contentType);
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

export async function closeStaticServer(server: http.Server) {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

export async function openSidepanelPage(context: BrowserContext, extensionId: string) {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  return page;
}

export async function resolveTabId(page: Page, targetUrl: string) {
  return await page.evaluate(async ({ url }) => {
    return await new Promise<number | null>((resolve) => {
      chrome.tabs.query({}, (tabs) => {
        resolve(tabs.find((tab) => tab.url === url)?.id ?? null);
      });
    });
  }, { url: targetUrl });
}

export async function startSession(page: Page, tabId: number) {
  return await sendRuntimeMessage<{
    success: boolean;
    error?: string;
    sessionId?: string;
    alreadyRunning?: boolean;
  }>(page, {
    type: 'SESSION_START',
    target: 'service-worker',
    payload: { tabId, sourceType: 'tab' },
  });
}

export async function stopSession(page: Page, sessionId: string) {
  return await sendRuntimeMessage<{ success: boolean; error?: string }>(page, {
    type: 'SESSION_STOP',
    target: 'service-worker',
    payload: { sessionId },
  });
}

export async function saveProviderSettings(
  serviceWorker: PlaywrightWorker,
  config: ProviderConfig,
) {
  await serviceWorker.evaluate(async (providerConfig) => {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open('listen-graphic-db', 2);

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
}

export async function applyProviderSettings(
  page: Page,
  config: ProviderConfig,
) {
  return await sendRuntimeMessage<{ success: boolean; error?: string }>(page, {
    type: 'SAVE_PROVIDER_SETTINGS',
    target: 'service-worker',
    payload: { config },
  });
}

export async function getRuntimeSnapshot(page: Page) {
  const response = await sendRuntimeMessage<{ success: true; snapshot: RuntimeSnapshot }>(page, {
    type: 'GET_RUNTIME_SNAPSHOT',
    target: 'service-worker',
    payload: {},
  });
  return response.snapshot;
}

export async function getDebugSession(page: Page, sessionId: string) {
  const response = await sendRuntimeMessage<{ success: true; debugData: DebugSessionData }>(page, {
    type: 'GET_DEBUG_SESSION',
    target: 'service-worker',
    payload: { sessionId },
  });
  return response.debugData;
}

export async function getReplaySession(page: Page, sessionId: string) {
  const response = await sendRuntimeMessage<{ success: true; replayData: ReplaySessionData }>(page, {
    type: 'GET_REPLAY_SESSION',
    target: 'service-worker',
    payload: { sessionId },
  });
  return response.replayData;
}

export async function exportSession(page: Page, sessionId: string, format: ExportFormat) {
  const response = await sendRuntimeMessage<{
    success: true;
    exportData: {
      filename: string;
      mimeType: string;
      content: string;
    };
  }>(page, {
    type: 'EXPORT_SESSION',
    target: 'service-worker',
    payload: { sessionId, format },
  });
  return response.exportData;
}

export async function waitForGraph(page: Page, minimumNodeCount: number, timeout = 15_000) {
  await expect
    .poll(async () => {
      const snapshot = await getRuntimeSnapshot(page);
      return snapshot.graph?.nodes.length ?? 0;
    }, { timeout })
    .toBeGreaterThanOrEqual(minimumNodeCount);
}

export async function captureSessionDiagnostics(params: {
  page: Page;
  testInfo: TestInfo;
  label: string;
}) {
  const { page, testInfo, label } = params;
  const runtimeSnapshot = await getRuntimeSnapshot(page);
  const sessionId = runtimeSnapshot.sessionId;
  const debugData = sessionId ? await getDebugSession(page, sessionId) : null;
  const exportData = sessionId ? await exportSession(page, sessionId, 'json') : null;

  await page.screenshot({
    path: testInfo.outputPath(`${label}-sidepanel.png`),
    fullPage: true,
  });

  fs.writeFileSync(
    testInfo.outputPath(`${label}-runtime.json`),
    JSON.stringify(runtimeSnapshot, null, 2),
    'utf-8',
  );

  if (debugData) {
    fs.writeFileSync(
      testInfo.outputPath(`${label}-debug.json`),
      JSON.stringify(debugData, null, 2),
      'utf-8',
    );
  }

  if (exportData) {
    fs.writeFileSync(
      testInfo.outputPath(`${label}-export.json`),
      exportData.content,
      'utf-8',
    );
  }
}

async function sendRuntimeMessage<TResponse>(page: Page, message: AppMessage): Promise<TResponse> {
  return await page.evaluate(async (payload) => {
    return await chrome.runtime.sendMessage(payload);
  }, message) as TResponse;
}
