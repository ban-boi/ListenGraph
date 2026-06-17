/**
 * compare-structure-segments.mjs
 *
 * 对每个 replay-local-segNN-* fixture 跑两遍 structurer：
 *   Pass A — with assembler（正常模式）
 *   Pass B — without assembler（LISTEN_GRAPHIC_STRUCTURE_UNIT_ASSEMBLER_ENABLED=false）
 *
 * 两遍都启用 LISTEN_GRAPHIC_COMPARISON_WRITE_GRAPHS=1，
 * 测试文件会将 compact graph artifact 写入磁盘，
 * 本脚本再读取两个 artifact 合并为 .graphs.json artifact。
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// ─── 路径常量 ──────────────────────────────────────────────

const extensionRoot = fileURLToPath(new URL('..', import.meta.url));
const fixtureDir = path.join(extensionRoot, 'src', 'service-worker', 'fixtures', 'structure');
const compactGraphDir = path.join(fixtureDir, 'artifacts', 'segments', 'graphs');
const graphArtifactDir = path.join(
  extensionRoot,
  'src',
  'service-worker',
  'fixtures',
  'asr-realtime',
  'artifacts',
  'segments',
  'graphs',
);

// ─── CLI 参数解析 ──────────────────────────────────────────

function parseArgs(argv) {
  const parsed = {
    filter: '',
    force: false,
    skipPass: '',
    delay: 10000,
  };

  let i = 0;
  while (i < argv.length) {
    const current = argv[i];
    if (current === '--filter') {
      parsed.filter = requireValue(argv, ++i, '--filter');
    } else if (current === '--force') {
      parsed.force = true;
    } else if (current === '--skip-pass') {
      parsed.skipPass = requireValue(argv, ++i, '--skip-pass').toLowerCase();
    } else if (current === '--delay') {
      parsed.delay = Number.parseInt(requireValue(argv, ++i, '--delay'), 10);
    } else if (current === '--help' || current === '-h') {
      printHelp();
      process.exit(0);
    } else {
      console.error(`未知参数: ${current}`);
      printHelp();
      process.exit(1);
    }
    i += 1;
  }

  if (parsed.skipPass && parsed.skipPass !== 'a' && parsed.skipPass !== 'b') {
    console.error('--skip-pass 只接受 a 或 b');
    process.exit(1);
  }

  return parsed;
}

function requireValue(argv, index, flag) {
  const value = argv[index];
  if (!value) {
    console.error(`${flag} 需要一个值`);
    process.exit(1);
  }
  return value;
}

function printHelp() {
  console.log(`对 replay-local-segNN-* fixture 运行 with/without assembler 对比。

Usage:
  node scripts/compare-structure-segments.mjs [options]

Options:
  --filter <substring>   只处理名称包含该子串的 fixture
  --force                重新处理已有 graph artifact 的 fixture
  --skip-pass <a|b>      跳过某一遍（a=with-assembler, b=without-assembler）
  --delay <ms>           fixture 间隔毫秒数（默认 10000）
  --help                 显示本帮助信息

Environment:
  LISTEN_GRAPHIC_E2E_STRUCTURER_TYPE       structurer provider type（必需）
  LISTEN_GRAPHIC_E2E_STRUCTURER_API_KEY    API key（必需）
  LISTEN_GRAPHIC_E2E_STRUCTURER_TIMEOUT_MS 超时（默认 180000）
  LISTEN_GRAPHIC_E2E_STRUCTURE_DELAY_MS    fixture 间延迟
  LISTEN_GRAPHIC_E2E_STRUCTURE_ALLOW_EXTERNAL_SKIP  允许跳过（默认 0）
`);
}

// ─── Fixture 发现 ──────────────────────────────────────────

/** 扫描 replay-local-segNN-*.json fixture 文件 */
function discoverFixtures(filter) {
  return fs
    .readdirSync(fixtureDir)
    .filter((name) => name.endsWith('.json') && /^replay-local-seg\d+/u.test(name))
    .map((name) => name.replace(/\.json$/i, ''))
    .filter((name) => !filter || name.includes(filter))
    .sort();
}

// ─── Fixture 元信息提取 ────────────────────────────────────

/** 从 fixture JSON 中提取 utterance 数量和时长 */
function extractFixtureMeta(fixtureName) {
  const fixturePath = path.join(fixtureDir, `${fixtureName}.json`);
  const raw = JSON.parse(fs.readFileSync(fixturePath, 'utf-8'));
  const transcripts = Array.isArray(raw.transcripts) ? raw.transcripts : [];

  const startMsList = transcripts.map((t) => t.startMs ?? 0);
  const endMsList = transcripts.map((t) => t.endMs ?? 0);
  const durationMs = transcripts.length > 0
    ? Math.max(...endMsList) - Math.min(...startMsList)
    : 0;

  return {
    utteranceCount: transcripts.length,
    durationMs,
  };
}

// ─── 环境变量构建 ──────────────────────────────────────────

