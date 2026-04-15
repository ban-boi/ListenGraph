import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import type { BrowserContext, Page } from '@playwright/test';
import type { ProviderConfig } from '@listen-graphic/schema';
import {
  applyProviderSettings,
  FIXTURE_ROOT,
  closeStaticServer,
  createStaticServer,
  exportSession,
  getDebugSession,
  getReplaySession,
  getRuntimeSnapshot,
  launchExtensionContext,
  openSidepanelPage,
  resolveTabId,
  saveProviderSettings,
  startSession,
  stopSession,
  waitForGraph,
} from './helpers';

const fixtureManifest = JSON.parse(
  fs.readFileSync(path.join(FIXTURE_ROOT, 'fixture-manifest.json'), 'utf-8'),
) as {
  localAcceptance: {
    minTranscriptChunks: number;
    minGraphNodes: number;
    minGraphEdges: number;
  };
};

const mockProviderConfig: ProviderConfig = {
  asr: {
    type: 'mock',
    mode: 'direct',
    model: 'mock-asr',
    language: 'en',
  },
  structurer: {
    type: 'mock',
    mode: 'direct',
    model: 'mock-structurer',
    language: 'en',
  },
};

const invalidTencentProviderConfig: ProviderConfig = {
  asr: {
    type: 'tencent',
    mode: 'direct',
    transport: 'ws',
    model: '16k_zh',
    language: 'zh',
    appId: undefined,
    secretId: undefined,
    secretKey: undefined,
  },
  structurer: {
    type: 'mock',
    mode: 'direct',
    model: 'mock-structurer',
    language: 'zh',
  },
};

test.describe('Extension local closure validation', () => {
  test('provider-error-visible: invalid provider config surfaces a stable UI/runtime failure', async ({}, testInfo) => {
    const userDataDir = testInfo.outputPath('extension-user-data');
    fs.mkdirSync(userDataDir, { recursive: true });

    let context: BrowserContext | null = null;

    try {
      const launched = await launchExtensionContext(userDataDir);
      context = launched.context;
      await saveProviderSettings(launched.serviceWorker, invalidTencentProviderConfig);

      const sidepanelPage = await openSidepanelPage(context, launched.extensionId);

      await sidepanelPage.getByRole('button', { name: /^开始$/ }).click();

      await expect(sidepanelPage.getByTestId('recent-error-banner')).toContainText('最近错误');
      await expect(sidepanelPage.getByTestId('recent-error-banner')).toContainText('CONFIG_ERROR');
      await expect(sidepanelPage.getByTestId('recent-error-banner')).toContainText('secretId and secretKey');
      await expect(sidepanelPage.getByTestId('log-area')).toContainText('PROVIDER_CONFIG_ERROR');
      await expect(sidepanelPage.getByTestId('log-area')).toContainText('secretId and secretKey');
      await expect(sidepanelPage.getByRole('button', { name: /^开始$/ })).toBeVisible();

      const runtimeSnapshot = await getRuntimeSnapshot(sidepanelPage);
      expect(runtimeSnapshot.state).toBe('idle');
      expect(runtimeSnapshot.graph).toBeNull();
      expect(runtimeSnapshot.lastProviderError).toEqual(
        expect.objectContaining({
          code: 'CONFIG_ERROR',
          provider: 'provider-config',
          retriable: false,
        }),
      );
    } finally {
      if (context) {
        await context.close();
      }
    }
  });

  test('post-session-assets-available: stopped sessions keep debug/export/replay available and consistent', async ({}, testInfo) => {
    const userDataDir = testInfo.outputPath('extension-user-data');
    fs.mkdirSync(userDataDir, { recursive: true });

    const { server, url } = await createStaticServer(FIXTURE_ROOT);
    let context: BrowserContext | null = null;

    try {
      const launched = await launchExtensionContext(userDataDir);
      context = launched.context;
      const fixturePage = await context.newPage();
      await fixturePage.goto(`${url}/index.html`);

      const sidepanelPage = await openSidepanelPage(context, launched.extensionId);
      const saveResponse = await applyProviderSettings(sidepanelPage, mockProviderConfig);
      expect(saveResponse.success).toBe(true);
      const tabId = await resolveTabId(sidepanelPage, `${url}/index.html`);
      expect(tabId).not.toBeNull();

      const sessionId = await runLocalFixtureSession(sidepanelPage, tabId!);

      await expect
        .poll(async () => {
          return await sidepanelPage.getByRole('button', { name: /^回放$/ }).isEnabled();
        })
        .toBe(true);
      await expect(sidepanelPage.getByRole('button', { name: /^导出 JSON$/ })).toBeEnabled();

      await sidepanelPage.getByRole('button', { name: /^调试$/ }).click();
      await expect(sidepanelPage.getByTestId('debug-panel')).toBeVisible();

      await sidepanelPage.getByRole('button', { name: /^回放$/ }).click();
      await expect(sidepanelPage.getByTestId('replay-panel')).toBeVisible();

      const runtimeSnapshot = await getRuntimeSnapshot(sidepanelPage);
      const debugData = await getDebugSession(sidepanelPage, sessionId);
      const replayData = await getReplaySession(sidepanelPage, sessionId);
      const exportData = await exportSession(sidepanelPage, sessionId, 'json');
      const exportedSession = JSON.parse(exportData.content) as {
        transcripts: Array<{ text: string }>;
        graph: { nodes: Array<{ text: string }>; edges: Array<{ type: string }> };
      };

      expect(runtimeSnapshot.state).toBe('idle');
      expect(runtimeSnapshot.lastProviderError ?? null).toBeNull();
      expect(debugData.transcripts.length).toBeGreaterThanOrEqual(
        fixtureManifest.localAcceptance.minTranscriptChunks,
      );
      expect(debugData.graph?.nodes.length ?? 0).toBeGreaterThanOrEqual(
        fixtureManifest.localAcceptance.minGraphNodes,
      );
      expect(replayData.transcripts.length).toBe(debugData.transcripts.length);
      expect(replayData.durationMs).toBe(16000);
      expect(exportedSession.transcripts.length).toBe(debugData.transcripts.length);
      expect(exportedSession.graph.nodes.length).toBe(debugData.graph?.nodes.length ?? 0);
      expect(exportedSession.graph.edges.length).toBe(debugData.graph?.edges.length ?? 0);
    } finally {
      if (context) {
        await context.close();
      }
      await closeStaticServer(server);
    }
  });
});

async function runLocalFixtureSession(page: Page, tabId: number) {
  const startResponse = await startSession(page, tabId);
  expect(startResponse.success).toBe(true);
  expect(startResponse.sessionId).toBeTruthy();
  const sessionId = startResponse.sessionId!;

  await waitForGraph(page, fixtureManifest.localAcceptance.minGraphNodes);

  const stopResponse = await stopSession(page, sessionId);
  expect(stopResponse.success).toBe(true);

  return sessionId;
}
