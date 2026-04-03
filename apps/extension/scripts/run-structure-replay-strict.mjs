import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const extensionRoot = fileURLToPath(new URL('..', import.meta.url));
const fixtureDir = path.join(extensionRoot, 'src', 'service-worker', 'fixtures', 'structure');
const artifactDir = path.join(fixtureDir, 'artifacts', 'provider-instability');
const isDryRun = process.argv.includes('--dry-run');
const requestedFixtureFilter = process.env.LISTEN_GRAPHIC_E2E_STRUCTURE_FIXTURE?.trim().toLowerCase();

const fixtureNames = fs
  .readdirSync(fixtureDir)
  .filter((name) => name.endsWith('.json') && name.startsWith('replay-realtime-'))
  .map((name) => name.replace(/\.json$/i, ''))
  .filter((name) =>
    !requestedFixtureFilter
      ? true
      : requestedFixtureFilter
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean)
          .some((value) => name.toLowerCase().includes(value)),
  )
  .sort();

if (fixtureNames.length === 0) {
  console.error(
    requestedFixtureFilter
      ? `No replay fixtures matched LISTEN_GRAPHIC_E2E_STRUCTURE_FIXTURE=${requestedFixtureFilter}`
      : 'No replay fixtures found.',
  );
  process.exit(1);
}

const baseEnv = {
  ...process.env,
  LISTEN_GRAPHIC_E2E_STRUCTURE_PROFILE: 'replay',
  LISTEN_GRAPHIC_E2E_STRUCTURE_DIAGNOSTIC_DIR: artifactDir,
  LISTEN_GRAPHIC_E2E_STRUCTURE_ALLOW_EXTERNAL_SKIP:
    process.env.LISTEN_GRAPHIC_E2E_STRUCTURE_ALLOW_EXTERNAL_SKIP?.trim() || '0',
  LISTEN_GRAPHIC_E2E_STRUCTURER_TIMEOUT_MS:
    process.env.LISTEN_GRAPHIC_E2E_STRUCTURER_TIMEOUT_MS?.trim() || '180000',
  LISTEN_GRAPHIC_E2E_STRUCTURE_DELAY_MS:
    process.env.LISTEN_GRAPHIC_E2E_STRUCTURE_DELAY_MS?.trim() || '60000',
  LISTEN_GRAPHIC_E2E_STRUCTURE_TIMEOUT_COOLDOWN_MS:
    process.env.LISTEN_GRAPHIC_E2E_STRUCTURE_TIMEOUT_COOLDOWN_MS?.trim() || '240000',
  LISTEN_GRAPHIC_E2E_STRUCTURE_RATE_LIMIT_COOLDOWN_MS:
    process.env.LISTEN_GRAPHIC_E2E_STRUCTURE_RATE_LIMIT_COOLDOWN_MS?.trim() || '120000',
  LISTEN_GRAPHIC_E2E_STRUCTURE_EXTERNAL_RETRY_LIMIT:
    process.env.LISTEN_GRAPHIC_E2E_STRUCTURE_EXTERNAL_RETRY_LIMIT?.trim() || '1',
};

if (isDryRun) {
  console.log(
    JSON.stringify(
      {
        fixtureNames,
        env: {
          LISTEN_GRAPHIC_E2E_STRUCTURE_ALLOW_EXTERNAL_SKIP:
            baseEnv.LISTEN_GRAPHIC_E2E_STRUCTURE_ALLOW_EXTERNAL_SKIP,
          LISTEN_GRAPHIC_E2E_STRUCTURER_TIMEOUT_MS:
            baseEnv.LISTEN_GRAPHIC_E2E_STRUCTURER_TIMEOUT_MS,
          LISTEN_GRAPHIC_E2E_STRUCTURE_DELAY_MS:
            baseEnv.LISTEN_GRAPHIC_E2E_STRUCTURE_DELAY_MS,
          LISTEN_GRAPHIC_E2E_STRUCTURE_TIMEOUT_COOLDOWN_MS:
            baseEnv.LISTEN_GRAPHIC_E2E_STRUCTURE_TIMEOUT_COOLDOWN_MS,
          LISTEN_GRAPHIC_E2E_STRUCTURE_RATE_LIMIT_COOLDOWN_MS:
            baseEnv.LISTEN_GRAPHIC_E2E_STRUCTURE_RATE_LIMIT_COOLDOWN_MS,
          LISTEN_GRAPHIC_E2E_STRUCTURE_EXTERNAL_RETRY_LIMIT:
            baseEnv.LISTEN_GRAPHIC_E2E_STRUCTURE_EXTERNAL_RETRY_LIMIT,
        },
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

fs.mkdirSync(artifactDir, { recursive: true });

const overallSummary = {
  startedAt: new Date().toISOString(),
  finishedAt: '',
  strict: baseEnv.LISTEN_GRAPHIC_E2E_STRUCTURE_ALLOW_EXTERNAL_SKIP === '0',
  fixtureCount: fixtureNames.length,
  results: [],
};
let hasFailure = false;

for (const fixtureName of fixtureNames) {
  const startedAtMs = Date.now();
  const env = {
    ...baseEnv,
    LISTEN_GRAPHIC_E2E_STRUCTURE_FIXTURE: fixtureName,
  };
  const outputChunks = [];

  const child = spawn(
    process.platform === 'win32' ? 'cmd.exe' : 'pnpm',
    process.platform === 'win32'
      ? ['/c', 'pnpm', 'exec', 'vitest', 'run', 'src/service-worker/structure-focused.real.test.ts']
      : ['exec', 'vitest', 'run', 'src/service-worker/structure-focused.real.test.ts'],
    {
      cwd: extensionRoot,
      env,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  child.stdout.on('data', (chunk) => {
    const text = chunk.toString();
    outputChunks.push(text);
    process.stdout.write(text);
  });
  child.stderr.on('data', (chunk) => {
    const text = chunk.toString();
    outputChunks.push(text);
    process.stderr.write(text);
  });

  const result = await new Promise((resolve) => {
    child.on('exit', (code, signal) => {
      resolve({
        fixtureName,
        startedAt: new Date(startedAtMs).toISOString(),
        finishedAt: new Date().toISOString(),
        durationMs: Date.now() - startedAtMs,
        exitCode: code,
        signal,
        strict: env.LISTEN_GRAPHIC_E2E_STRUCTURE_ALLOW_EXTERNAL_SKIP === '0',
        outputTail: outputChunks.join('').slice(-8000),
      });
    });
  });

  overallSummary.results.push(result);
  const perFixtureArtifactPath = path.join(artifactDir, `${fixtureName}.strict.json`);
  fs.writeFileSync(perFixtureArtifactPath, `${JSON.stringify(result, null, 2)}\n`);
  hasFailure ||= result.exitCode !== 0;

  const delayMs = Number.parseInt(baseEnv.LISTEN_GRAPHIC_E2E_STRUCTURE_DELAY_MS, 10);
  if (delayMs > 0 && fixtureName !== fixtureNames[fixtureNames.length - 1]) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
}

overallSummary.finishedAt = new Date().toISOString();
const summaryPath = path.join(
  artifactDir,
  `strict-summary-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
);
fs.writeFileSync(summaryPath, `${JSON.stringify(overallSummary, null, 2)}\n`);
process.exit(hasFailure ? 1 : 0);
