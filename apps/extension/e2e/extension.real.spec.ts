import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import type { ProviderConfig } from '@listen-graphic/schema';
import {
  applyProviderSettings,
  captureSessionDiagnostics,
  closeStaticServer,
  createStaticServer,
  exportSession,
  getDebugSession,
  getRuntimeSnapshot,
  launchExtensionContext,
  openSidepanelPage,
  resolveTabId,
  startSession,
  waitForGraph,
} from './helpers';

type AcceptanceConfig = {
  minTranscriptChunks: number;
  minGraphNodes: number;
  minGraphEdges: number;
  minKeywordGroupHits: number;
  keywordGroups: string[][];
};

type FixtureManifest = {
  realAcceptance: AcceptanceConfig;
};

function loadRealFixtureRoot() {
  return process.env.LISTEN_GRAPHIC_E2E_REAL_FIXTURE_ROOT?.trim() || null;
}

function loadRealProviderConfigFromEnv(): ProviderConfig | null {
  const asrType = process.env.LISTEN_GRAPHIC_E2E_ASR_TYPE?.trim();
  const structurerType = process.env.LISTEN_GRAPHIC_E2E_STRUCTURER_TYPE?.trim();
  if (!asrType || !structurerType) {
    return null;
  }

  return {
    asr: {
      type: asrType as ProviderConfig['asr']['type'],
      mode: 'direct',
      endpoint: process.env.LISTEN_GRAPHIC_E2E_ASR_ENDPOINT?.trim() || undefined,
      apiKey: process.env.LISTEN_GRAPHIC_E2E_ASR_API_KEY?.trim() || undefined,
      model: process.env.LISTEN_GRAPHIC_E2E_ASR_MODEL?.trim() || undefined,
      language: process.env.LISTEN_GRAPHIC_E2E_ASR_LANGUAGE?.trim() || 'en',
      region: process.env.LISTEN_GRAPHIC_E2E_ASR_REGION?.trim() || undefined,
      secretId: process.env.LISTEN_GRAPHIC_E2E_ASR_SECRET_ID?.trim() || undefined,
      secretKey: process.env.LISTEN_GRAPHIC_E2E_ASR_SECRET_KEY?.trim() || undefined,
    },
    structurer: {
      type: structurerType as ProviderConfig['structurer']['type'],
      mode: 'direct',
      endpoint: process.env.LISTEN_GRAPHIC_E2E_STRUCTURER_ENDPOINT?.trim() || undefined,
      apiKey: process.env.LISTEN_GRAPHIC_E2E_STRUCTURER_API_KEY?.trim() || undefined,
      model: process.env.LISTEN_GRAPHIC_E2E_STRUCTURER_MODEL?.trim() || undefined,
      language: process.env.LISTEN_GRAPHIC_E2E_STRUCTURER_LANGUAGE?.trim() || 'en',
    },
  };
}

function countKeywordGroupHits(text: string, keywordGroups: string[][]) {
  const normalized = text.toLowerCase();
  return keywordGroups.filter((group) =>
    group.some((keyword) => normalized.includes(keyword.toLowerCase())),
  ).length;
}

test.describe('Extension real provider validation', () => {
  test('external real-audio fixture passes rule-based acceptance', async ({}, testInfo) => {
    const fixtureRoot = loadRealFixtureRoot();
    const providerConfig = loadRealProviderConfigFromEnv();

    test.skip(!fixtureRoot, 'LISTEN_GRAPHIC_E2E_REAL_FIXTURE_ROOT is not configured.');
    test.skip(!providerConfig, 'Real provider environment variables are not configured.');

    const fixtureManifest = JSON.parse(
      fs.readFileSync(path.join(fixtureRoot!, 'fixture-manifest.json'), 'utf-8'),
    ) as FixtureManifest;

    const userDataDir = testInfo.outputPath('extension-user-data');
    fs.mkdirSync(userDataDir, { recursive: true });

    const { server, url } = await createStaticServer(fixtureRoot!);
    let context: Awaited<ReturnType<typeof launchExtensionContext>>['context'] | null = null;

    try {
      const launched = await launchExtensionContext(userDataDir);
      context = launched.context;
      const fixturePage = await context.newPage();
      await fixturePage.goto(`${url}/index.html`);

      const sidepanelPage = await openSidepanelPage(context, launched.extensionId);
      const saveResponse = await applyProviderSettings(sidepanelPage, providerConfig!);
      expect(saveResponse.success).toBe(true);
      const tabId = await resolveTabId(sidepanelPage, `${url}/index.html`);
      expect(tabId).not.toBeNull();

      const startResponse = await startSession(sidepanelPage, tabId!);
      expect(startResponse.success).toBe(true);
      expect(startResponse.sessionId).toBeTruthy();
      const sessionId = startResponse.sessionId!;

      await waitForGraph(sidepanelPage, fixtureManifest.realAcceptance.minGraphNodes, 90_000);

      const runtimeSnapshot = await getRuntimeSnapshot(sidepanelPage);
      expect(runtimeSnapshot.lastProviderError ?? null).toBeNull();
      expect(runtimeSnapshot.graph?.nodes.length ?? 0).toBeGreaterThanOrEqual(
        fixtureManifest.realAcceptance.minGraphNodes,
      );
      expect(runtimeSnapshot.graph?.edges.length ?? 0).toBeGreaterThanOrEqual(
        fixtureManifest.realAcceptance.minGraphEdges,
      );

      const debugData = await getDebugSession(sidepanelPage, sessionId);
      expect(debugData.transcripts.length).toBeGreaterThanOrEqual(
        fixtureManifest.realAcceptance.minTranscriptChunks,
      );

      const combinedTranscript = debugData.transcripts
        .map((chunk) => chunk.text)
        .join(' ');
      const keywordHits = countKeywordGroupHits(
        combinedTranscript,
        fixtureManifest.realAcceptance.keywordGroups,
      );
      expect(keywordHits).toBeGreaterThanOrEqual(
        fixtureManifest.realAcceptance.minKeywordGroupHits,
      );

      const exportData = await exportSession(sidepanelPage, sessionId, 'json');
      const exportedSession = JSON.parse(exportData.content) as {
        transcripts: unknown[];
        graph: { nodes: unknown[]; edges: unknown[] };
      };
      expect(exportedSession.transcripts.length).toBeGreaterThanOrEqual(
        fixtureManifest.realAcceptance.minTranscriptChunks,
      );
      expect(exportedSession.graph.nodes.length).toBeGreaterThanOrEqual(
        fixtureManifest.realAcceptance.minGraphNodes,
      );
      expect(exportedSession.graph.edges.length).toBeGreaterThanOrEqual(
        fixtureManifest.realAcceptance.minGraphEdges,
      );

      await captureSessionDiagnostics({
        page: sidepanelPage,
        testInfo,
        label: 'real-provider-validation',
      });
    } finally {
      if (context) {
        await context.close();
      }
      await closeStaticServer(server);
    }
  });
});
