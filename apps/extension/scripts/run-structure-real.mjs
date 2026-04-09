import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const profile = (process.argv[2] || 'full').trim().toLowerCase();
const extensionRoot = fileURLToPath(new URL('..', import.meta.url));
const FULL_PART_1_FIXTURES = [
  'bootstrap-basic',
  'bootstrap-debate-response',
  'bootstrap-decision-reason',
  'bootstrap-identity-tradeoff',
  'bootstrap-law-constraint',
  'bootstrap-meaning-path',
  'bootstrap-style-complement',
  'bootstrap-value-greed',
];
const FULL_PART_2_FIXTURES = [
  'bootstrap-public-safety',
  'bootstrap-weird-interesting',
  'incremental-career-regret',
  'incremental-neutrality-conflict',
  'incremental-role-self',
  'incremental-support-reason',
  'low-novelty-fallback',
];

if (!['smoke', 'full', 'full-part1', 'full-part2', 'replay'].includes(profile)) {
  console.error(
    `Unsupported profile "${profile}". Expected smoke, full, full-part1, full-part2, or replay.`,
  );
  process.exit(1);
}

const env = { ...process.env };
env.LISTEN_GRAPHIC_E2E_STRUCTURE_PROFILE =
  profile === 'full-part1' || profile === 'full-part2' ? 'full' : profile;

if (profile === 'full-part1') {
  env.LISTEN_GRAPHIC_E2E_STRUCTURE_FIXTURE = FULL_PART_1_FIXTURES.join(',');
}

if (profile === 'full-part2') {
  env.LISTEN_GRAPHIC_E2E_STRUCTURE_FIXTURE = FULL_PART_2_FIXTURES.join(',');
}

if (!env.LISTEN_GRAPHIC_E2E_STRUCTURER_TIMEOUT_MS) {
  env.LISTEN_GRAPHIC_E2E_STRUCTURER_TIMEOUT_MS = '180000';
}

if (!env.LISTEN_GRAPHIC_E2E_STRUCTURE_DELAY_MS) {
  env.LISTEN_GRAPHIC_E2E_STRUCTURE_DELAY_MS =
    profile === 'smoke' ? '20000' : profile === 'replay' ? '15000' : '30000';
}

if (!env.LISTEN_GRAPHIC_E2E_STRUCTURE_TIMEOUT_COOLDOWN_MS) {
  env.LISTEN_GRAPHIC_E2E_STRUCTURE_TIMEOUT_COOLDOWN_MS =
    profile === 'smoke' ? '240000' : profile === 'replay' ? '60000' : '300000';
}

if (!env.LISTEN_GRAPHIC_E2E_STRUCTURE_RATE_LIMIT_COOLDOWN_MS) {
  env.LISTEN_GRAPHIC_E2E_STRUCTURE_RATE_LIMIT_COOLDOWN_MS =
    profile === 'smoke' ? '120000' : profile === 'replay' ? '30000' : '180000';
}

if (!env.LISTEN_GRAPHIC_E2E_STRUCTURE_EXTERNAL_RETRY_LIMIT) {
  env.LISTEN_GRAPHIC_E2E_STRUCTURE_EXTERNAL_RETRY_LIMIT =
    profile === 'smoke' ? '1' : profile === 'replay' ? '1' : '2';
}

if (!env.LISTEN_GRAPHIC_E2E_STRUCTURE_ALLOW_EXTERNAL_SKIP) {
  env.LISTEN_GRAPHIC_E2E_STRUCTURE_ALLOW_EXTERNAL_SKIP =
    profile === 'replay' ? '1' : '0';
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
