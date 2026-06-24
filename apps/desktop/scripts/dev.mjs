import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { dirname } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const port = 5174;
const host = '127.0.0.1';
const require = createRequire(import.meta.url);
const env = {
  ...process.env,
  VITE_DEV_SERVER_URL: `http://${host}:${port}`,
};

function assertElectronInstalled() {
  try {
    require('electron');
  } catch (error) {
    const electronDir = dirname(require.resolve('electron/package.json'));
    console.error(
      [
        'Electron binary is not installed correctly.',
        'Run `pnpm ensure:electron` first (uses npmmirror + Windows Expand-Archive fallback).',
        'If that still fails, try `pnpm rebuild electron` or:',
        `cd ${electronDir} && node install.js`,
        '',
        error instanceof Error ? error.message : String(error),
      ].join('\n'),
    );
    process.exit(1);
  }
}

function run(command, args, options = {}) {
  const child = spawn(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env,
    ...options,
  });
  child.on('exit', (code) => {
    if (!shuttingDown && code !== 0) {
      shutdown(code ?? 1);
    }
  });
  children.add(child);
  return child;
}

function isPortOpen() {
  return new Promise((resolve) => {
    const socket = createServer();
    socket.once('error', () => resolve(false));
    socket.once('listening', () => {
      socket.close(() => resolve(true));
    });
    socket.listen(port, host);
  });
}

async function waitForVite() {
  for (let i = 0; i < 80; i += 1) {
    const available = await isPortOpen();
    if (!available) return;
    await delay(250);
  }
  throw new Error(`Vite dev server did not bind ${host}:${port}`);
}

let shuttingDown = false;
const children = new Set();

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) child.kill();
  }
  process.exitCode = code;
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

assertElectronInstalled();
run('pnpm', ['exec', 'vite', '--host', host, '--port', String(port), '--strictPort']);
await waitForVite();
run('pnpm', ['exec', 'tsc', '-p', 'tsconfig.electron.json', '--watch', '--preserveWatchOutput']);
await delay(600);
run('pnpm', ['exec', 'electron', '.']);
