import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const extensionRoot = path.resolve(__dirname, '..');

const DEFAULT_FIXTURE_ROOT = path.join(extensionRoot, 'e2e', 'fixtures');
const DEFAULT_BRIDGE_HOST = '127.0.0.1';
const DEFAULT_BRIDGE_PORT = 15377;
const DEFAULT_BRIDGE_PATH = '/ws';
const DEFAULT_BRIDGE_PROTOCOL = 'lg-asr-ws-v1';
const DEFAULT_E2E_TIMEOUT_MS = 120_000;

const env = { ...process.env };
const fixtureRoot = env.LISTEN_GRAPHIC_E2E_REAL_FIXTURE_ROOT?.trim() || DEFAULT_FIXTURE_ROOT;
const bridgeHost = env.LISTEN_GRAPHIC_LOCAL_BRIDGE_HOST?.trim() || DEFAULT_BRIDGE_HOST;
const bridgePort = Number.parseInt(
  env.LISTEN_GRAPHIC_LOCAL_BRIDGE_PORT?.trim() || String(DEFAULT_BRIDGE_PORT),
  10,
);
const bridgePath = env.LISTEN_GRAPHIC_LOCAL_BRIDGE_PATH?.trim() || DEFAULT_BRIDGE_PATH;
const bridgeProtocol =
  env.LISTEN_GRAPHIC_E2E_ASR_BRIDGE_PROTOCOL?.trim() || DEFAULT_BRIDGE_PROTOCOL;
const bridgeEndpoint =
  env.LISTEN_GRAPHIC_E2E_ASR_ENDPOINT?.trim() ||
  `ws://${bridgeHost}:${bridgePort}${bridgePath}`;
const bridgeHealthUrl =
  env.LISTEN_GRAPHIC_LOCAL_BRIDGE_HEALTH_URL?.trim() ||
  `http://${bridgeHost}:${bridgePort}/healthz`;
const e2eTimeoutMs = Number.parseInt(
  env.LISTEN_GRAPHIC_E2E_REAL_TIMEOUT_MS?.trim() || String(DEFAULT_E2E_TIMEOUT_MS),
  10,
);

if (!fs.existsSync(fixtureRoot)) {
  console.error(`Real E2E fixture root not found: ${fixtureRoot}`);
  process.exit(1);
}

if (!Number.isFinite(bridgePort) || bridgePort <= 0) {
  console.error(`Invalid local bridge port: ${env.LISTEN_GRAPHIC_LOCAL_BRIDGE_PORT}`);
  process.exit(1);
}

if (!Number.isFinite(e2eTimeoutMs) || e2eTimeoutMs <= 0) {
  console.error(`Invalid real E2E timeout: ${env.LISTEN_GRAPHIC_E2E_REAL_TIMEOUT_MS}`);
  process.exit(1);
}

async function ensureBridgeHealthy(timeoutMs = 5_000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(bridgeHealthUrl);
      if (response.ok) {
        return;
      }
    } catch {
      // retry
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(
    `local bridge is not reachable at ${bridgeHealthUrl}; start a lg-asr-ws-v1 bridge or override LISTEN_GRAPHIC_LOCAL_BRIDGE_*`,
  );
}

async function main() {
  console.log(`[real-e2e:local-bridge] fixture: ${fixtureRoot}`);
  console.log(`[real-e2e:local-bridge] endpoint: ${bridgeEndpoint}`);
  console.log(`[real-e2e:local-bridge] health: ${bridgeHealthUrl}`);

  await ensureBridgeHealthy();
  console.log('[real-e2e:local-bridge] bridge ready');

  const e2eEnv = {
    ...env,
    LISTEN_GRAPHIC_E2E_REAL_FIXTURE_ROOT: fixtureRoot,
    LISTEN_GRAPHIC_E2E_ASR_TYPE: 'external',
    LISTEN_GRAPHIC_E2E_ASR_ENDPOINT: bridgeEndpoint,
    LISTEN_GRAPHIC_E2E_ASR_BRIDGE_PROTOCOL: bridgeProtocol,
    LISTEN_GRAPHIC_E2E_STRUCTURER_TYPE:
      env.LISTEN_GRAPHIC_E2E_REAL_STRUCTURER_TYPE?.trim() || 'mock',
    LISTEN_GRAPHIC_E2E_STRUCTURER_MODEL:
      env.LISTEN_GRAPHIC_E2E_REAL_STRUCTURER_MODEL?.trim() || 'mock-structurer',
  };

  const command = process.platform === 'win32' ? 'cmd.exe' : 'pnpm';
  const args =
    process.platform === 'win32'
      ? ['/c', 'pnpm', 'exec', 'playwright', 'test', 'e2e/extension.real.spec.ts']
      : ['exec', 'playwright', 'test', 'e2e/extension.real.spec.ts'];

  const child = spawn(command, args, {
    cwd: extensionRoot,
    stdio: 'inherit',
    env: e2eEnv,
    shell: false,
  });

  const exitCode = await new Promise((resolve, reject) => {
    const timeoutHandle = setTimeout(() => {
      try {
        child.kill('SIGTERM');
      } catch {
        // noop
      }
      reject(new Error(`real E2E exceeded ${e2eTimeoutMs}ms`));
    }, e2eTimeoutMs);

    child.on('error', (error) => {
      clearTimeout(timeoutHandle);
      reject(error);
    });

    child.on('exit', (code, signal) => {
      clearTimeout(timeoutHandle);
      if (signal) {
        reject(new Error(`real E2E terminated by signal ${signal}`));
        return;
      }
      resolve(code ?? 1);
    });
  });

  process.exit(Number(exitCode));
}

main().catch((error) => {
  console.error(
    `[real-e2e:local-bridge] ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
});
