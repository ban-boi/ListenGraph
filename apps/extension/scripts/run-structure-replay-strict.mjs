import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const extensionRoot = fileURLToPath(new URL('..', import.meta.url));
const fixtureDir = path.join(extensionRoot, 'src', 'service-worker', 'fixtures', 'structure');
const diagnosticDirArg = process.argv.find((a) => a.startsWith('--diagnostic-dir='));
const artifactDir = diagnosticDirArg
  ? path.resolve(extensionRoot, diagnosticDirArg.slice('--diagnostic-dir='.length))
  : path.join(fixtureDir, 'artifacts', 'provider-instability');
const isDryRun = process.argv.includes('--dry-run');
// --include-local：让 strict replay 也覆盖 replay-local-segNN fixture。
// 默认（不加 flag）只跑 replay-realtime-，保持 stable 门不变。
// local fixture 是 LLM-as-Judge promote 的产物，需要显式 opt-in 才进严格校验。
const includeLocal = process.argv.includes('--include-local');
const requestedFixtureFilter = process.env.LISTEN_GRAPHIC_E2E_STRUCTURE_FIXTURE?.trim().toLowerCase();

const replayPrefixes = includeLocal
  ? ['replay-realtime-', 'replay-local-']
  : ['replay-realtime-'];

// --include-local 时，local fixture 只收「已有 LLM judgment」的子集。
// 未判的 weak_scaffold fixture acceptance 是公式估算的弱值，强校验必大面积 fail，
// 混淆信号；只跑已 judge、可校准的，保持 --include-local 的闭环干净。
// judgmentDir 与 judge-acceptance.mjs 保持一致。
const judgmentDir = path.join(
  extensionRoot,
  'src',
  'service-worker',
  'fixtures',
  'asr-realtime',
  'artifacts',
  'segments',
  'judgments',
);
const judgedLocalNames = includeLocal
  ? new Set(
      fs.existsSync(judgmentDir)
        ? fs
            .readdirSync(judgmentDir)
            .filter((n) => n.endsWith('.judgment.json'))
            .map((n) => n.replace(/\.judgment\.json$/i, ''))
        : [],
    )
  : new Set();

const fixtureNames = fs
  .readdirSync(fixtureDir)
  .filter((name) => name.endsWith('.json') && replayPrefixes.some((p) => name.startsWith(p)))
  .map((name) => name.replace(/\.json$/i, ''))
  .filter((name) => {
    // local fixture 必须有对应 judgment 才入选（仅 --include-local 时生效）
    if (includeLocal && name.startsWith('replay-local-') && !judgedLocalNames.has(name)) {
      return false;
    }
    return true;
  })
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
  // --include-local 时，把测试侧的 replay 前缀也放宽到 replay-local-，
  // 否则 helpers 的 replay 过滤会把 local fixture 滤掉。
  // --include-local 时，把测试侧的 replay 前缀放宽到 replay-（同时匹配 realtime 和 local）。
  // 验证过 structure 目录只有 replay-realtime- 和 replay-local- 两类，replay- 是安全的 catchall。
  ...(includeLocal ? { LISTEN_GRAPHIC_E2E_STRUCTURE_REPLAY_PREFIX: 'replay-' } : {}),
  LISTEN_GRAPHIC_E2E_STRUCTURE_ALLOW_EXTERNAL_SKIP:
    process.env.LISTEN_GRAPHIC_E2E_STRUCTURE_ALLOW_EXTERNAL_SKIP?.trim() || '0',
  LISTEN_GRAPHIC_E2E_STRUCTURER_TIMEOUT_MS:
    process.env.LISTEN_GRAPHIC_E2E_STRUCTURER_TIMEOUT_MS?.trim() || '180000',
  LISTEN_GRAPHIC_E2E_STRUCTURE_DELAY_MS:
    process.env.LISTEN_GRAPHIC_E2E_STRUCTURE_DELAY_MS?.trim() || '10000',
  LISTEN_GRAPHIC_E2E_STRUCTURE_TIMEOUT_COOLDOWN_MS:
    process.env.LISTEN_GRAPHIC_E2E_STRUCTURE_TIMEOUT_COOLDOWN_MS?.trim() || '240000',
  LISTEN_GRAPHIC_E2E_STRUCTURE_RATE_LIMIT_COOLDOWN_MS:
    process.env.LISTEN_GRAPHIC_E2E_STRUCTURE_RATE_LIMIT_COOLDOWN_MS?.trim() || '120000',
  LISTEN_GRAPHIC_E2E_STRUCTURE_EXTERNAL_RETRY_LIMIT:
    process.env.LISTEN_GRAPHIC_E2E_STRUCTURE_EXTERNAL_RETRY_LIMIT?.trim() || '1',
};

const noAssembler = process.argv.includes('--no-assembler');
if (noAssembler) {
  baseEnv.LISTEN_GRAPHIC_STRUCTURE_UNIT_ASSEMBLER_ENABLED = 'false';
}

const modeLabel = noAssembler ? 'no-assembler' : 'with-assembler';
console.log(`[strict-replay] mode: ${modeLabel}${includeLocal ? ' +include-local' : ''}`);

if (isDryRun) {
  console.log(
    JSON.stringify(
      {
        fixtureNames,
        mode: modeLabel,
        includeLocal,
        replayPrefixes,
        judgedLocalCount: includeLocal ? judgedLocalNames.size : 0,
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
          LISTEN_GRAPHIC_STRUCTURE_UNIT_ASSEMBLER_ENABLED:
            baseEnv.LISTEN_GRAPHIC_STRUCTURE_UNIT_ASSEMBLER_ENABLED,
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
  mode: modeLabel,
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