/** 构建传给 Vitest 子进程的环境变量 */
function buildBaseEnv() {
  return {
    ...process.env,
    // 启用 compact graph 输出
    LISTEN_GRAPHIC_COMPARISON_WRITE_GRAPHS: '1',
    // 使用 full profile 以包含 replay-local fixture
    LISTEN_GRAPHIC_E2E_STRUCTURE_PROFILE: 'full',
    // 透传 structurer 配置
    LISTEN_GRAPHIC_E2E_STRUCTURER_TYPE:
      process.env.LISTEN_GRAPHIC_E2E_STRUCTURER_TYPE?.trim() || '',
    LISTEN_GRAPHIC_E2E_STRUCTURER_API_KEY:
      process.env.LISTEN_GRAPHIC_E2E_STRUCTURER_API_KEY?.trim() || '',
    LISTEN_GRAPHIC_E2E_STRUCTURER_TIMEOUT_MS:
      process.env.LISTEN_GRAPHIC_E2E_STRUCTURER_TIMEOUT_MS?.trim() || '180000',
    LISTEN_GRAPHIC_E2E_STRUCTURE_DELAY_MS:
      process.env.LISTEN_GRAPHIC_E2E_STRUCTURE_DELAY_MS?.trim() || '10000',
    LISTEN_GRAPHIC_E2E_STRUCTURE_ALLOW_EXTERNAL_SKIP:
      process.env.LISTEN_GRAPHIC_E2E_STRUCTURE_ALLOW_EXTERNAL_SKIP?.trim() || '0',
  };
}

// ─── Vitest 执行 ───────────────────────────────────────────

