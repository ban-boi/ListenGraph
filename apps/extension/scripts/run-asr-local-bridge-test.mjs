// apps/extension/scripts/run-asr-local-bridge-test.mjs
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const extensionRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(extensionRoot, '..', '..');

const DEFAULT_BRIDGE_HOST = '127.0.0.1';
const DEFAULT_BRIDGE_PORT = 15377;
const mockBridgeScript = path.join(repoRoot, 'tools', 'mock-asr-bridge.mjs');

const env = { ...process.env };
const bridgeHost = env.LISTEN_GRAPHIC_LOCAL_BRIDGE_HOST?.trim() || DEFAULT_BRIDGE_HOST;
const bridgePort = Number.parseInt(
  env.LISTEN_GRAPHIC_LOCAL_BRIDGE_PORT?.trim() || String(DEFAULT_BRIDGE_PORT),
  10,
);

let bridgeProcess = null;
let testProcess = null;
let shuttingDown = false;

function terminate(child) {
  if (!child || child.killed) return;
  try { child.kill('SIGTERM'); } catch { /* noop */ }
}

async function waitForBridge(timeoutMs = 5_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`http://${bridgeHost}:${bridgePort}/healthz`);
      if (res.ok) return;
    } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Mock bridge 在 ${timeoutMs}ms 内未就绪`);
}

function installSignalHandlers() {
  const handle = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    terminate(testProcess);
    terminate(bridgeProcess);
    process.exitCode = 1;
  };
  process.on('SIGINT', handle);
  process.on('SIGTERM', handle);
}

async function main() {
  installSignalHandlers();

  console.log(`[asr-local-bridge-test] 启动 mock bridge: ws://${bridgeHost}:${bridgePort}/ws`);

  bridgeProcess = spawn('node', [mockBridgeScript], {
    cwd: repoRoot,
    stdio: 'inherit',
    env: {
      ...env,
      LISTEN_GRAPHIC_MOCK_BRIDGE_HOST: bridgeHost,
      LISTEN_GRAPHIC_MOCK_BRIDGE_PORT: String(bridgePort),
    },
    shell: false,
  });

  await waitForBridge();
  console.log('[asr-local-bridge-test] mock bridge 就绪');

  const testEnv = {
    ...env,
    LISTEN_GRAPHIC_LOCAL_BRIDGE_ENDPOINT: `ws://${bridgeHost}:${bridgePort}/ws`,
    LISTEN_GRAPHIC_LOCAL_BRIDGE_HEALTH_URL: `http://${bridgeHost}:${bridgePort}/healthz`,
  };

  const command = process.platform === 'win32' ? 'cmd.exe' : 'pnpm';
  const args = process.platform === 'win32'
    ? ['/c', 'pnpm', 'exec', 'vitest', 'run', 'src/service-worker/asr-realtime.local-bridge.test.ts']
    : ['exec', 'vitest', 'run', 'src/service-worker/asr-realtime.local-bridge.test.ts'];

  testProcess = spawn(command, args, {
    cwd: extensionRoot,
    stdio: 'inherit',
    env: testEnv,
    shell: false,
  });

  const exitCode = await new Promise((resolve) => {
    testProcess.on('exit', (code) => resolve(code ?? 1));
    testProcess.on('error', () => resolve(1));
  });

  terminate(bridgeProcess);
  process.exit(Number(exitCode));
}

main().catch((err) => {
  terminate(bridgeProcess);
  console.error(`[asr-local-bridge-test] 失败: ${err.message}`);
  process.exit(1);
});
