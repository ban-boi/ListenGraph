import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const extensionRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(extensionRoot, '..', '..');

const DEFAULT_PYTHON_BIN =
  'C:\\Users\\finni\\AppData\\Local\\Programs\\Python\\Python313\\python.exe';
const DEFAULT_MODEL_DIR = path.join(
  repoRoot,
  '.tmp',
  'sherpa-model',
  'sherpa-onnx-streaming-paraformer-bilingual-zh-en',
);
const DEFAULT_BRIDGE_SCRIPT = path.join(repoRoot, 'tools', 'sherpa-onnx-bridge.py');
const DEFAULT_FIXTURE_ROOT = path.join(extensionRoot, 'e2e', 'fixtures');
const DEFAULT_BRIDGE_HOST = '127.0.0.1';
const DEFAULT_BRIDGE_PORT = 15377;
const DEFAULT_BRIDGE_PROTOCOL = 'lg-asr-ws-v1';
const DEFAULT_E2E_TIMEOUT_MS = 120_000;

const env = { ...process.env };
const pythonBin = env.LISTEN_GRAPHIC_SHERPA_PYTHON?.trim() || DEFAULT_PYTHON_BIN;
const modelDir = env.LISTEN_GRAPHIC_SHERPA_MODEL_DIR?.trim() || DEFAULT_MODEL_DIR;
const bridgeScript = env.LISTEN_GRAPHIC_SHERPA_BRIDGE_SCRIPT?.trim() || DEFAULT_BRIDGE_SCRIPT;
const fixtureRoot = env.LISTEN_GRAPHIC_E2E_REAL_FIXTURE_ROOT?.trim() || DEFAULT_FIXTURE_ROOT;
const bridgeHost = env.LISTEN_GRAPHIC_SHERPA_BRIDGE_HOST?.trim() || DEFAULT_BRIDGE_HOST;
const bridgePort = Number.parseInt(
  env.LISTEN_GRAPHIC_SHERPA_BRIDGE_PORT?.trim() || String(DEFAULT_BRIDGE_PORT),
  10,
);
const e2eTimeoutMs = Number.parseInt(
  env.LISTEN_GRAPHIC_E2E_REAL_TIMEOUT_MS?.trim() || String(DEFAULT_E2E_TIMEOUT_MS),
  10,
);
const reuseExistingBridge =
  (env.LISTEN_GRAPHIC_SHERPA_REUSE_EXISTING?.trim() || '1') !== '0';

if (!fs.existsSync(pythonBin)) {
  console.error(`Sherpa Python executable not found: ${pythonBin}`);
  process.exit(1);
}

if (!fs.existsSync(bridgeScript)) {
  console.error(`Sherpa bridge script not found: ${bridgeScript}`);
  process.exit(1);
}

if (!fs.existsSync(modelDir)) {
  console.error(`Sherpa model directory not found: ${modelDir}`);
  process.exit(1);
}

if (!fs.existsSync(fixtureRoot)) {
  console.error(`Real E2E fixture root not found: ${fixtureRoot}`);
  process.exit(1);
}

if (!Number.isFinite(bridgePort) || bridgePort <= 0) {
  console.error(`Invalid Sherpa bridge port: ${env.LISTEN_GRAPHIC_SHERPA_BRIDGE_PORT}`);
  process.exit(1);
}

if (!Number.isFinite(e2eTimeoutMs) || e2eTimeoutMs <= 0) {
  console.error(`Invalid real E2E timeout: ${env.LISTEN_GRAPHIC_E2E_REAL_TIMEOUT_MS}`);
  process.exit(1);
}

const bridgeEnv = {
  ...env,
};

const e2eEnv = {
  ...env,
  LISTEN_GRAPHIC_E2E_REAL_FIXTURE_ROOT: fixtureRoot,
  LISTEN_GRAPHIC_E2E_ASR_TYPE: 'external',
  LISTEN_GRAPHIC_E2E_ASR_ENDPOINT: `ws://${bridgeHost}:${bridgePort}/ws`,
  LISTEN_GRAPHIC_E2E_ASR_MODEL:
    env.LISTEN_GRAPHIC_E2E_ASR_MODEL?.trim() || path.basename(modelDir),
  LISTEN_GRAPHIC_E2E_ASR_BRIDGE_PROTOCOL:
    env.LISTEN_GRAPHIC_E2E_ASR_BRIDGE_PROTOCOL?.trim() || DEFAULT_BRIDGE_PROTOCOL,
  LISTEN_GRAPHIC_E2E_STRUCTURER_TYPE:
    env.LISTEN_GRAPHIC_E2E_REAL_STRUCTURER_TYPE?.trim() || 'mock',
  LISTEN_GRAPHIC_E2E_STRUCTURER_MODEL:
    env.LISTEN_GRAPHIC_E2E_REAL_STRUCTURER_MODEL?.trim() || 'mock-structurer',
};