/** 执行单次 Vitest 运行（一个 fixture、一种 assembler 模式） */
function runVitestPass(env) {
  return new Promise((resolve) => {
    const isWin = process.platform === 'win32';
    const cmd = isWin ? 'cmd.exe' : 'pnpm';
    const args = isWin
      ? ['/c', 'pnpm', 'exec', 'vitest', 'run', 'src/service-worker/structure-focused.real.test.ts']
      : ['exec', 'vitest', 'run', 'src/service-worker/structure-focused.real.test.ts'];

    const child = spawn(cmd, args, {
      cwd: extensionRoot,
      env,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const outputChunks = [];
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

    child.on('exit', (code, signal) => {
      resolve({
        exitCode: code,
        signal,
        output: outputChunks.join(''),
      });
    });
  });
}

// ─── 单 fixture 处理 ──────────────────────────────────────

/** 运行单次 structurer pass（A 或 B） */
async function runSinglePass(fixtureName, passLabel, assemblerEnabled, baseEnv) {
  const env = {
    ...baseEnv,
    LISTEN_GRAPHIC_E2E_STRUCTURE_FIXTURE: fixtureName,
  };

  env.LISTEN_GRAPHIC_STRUCTURE_UNIT_ASSEMBLER_ENABLED = assemblerEnabled ? 'true' : 'false';

  console.log(`  [Pass ${passLabel}] assembler=${assemblerEnabled} — 开始`);
  const startedAtMs = Date.now();
  const result = await runVitestPass(env);
  const durationMs = Date.now() - startedAtMs;
  console.log(
    `  [Pass ${passLabel}] assembler=${assemblerEnabled} — 完成 exitCode=${result.exitCode} durationMs=${durationMs}`,
  );

  return {
    ...result,
    durationMs,
  };
}

/** 读取 compact graph artifact 文件 */
function readCompactGraph(fixtureName, mode) {
  const filePath = path.join(compactGraphDir, `${fixtureName}.${mode}.compact-graph.json`);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

/** 构建 graph artifact 并写入磁盘 */
function writeGraphArtifact(fixtureName, graphA, graphB, meta) {
  const graphArtifact = {
    fixtureName,
    graphA: {
      assemblerEnabled: true,
      nodes: graphA?.nodes ?? [],
      edges: graphA?.edges ?? [],
      stats: graphA?.stats ?? { nodeCount: 0, edgeCount: 0 },
    },
    graphB: {
      assemblerEnabled: false,
      nodes: graphB?.nodes ?? [],
      edges: graphB?.edges ?? [],
      stats: graphB?.stats ?? { nodeCount: 0, edgeCount: 0 },
    },
    originalUtteranceCount: meta.utteranceCount,
    durationMs: meta.durationMs,
    generatedAt: new Date().toISOString(),
  };

  fs.mkdirSync(graphArtifactDir, { recursive: true });

  const outputPath = path.join(graphArtifactDir, `${fixtureName}.graphs.json`);
  fs.writeFileSync(outputPath, `${JSON.stringify(graphArtifact, null, 2)}\n`);

  return graphArtifact;
}

/** 检查 graph artifact 是否已存在 */
function graphArtifactExists(fixtureName) {
  return (
    fs.existsSync(path.join(graphArtifactDir, `${fixtureName}.graphs.json`)) ||
    fs.existsSync(path.join(graphArtifactDir, `${fixtureName}.combined-graph.json`))
  );
}

// ─── 主流程 ────────────────────────────────────────────────

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const fixtureNames = discoverFixtures(options.filter);

  if (fixtureNames.length === 0) {
    console.error(
      options.filter
        ? `没有找到匹配 "${options.filter}" 的 replay-local-segNN-* fixture`
        : '没有找到 replay-local-segNN-* fixture',
    );
    process.exit(1);
  }

  // 检查必需的环境变量
  if (!process.env.LISTEN_GRAPHIC_E2E_STRUCTURER_TYPE) {
    console.error('缺少环境变量 LISTEN_GRAPHIC_E2E_STRUCTURER_TYPE（structurer provider type）');
    process.exit(1);
  }

  console.log(`=== Structure Segment Comparison ===`);
  console.log(`发现 ${fixtureNames.length} 个 fixture`);
  console.log(`skip-pass=${options.skipPass || '无'} force=${options.force} delay=${options.delay}`);
  console.log('');

  const baseEnv = buildBaseEnv();
  const summary = {
    startedAt: new Date().toISOString(),
    finishedAt: '',
    totalFixtures: fixtureNames.length,
    skipped: 0,
    succeeded: 0,
    failed: 0,
    results: [],
  };

  for (const fixtureName of fixtureNames) {
    // Resume 支持：如果已有 graph artifact 且非 --force，跳过
    if (!options.force && graphArtifactExists(fixtureName)) {
      console.log(`[跳过] ${fixtureName} — graph artifact 已存在`);
      summary.skipped += 1;
      continue;
    }

    console.log(`\n=== 处理 fixture: ${fixtureName} ===`);
    const fixtureResult = {
      fixtureName,
      passA: null,
      passB: null,
      status: 'pending',
    };

    const meta = extractFixtureMeta(fixtureName);
    let passAResult = null;
    let passBResult = null;

    // Pass A: with assembler
    if (options.skipPass !== 'a') {
      passAResult = await runSinglePass(fixtureName, 'A', true, baseEnv);
      fixtureResult.passA = {
        exitCode: passAResult.exitCode,
        durationMs: passAResult.durationMs,
      };
    } else {
      console.log('  [Pass A] 已跳过（--skip-pass a）');
    }

    // Pass B: without assembler
    if (options.skipPass !== 'b') {
      passBResult = await runSinglePass(fixtureName, 'B', false, baseEnv);
      fixtureResult.passB = {
        exitCode: passBResult.exitCode,
        durationMs: passBResult.durationMs,
      };
    } else {
      console.log('  [Pass B] 已跳过（--skip-pass b）');
    }

    // 读取 compact graph artifacts
    const graphA = options.skipPass !== 'a' ? readCompactGraph(fixtureName, 'with-assembler') : null;
    const graphB = options.skipPass !== 'b' ? readCompactGraph(fixtureName, 'no-assembler') : null;

    // 检查是否两个 pass 都成功（或被跳过）
    const passASuccess = options.skipPass === 'a' || passAResult?.exitCode === 0;
    const passBSuccess = options.skipPass === 'b' || passBResult?.exitCode === 0;

    if (passASuccess && passBSuccess && (graphA || graphB)) {
      const graphArtifact = writeGraphArtifact(fixtureName, graphA, graphB, meta);
      fixtureResult.status = 'succeeded';
      summary.succeeded += 1;
      console.log(
        `  完成: nodes A=${graphArtifact.graphA.stats.nodeCount} B=${graphArtifact.graphB.stats.nodeCount}, ` +
        `edges A=${graphArtifact.graphA.stats.edgeCount} B=${graphArtifact.graphB.stats.edgeCount}`,
      );
    } else {
      fixtureResult.status = 'failed';
      summary.failed += 1;
      const reasons = [];
      if (!passASuccess) reasons.push('Pass A 失败');
      if (!passBSuccess) reasons.push('Pass B 失败');
      if (!graphA && options.skipPass !== 'a') reasons.push('未找到 graphA artifact');
      if (!graphB && options.skipPass !== 'b') reasons.push('未找到 graphB artifact');
      console.warn(`  失败: ${reasons.join(', ')}`);
    }

    summary.results.push(fixtureResult);

    // fixture 间延迟
    if (options.delay > 0 && fixtureName !== fixtureNames[fixtureNames.length - 1]) {
      console.log(`  等待 ${options.delay}ms...`);
      await new Promise((resolve) => setTimeout(resolve, options.delay));
    }
  }

  summary.finishedAt = new Date().toISOString();

  // 写入汇总报告
  const reportPath = path.join(
    graphArtifactDir,
    `compare-summary-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
  );
  fs.mkdirSync(graphArtifactDir, { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(summary, null, 2)}\n`);

  // 打印汇总
  console.log('\n=== 汇总 ===');
  console.log(`总计: ${summary.totalFixtures} 个 fixture`);
  console.log(`成功: ${summary.succeeded}`);
  console.log(`失败: ${summary.failed}`);
  console.log(`跳过: ${summary.skipped}`);
  console.log(`报告: ${reportPath}`);

  process.exit(summary.failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('未预期的错误:', err);
  process.exit(1);
});
