import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import type { ProviderConfig } from '@listen-graphic/schema';
import {
  applyProviderSettings,
  EXTENSION_PATH,
  FIXTURE_ROOT,
  captureSessionDiagnostics,
  clickOverflowMenuItem,
  closeStaticServer,
  createStaticServer,
  exportSession,
  getReplaySession,
  getRuntimeSnapshot,
  launchExtensionContext,
  openOverflowMenu,
  openSidepanelPage,
  resolveTabId,
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

test.describe('Extension local regression', () => {
  test('dist contains required extension assets', () => {
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
      expect(fs.existsSync(filePath), `${file} should exist in dist/`).toBeTruthy();
    }

    const manifestPath = path.join(EXTENSION_PATH, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.permissions).toEqual(
      expect.arrayContaining(['tabCapture', 'offscreen', 'sidePanel', 'scripting']),
    );
    expect(manifest.side_panel.default_path).toBe('sidepanel.html');
    expect(manifest.background.type).toBe('module');

    const serviceWorkerBundle = fs.readFileSync(
      path.join(EXTENSION_PATH, 'service-worker.js'),
      'utf-8',
    );
    expect(serviceWorkerBundle).toContain('NODE_CLICKED');
    expect(serviceWorkerBundle).toContain('MERGED_GRAPH_UPDATED');
    expect(serviceWorkerBundle).toContain('executeScript');
  });

  test('fixture-driven mock pipeline renders graph and supports debug/export/replay', async ({}, testInfo) => {
    const userDataDir = testInfo.outputPath('extension-user-data');
    fs.mkdirSync(userDataDir, { recursive: true });

    const { server, url } = await createStaticServer(FIXTURE_ROOT);
    let context: Awaited<ReturnType<typeof launchExtensionContext>>['context'] | null = null;

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

      const startResponse = await startSession(sidepanelPage, tabId!);
      expect(startResponse.success).toBe(true);
      expect(startResponse.sessionId).toBeTruthy();
      const sessionId = startResponse.sessionId!;

      await waitForGraph(sidepanelPage, fixtureManifest.localAcceptance.minGraphNodes);

      const runtimeSnapshot = await getRuntimeSnapshot(sidepanelPage);
      expect(runtimeSnapshot.lastProviderError ?? null).toBeNull();
      expect(runtimeSnapshot.graph?.nodes.length ?? 0).toBeGreaterThanOrEqual(
        fixtureManifest.localAcceptance.minGraphNodes,
      );
      expect(runtimeSnapshot.graph?.edges.length ?? 0).toBeGreaterThanOrEqual(
        fixtureManifest.localAcceptance.minGraphEdges,
      );

      await clickOverflowMenuItem(sidepanelPage, 'overflow-menu-debug');
      await expect(sidepanelPage.getByTestId('debug-panel')).toBeVisible();
      await expect(sidepanelPage.getByText(/transcript units: 4/)).toBeVisible();
      await expect(sidepanelPage.getByText(/structurer segments: 2/)).toBeVisible();
      await expect(sidepanelPage.getByText(/merged graph nodes:/)).toBeVisible();

      const exportData = await exportSession(sidepanelPage, sessionId, 'json');
      const exportedSession = JSON.parse(exportData.content) as {
        transcripts: unknown[];
        graph: { nodes: unknown[]; edges: unknown[] };
      };
      expect(exportedSession.transcripts.length).toBeGreaterThanOrEqual(
        fixtureManifest.localAcceptance.minTranscriptChunks,
      );
      expect(exportedSession.graph.nodes.length).toBeGreaterThanOrEqual(
        fixtureManifest.localAcceptance.minGraphNodes,
      );
      expect(exportedSession.graph.edges.length).toBeGreaterThanOrEqual(
        fixtureManifest.localAcceptance.minGraphEdges,
      );

      const stopResponse = await stopSession(sidepanelPage, sessionId);
      expect(stopResponse.success).toBe(true);

      await expect
        .poll(async () => {
          await openOverflowMenu(sidepanelPage);
          return await sidepanelPage.getByTestId('overflow-menu-replay').isEnabled();
        })
        .toBe(true);

      await clickOverflowMenuItem(sidepanelPage, 'overflow-menu-replay');
      await expect(sidepanelPage.getByTestId('replay-panel')).toBeVisible();

      const replayData = await getReplaySession(sidepanelPage, sessionId);
      expect(replayData.transcripts.length).toBeGreaterThanOrEqual(
        fixtureManifest.localAcceptance.minTranscriptChunks,
      );
      expect(replayData.durationMs).toBe(16000);

      await captureSessionDiagnostics({
        page: sidepanelPage,
        testInfo,
        label: 'local-regression',
      });
    } finally {
      if (context) {
        await context.close();
      }
      await closeStaticServer(server);
    }
  });
});
