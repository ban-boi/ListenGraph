import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const profile = (process.argv[2] || 'full').trim().toLowerCase();
const extensionRoot = fileURLToPath(new URL('..', import.meta.url));

if (!['smoke', 'full'].includes(profile)) {
  console.error(`Unsupported profile "${profile}". Expected smoke or full.`);
  process.exit(1);
}

const env = { ...process.env };
env.LISTEN_GRAPHIC_E2E_STRUCTURE_PROFILE = profile;

if (!env.LISTEN_GRAPHIC_E2E_STRUCTURER_TIMEOUT_MS) {
  env.LISTEN_GRAPHIC_E2E_STRUCTURER_TIMEOUT_MS = '180000';
}

if (!env.LISTEN_GRAPHIC_E2E_STRUCTURE_DELAY_MS) {
  env.LISTEN_GRAPHIC_E2E_STRUCTURE_DELAY_MS = profile === 'smoke' ? '30000' : '60000';
}

const command = process.platform === 'win32' ? 'cmd.exe' : 'pnpm';
const args =
  process.platform === 'win32'
    ? ['/c', 'pnpm', 'exec', 'vitest', 'run', 'src/service-worker/structure-focused.real.test.ts']
    : ['exec', 'vitest', 'run', 'src/service-worker/structure-focused.real.test.ts'];

const child = spawn(command, args, {
  stdio: 'inherit',
  env,
  cwd: extensionRoot,
  shell: false,
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