const bridgeArgs = [
  bridgeScript,
  '--host',
  bridgeHost,
  '--port',
  String(bridgePort),
  '--encoder',
  path.join(modelDir, 'encoder.int8.onnx'),
  '--decoder',
  path.join(modelDir, 'decoder.int8.onnx'),
  '--tokens',
  path.join(modelDir, 'tokens.txt'),
  '--model-name',
  path.basename(modelDir),
];

let bridgeProcess = null;
let e2eProcess = null;
let shuttingDown = false;

function terminateChild(child, signal = 'SIGTERM') {
  if (!child || child.killed) {
    return;
  }

  try {
    child.kill(signal);
  } catch {
    // noop
  }
}

async function waitForBridgeReady(timeoutMs = 15_000) {
  const startedAt = Date.now();
  const healthUrl = `http://${bridgeHost}:${bridgePort}/healthz`;

  while (Date.now() - startedAt < timeoutMs) {
    if (bridgeProcess?.exitCode != null) {
      throw new Error(`Sherpa bridge exited early with code ${bridgeProcess.exitCode}`);
    }

    try {
      const response = await fetch(healthUrl);
      if (response.ok) {
        return;
      }
    } catch {
      // retry
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`Sherpa bridge did not become ready within ${timeoutMs}ms`);
}

async function detectExistingBridge(timeoutMs = 1_000) {
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`http://${bridgeHost}:${bridgePort}/healthz`, {
      signal: controller.signal,
    });
    return response.ok;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return false;
    }
    return false;
  } finally {
    clearTimeout(timeoutHandle);
  }
}

function installSignalHandlers() {
  const handleSignal = (signal) => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    terminateChild(e2eProcess, signal);
    terminateChild(bridgeProcess, signal);
    process.exitCode = 1;
  };

  process.on('SIGINT', handleSignal);
  process.on('SIGTERM', handleSignal);
}

async function main() {
  installSignalHandlers();

  console.log(`[real-e2e:sherpa] python: ${pythonBin}`);
  console.log(`[real-e2e:sherpa] model: ${modelDir}`);
  console.log(`[real-e2e:sherpa] fixture: ${fixtureRoot}`);
  console.log(`[real-e2e:sherpa] endpoint: ws://${bridgeHost}:${bridgePort}/ws`);

  const hasExistingBridge = await detectExistingBridge();
  if (hasExistingBridge) {
    if (!reuseExistingBridge) {
      throw new Error(
        `bridge endpoint http://${bridgeHost}:${bridgePort}/healthz is already occupied; stop the existing bridge or set LISTEN_GRAPHIC_SHERPA_REUSE_EXISTING=1`,
      );
    }
    console.log('[real-e2e:sherpa] reusing existing bridge');
  } else {
    bridgeProcess = spawn(pythonBin, bridgeArgs, {
      cwd: repoRoot,
      stdio: 'inherit',
      env: bridgeEnv,
      shell: false,
    });

    bridgeProcess.on('exit', (code, signal) => {
      if (!shuttingDown && code !== 0) {
        console.error(
          `[real-e2e:sherpa] bridge exited unexpectedly (code=${code}, signal=${signal ?? 'none'})`,
        );
      }
    });

    await waitForBridgeReady();
    console.log('[real-e2e:sherpa] bridge ready');
  }

  const command = process.platform === 'win32' ? 'cmd.exe' : 'pnpm';
  const args =
    process.platform === 'win32'
      ? ['/c', 'pnpm', 'exec', 'playwright', 'test', 'e2e/extension.real.spec.ts']
      : ['exec', 'playwright', 'test', 'e2e/extension.real.spec.ts'];

  e2eProcess = spawn(command, args, {
    cwd: extensionRoot,
    stdio: 'inherit',
    env: e2eEnv,
    shell: false,
  });

  const exitCode = await new Promise((resolve, reject) => {
    const timeoutHandle = setTimeout(() => {
      terminateChild(e2eProcess, 'SIGTERM');
      reject(new Error(`real E2E exceeded ${e2eTimeoutMs}ms`));
    }, e2eTimeoutMs);

    e2eProcess.on('error', (error) => {
      clearTimeout(timeoutHandle);
      reject(error);
    });

    e2eProcess.on('exit', (code, signal) => {
      clearTimeout(timeoutHandle);
      if (signal) {
        reject(new Error(`real E2E terminated by signal ${signal}`));
        return;
      }

      resolve(code ?? 1);
    });
  });

  if (bridgeProcess) {
    terminateChild(bridgeProcess, 'SIGTERM');
  }
  process.exit(Number(exitCode));
}

main().catch((error) => {
  terminateChild(e2eProcess, 'SIGTERM');
  terminateChild(bridgeProcess, 'SIGTERM');
  console.error(`[real-e2e:sherpa] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
