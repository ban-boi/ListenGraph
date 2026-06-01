import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(packageRoot, '..', '..');
const fixtureDir = path.resolve(packageRoot, 'src', 'service-worker', 'fixtures', 'structure');
const summaryPath = path.resolve(repoRoot, '.tmp', 'semantic-structure-summary.json');

const options = parseArgs(process.argv.slice(2));
const fixtures = fs
  .readdirSync(fixtureDir)
  .filter((name) => name.endsWith('.json') && name.startsWith('semantic-'))
  .map((name) => path.basename(name, '.json'))
  .filter((name) => !options.filter || name.includes(options.filter))
  .sort();

if (fixtures.length === 0) {
  throw new Error(
    options.filter
      ? `No semantic fixtures matched --filter ${options.filter}`
      : 'No semantic fixtures found.',
  );
}

fs.mkdirSync(path.dirname(summaryPath), { recursive: true });

const results = [];
for (const fixture of fixtures) {
  const startedAt = new Date();
  console.log(`\n=== semantic fixture: ${fixture} started=${startedAt.toISOString()} ===`);

  // 将输出重定向到临时文件，避免大量 fixture 输出在内存中缓存
  const tmpOutputPath = path.join(os.tmpdir(), `listen-graphic-semantic-${fixture}.log`);
  const outputFd = fs.openSync(tmpOutputPath, 'w');

  const result = spawnSync('pnpm --filter extension test:structure:real', {
    cwd: repoRoot,
    env: {
      ...process.env,
      LISTEN_GRAPHIC_E2E_STRUCTURE_FIXTURE: fixture,
    },
    encoding: 'utf-8',
    shell: true,
    stdio: ['ignore', outputFd, outputFd],
  });

  fs.closeSync(outputFd);

  const finishedAt = new Date();
  // 进程结束后从文件读取输出，用于汇总分析
  const output = fs.readFileSync(tmpOutputPath, 'utf-8');
  fs.unlinkSync(tmpOutputPath);

  if (result.error) {
    process.stdout.write(`\nspawn error: ${result.error.message}\n`);
  }
  if (options.showOutput || result.status !== 0) {
    process.stdout.write(output);
  }

  const summary = summarizeFixtureOutput(output);
  const item = {
    fixture,
    exitCode: result.status ?? 1,
    signal: result.signal,
    error: result.error?.message,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    ...summary,
  };
  results.push(item);
  fs.writeFileSync(summaryPath, `${JSON.stringify(results, null, 2)}\n`);

  console.log(
    [
      `=== result: ${fixture}`,
      `exit=${item.exitCode}`,
      `durationMs=${item.durationMs}`,
      `fetches=${item.fetchStarts}`,
      `successes=${item.fetchSuccesses}`,
      `reason=${item.failureReason ?? 'ok'}`,
      '===',
    ].join(' '),
  );
}

console.log('\n=== semantic summary ===');
for (const item of results) {
  console.log(
    [
      item.exitCode === 0 ? 'PASS' : 'FAIL',
      item.fixture,
      `durationMs=${item.durationMs}`,
      `fetches=${item.fetchStarts}`,
      `successes=${item.fetchSuccesses}`,
      item.failureReason ? `reason=${item.failureReason}` : '',
    ]
      .filter(Boolean)
      .join(' '),
  );
}
console.log(`summary: ${path.relative(repoRoot, summaryPath)}`);

if (results.some((item) => item.exitCode !== 0)) {
  process.exit(1);
}

function summarizeFixtureOutput(output) {
  const fetchStarts = countMatches(output, /\[structure-real:fetch:start\]/g);
  const fetchSuccesses = countMatches(output, /\[structure-real:fetch:response\].*status=200/g);
  const invalidJson = output.includes('Structurer provider returned invalid JSON');
  const timeout = output.includes('External structurer timeout') || output.includes('timed out');
  const rateLimit = output.includes('rate limit') || output.includes('RATE_LIMIT_ERROR');
  const assertion = output.includes('AssertionError');

  return {
    fetchStarts,
    fetchSuccesses,
    failureReason: invalidJson
      ? 'invalid_json'
      : timeout
        ? 'timeout'
        : rateLimit
          ? 'rate_limit'
          : assertion
            ? 'assertion'
            : undefined,
  };
}

function countMatches(value, pattern) {
  return Array.from(value.matchAll(pattern)).length;
}

function parseArgs(argv) {
  const parsed = {
    filter: '',
    showOutput: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (current === '--filter') {
      parsed.filter = requireValue(argv, ++index, '--filter');
    } else if (current === '--show-output') {
      parsed.showOutput = true;
    } else if (current === '--help' || current === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${current}`);
    }
  }

  return parsed;
}

function requireValue(argv, index, flag) {
  const value = argv[index];
  if (!value) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function printHelp() {
  console.log(`Run semantic structure fixtures one by one.

Usage:
  pnpm --filter extension test:structure:semantic -- [options]

Options:
  --filter <text>    Only run semantic fixtures whose name contains text
  --show-output      Print child Vitest output even for passing fixtures
  --help             Show this message
`);
}
