# Assembler 回放对照测试 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在同一批 8 条 replay-realtime fixture 上分别跑 with-assembler 和 no-assembler 两条路径，对比 scheduling 指标（调用次数、首图延迟、utterances/commit）和输出质量指标（emptyOutputRatio、nodes/edges 数量），以量化 assembler 的效果。

**Architecture:** 分两层实现。第一层是离线 scheduling 对比——修改现有 KPI 脚本，增加 no-assembler 分析函数，输出 side-by-side 对比报告。第二层是真实 structurer 输出对比——让 `STRUCTURE_UNIT_ASSEMBLER_ENABLED` 可通过环境变量控制，修改 strict replay 脚本支持 `--no-assembler` 模式，创建对比编排脚本收集两边 artifact 后输出差异报告。两层互不依赖，可以分期交付。

**Tech Stack:** Node.js (ESM), 复用现有 `report-structure-unit-ws-kpis.mjs`、`run-structure-replay-strict.mjs` 脚本框架

---

## 文件结构

| 文件 | 操作 | 职责 |
|------|------|------|
| `apps/extension/scripts/report-structure-unit-ws-kpis.mjs` | 修改 | 新增 `analyzeFixtureNoAssembler()` 函数；新增 `--compare` 模式输出 side-by-side 对比 |
| `apps/extension/src/service-worker/index.ts:179` | 修改 | `STRUCTURE_UNIT_ASSEMBLER_ENABLED` 改为从 `LISTEN_GRAPHIC_STRUCTURE_UNIT_ASSEMBLER_ENABLED` 环境变量读取 |
| `apps/extension/scripts/run-structure-replay-strict.mjs` | 修改 | 支持 `--no-assembler` flag，传环境变量给 vitest 子进程 |
| `apps/extension/scripts/compare-assembler-baseline.mjs` | 创建 | 编排器：先跑 with-assembler strict replay → 再跑 no-assembler strict replay → 读取双方 diagnostic artifact → 输出对比报告 |
| `apps/extension/package.json` | 修改 | 新增 `test:structure:ws:kpi:compare` 和 `test:structure:compare:baseline` 命令 |

---

### Task 1: KPI 脚本—提取 no-assembler 分析函数

**Files:**
- Modify: `apps/extension/scripts/report-structure-unit-ws-kpis.mjs`

**背景：** 当前 `analyzeFixture()` 函数硬编码了 assembler 决策流程。需要增加一个 `analyzeFixtureNoAssembler()` 函数，模拟"没有 assembler 时每条非低信息 utterance 直接提交"的行为。

**no-assembler 基线逻辑：**
1. 低信息 utterance → skip（与 with-assembler 相同，这是 transcript 级别的过滤，不是 assembler 做的）
2. 未达到 bootstrap 上下文 → wait（与 with-assembler 相同，这是 structurer 的前提条件，不是 assembler 做的）
3. 输入结束（`input_finished` / `manual_flush`）且未出过图 → 强制 commit
4. 其余每条非低信息 utterance → **立即 commit**

- [ ] **Step 1: 在 KPI 脚本中新增 `analyzeFixtureNoAssembler()` 函数**

在 `analyzeFixture()` 函数后面（第 170 行之后）添加：

```javascript
function analyzeFixtureNoAssembler(fixtureName) {
  const fixturePath = path.join(fixtureDir, `${fixtureName}.json`);
  const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf-8'));
  const transcripts = (fixture.transcripts ?? []).map((t) => ({
    chunkId: t.chunkId,
    text: t.text,
    startMs: t.startMs,
    endMs: t.endMs,
    finalReason: t.finalReason ?? 'endpoint',
  }));

  const state = {
    transcriptWindow: [],
    mergedGraph: false,
    commitEvents: [],
    assemblerRuns: [],
    lowInfoSkips: 0,
    waitSkips: 0,
  };

  for (const transcript of transcripts) {
    state.transcriptWindow.push(transcript);

    // 低信息跳过（与 assembler 无关的 transcript 级过滤）
    if (isLowInformationTranscript(transcript)) {
      state.lowInfoSkips += 1;
      state.assemblerRuns.push({
        transcriptId: transcript.chunkId,
        decision: 'skip_current',
        reason: 'skip_low_information',
      });
      continue;
    }

    // 未出图时的 bootstrap 上下文检查
    if (!state.mergedGraph) {
      const forceBootstrap =
        (transcript.finalReason === 'input_finished' || transcript.finalReason === 'manual_flush') &&
        getEffectiveTranscriptWindowCharCount(state.transcriptWindow) > 0;

      if (!forceBootstrap && !hasEnoughRealtimeBootstrapContext(state.transcriptWindow)) {
        state.waitSkips += 1;
        state.assemblerRuns.push({
          transcriptId: transcript.chunkId,
          decision: 'wait',
          reason: 'wait_bootstrap_context',
        });
        continue;
      }
    }

    // 其余每条非低信息 utterance → 立即 commit
    state.assemblerRuns.push({
      transcriptId: transcript.chunkId,
      decision: 'commit',
      reason: transcript.finalReason === 'input_finished' || transcript.finalReason === 'manual_flush'
        ? 'commit_force_flush'
        : 'commit_immediate',
    });

    state.commitEvents.push({
      transcriptId: transcript.chunkId,
      endMs: transcript.endMs,
      utteranceCount: 1,
      effectiveCharCount: getEffectiveTranscriptCharCount(transcript),
      reason: transcript.finalReason === 'input_finished' || transcript.finalReason === 'manual_flush'
        ? 'commit_force_flush'
        : 'commit_immediate',
    });
    state.mergedGraph = true;
  }

  const sessionStartMs = transcripts[0]?.startMs ?? 0;
  const sessionEndMs = transcripts[transcripts.length - 1]?.endMs ?? 0;
  const durationMs = Math.max(0, sessionEndMs - sessionStartMs);
  const commitCount = state.commitEvents.length;
  const emptyOutputStats = loadEmptyOutputStats(fixtureName);
  const firstGraphLatencyMs =
    state.commitEvents[0] != null ? Math.max(0, state.commitEvents[0].endMs - sessionStartMs) : null;
  const structurerCallsPerMinute =
    durationMs > 0 ? Number(((commitCount / durationMs) * 60_000).toFixed(2)) : 0;
  const avgUtterancesPerCommit =
    commitCount > 0
      ? Number(
          (state.commitEvents.reduce((sum, e) => sum + e.utteranceCount, 0) / commitCount).toFixed(2),
        )
      : 0;

  return {
    fixtureName,
    transcriptCount: transcripts.length,
    durationMs,
    commitCount,
    firstGraphLatencyMs,
    structurerCallsPerMinute,
    lowInfoSkips: state.lowInfoSkips,
    avgUtterancesPerCommit,
    ...emptyOutputStats,
    commitReasons: summarizeReasons(state.commitEvents),
  };
}
```

- [ ] **Step 2: 运行 KPI 脚本验证 no-assembler 函数能正常输出**

```bash
cd apps/extension && node ./scripts/report-structure-unit-ws-kpis.mjs --json 2>&1 | head -50
```

手动在 Node.js REPL 中调用 `analyzeFixtureNoAssembler()` 验证一条 fixture 的结果（可以在脚本中临时加一行 `console.log(JSON.stringify(analyzeFixtureNoAssembler(fixtureNames[0]), null, 2)); process.exit(0);` 放在 `main()` 开头）。

预期：no-assembler 模式比 with-assembler 的 `commitCount` 高（每个 utterance 都 commit），`avgUtterancesPerCommit` 为 1.0，`firstGraphLatencyMs` 在 bootstrap 上下文满足后才出现。

- [ ] **Step 3: 提交**

```bash
git add apps/extension/scripts/report-structure-unit-ws-kpis.mjs
git commit -m "feat: KPI 脚本新增 no-assembler 基线分析函数"
```

---

### Task 2: KPI 脚本—增加 `--compare` 模式

**Files:**
- Modify: `apps/extension/scripts/report-structure-unit-ws-kpis.mjs`

**背景：** `main()` 函数当前只跑 with-assembler 分析。需要增加 `--compare` flag，同时跑两条路径并输出 side-by-side 对比。

- [ ] **Step 1: 修改 `main()` 支持 `--compare`**

将 `main()` 函数替换为：

```javascript
function main() {
  const fixtureNames = discoverFixtureNames();
  const compareMode = process.argv.includes('--compare');
  const jsonMode = process.argv.includes('--json');

  if (!compareMode) {
    const results = fixtureNames.map((name) => analyzeFixture(name));
    const summary = buildSummary(results);
    const report = {
      generatedAt: new Date().toISOString(),
      fixtureCount: results.length,
      summary,
      fixtures: results,
      notes: [
        'This report uses the current programmatic assembler heuristics offline against replay-realtime fixtures.',
        'It reports deterministic scheduling KPIs only; empty-output ratio still requires real structurer replay/debug artifacts.',
        'Use --compare for side-by-side with/without assembler comparison.',
      ],
    };
    if (jsonMode) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    } else {
      printHumanReport(report);
    }
    return;
  }

  // --compare 模式：跑两遍，输出对比
  const withResults = fixtureNames.map((name) => analyzeFixture(name));
  const withoutResults = fixtureNames.map((name) => analyzeFixtureNoAssembler(name));
  const withSummary = buildSummary(withResults);
  const withoutSummary = buildSummary(withoutResults);

  const comparisonReport = {
    generatedAt: new Date().toISOString(),
    fixtureCount: fixtureNames.length,
    withAssembler: { summary: withSummary, fixtures: withResults },
    noAssembler: { summary: withoutSummary, fixtures: withoutResults },
    comparison: buildComparison(withResults, withoutResults),
  };

  if (jsonMode) {
    process.stdout.write(`${JSON.stringify(comparisonReport, null, 2)}\n`);
  } else {
    printCompareReport(comparisonReport);
  }
}
```

- [ ] **Step 2: 新增 `buildComparison()` 和 `printCompareReport()` 函数**

在所有现有函数之后添加：

```javascript
function buildComparison(withResults, withoutResults) {
  const withFirstLatency = withResults
    .map((r) => r.firstGraphLatencyMs)
    .filter((v) => typeof v === 'number');
  const withoutFirstLatency = withoutResults
    .map((r) => r.firstGraphLatencyMs)
    .filter((v) => typeof v === 'number');

  return {
    firstGraphLatencyMs: {
      withAssembler: summarizeDistribution(withFirstLatency),
      noAssembler: summarizeDistribution(withoutFirstLatency),
    },
    averageStructurerCallsPerMinute: {
      withAssembler: withResults.length > 0
        ? Number((withResults.reduce((s, r) => s + r.structurerCallsPerMinute, 0) / withResults.length).toFixed(2))
        : 0,
      noAssembler: withoutResults.length > 0
        ? Number((withoutResults.reduce((s, r) => s + r.structurerCallsPerMinute, 0) / withoutResults.length).toFixed(2))
        : 0,
    },
    totalCommitCount: {
      withAssembler: withResults.reduce((s, r) => s + r.commitCount, 0),
      noAssembler: withoutResults.reduce((s, r) => s + r.commitCount, 0),
    },
    averageUtterancesPerCommit: {
      withAssembler: withResults.length > 0
        ? Number((withResults.reduce((s, r) => s + r.avgUtterancesPerCommit, 0) / withResults.length).toFixed(2))
        : 0,
      noAssembler: withoutResults.length > 0
        ? Number((withoutResults.reduce((s, r) => s + r.avgUtterancesPerCommit, 0) / withoutResults.length).toFixed(2))
        : 0,
    },
    emptyOutputRatio: {
      withAssembler: summarizeEmptyOutputRatio(withResults),
      noAssembler: summarizeEmptyOutputRatio(withoutResults),
    },
    averageLowInfoSkips: {
      withAssembler: withResults.length > 0
        ? Number((withResults.reduce((s, r) => s + r.lowInfoSkips, 0) / withResults.length).toFixed(2))
        : 0,
      noAssembler: withoutResults.length > 0
        ? Number((withoutResults.reduce((s, r) => s + r.lowInfoSkips, 0) / withoutResults.length).toFixed(2))
        : 0,
    },
  };
}

function printCompareReport(report) {
  const c = report.comparison;
  const fmtLatency = (d) => (d == null ? 'n/a' : `${d.p50} / ${d.p95} / ${d.max}`);
  const fmtRatio = (v) => (v == null ? 'n/a' : String(v));

  console.log(`Assembler 回放对照测试 (${report.fixtureCount} fixtures)`);
  console.log(`Generated at: ${report.generatedAt}`);
  console.log('');
  console.log('┌─────────────────────────────────────────┬───────────────┬───────────────┐');
  console.log('│ Metric                                  │ With Assembler│ No Assembler  │');
  console.log('├─────────────────────────────────────────┼───────────────┼───────────────┤');
  console.log(`│ firstGraphLatencyMs p50/p95/max         │ ${String(fmtLatency(c.firstGraphLatencyMs.withAssembler)).padEnd(13)} │ ${String(fmtLatency(c.firstGraphLatencyMs.noAssembler)).padEnd(13)} │`);
  console.log(`│ avg structurer calls/min                │ ${String(c.averageStructurerCallsPerMinute.withAssembler).padEnd(13)} │ ${String(c.averageStructurerCallsPerMinute.noAssembler).padEnd(13)} │`);
  console.log(`│ total commit count                      │ ${String(c.totalCommitCount.withAssembler).padEnd(13)} │ ${String(c.totalCommitCount.noAssembler).padEnd(13)} │`);
  console.log(`│ avg utterances/commit                   │ ${String(c.averageUtterancesPerCommit.withAssembler).padEnd(13)} │ ${String(c.averageUtterancesPerCommit.noAssembler).padEnd(13)} │`);
  console.log(`│ empty output ratio                      │ ${String(fmtRatio(c.emptyOutputRatio.withAssembler)).padEnd(13)} │ ${String(fmtRatio(c.emptyOutputRatio.noAssembler)).padEnd(13)} │`);
  console.log(`│ avg low-info skips                      │ ${String(c.averageLowInfoSkips.withAssembler).padEnd(13)} │ ${String(c.averageLowInfoSkips.noAssembler).padEnd(13)} │`);
  console.log('└─────────────────────────────────────────┴───────────────┴───────────────┘');
  console.log('');
  console.log('Per-fixture detail:');
  for (let i = 0; i < report.withAssembler.fixtures.length; i++) {
    const w = report.withAssembler.fixtures[i];
    const n = report.noAssembler.fixtures[i];
    console.log(`  ${w.fixtureName}:`);
    console.log(`    commits:       with=${w.commitCount}  without=${n.commitCount}`);
    console.log(`    calls/min:     with=${w.structurerCallsPerMinute}  without=${n.structurerCallsPerMinute}`);
    console.log(`    firstGraphMs:  with=${formatNullable(w.firstGraphLatencyMs)}  without=${formatNullable(n.firstGraphLatencyMs)}`);
    console.log(`    utt/commit:    with=${w.avgUtterancesPerCommit}  without=${n.avgUtterancesPerCommit}`);
  }
}
```

- [ ] **Step 3: 运行 `--compare` 验证输出格式**

```bash
cd apps/extension && node ./scripts/report-structure-unit-ws-kpis.mjs --compare
```

预期输出对比表格，no-assembler 的 `totalCommitCount` 显著高于 with-assembler，`avgUtterancesPerCommit` 为 1.0。

- [ ] **Step 4: 添加 npm script 并在 package.json 中注册**

在 `apps/extension/package.json` 的 scripts 中添加：

```json
"test:structure:ws:kpi:compare": "node ./scripts/report-structure-unit-ws-kpis.mjs --compare"
```

- [ ] **Step 5: 提交**

```bash
git add apps/extension/scripts/report-structure-unit-ws-kpis.mjs apps/extension/package.json
git commit -m "feat: KPI 脚本新增 --compare 模式，输出 with/without assembler 对比报告"
```

---

### Task 3: 使 STRUCTURE_UNIT_ASSEMBLER_ENABLED 可通过环境变量控制

**Files:**
- Modify: `apps/extension/src/service-worker/index.ts:179`

**背景：** 当前 `STRUCTURE_UNIT_ASSEMBLER_ENABLED` 是一个硬编码常量。为了让 strict replay 能在 no-assembler 模式下运行真实的 structurer 调用，需要使其可从环境变量控制。`index.test.ts` 中已有 assembler 相关测试，此改动会影响这些测试——需要验证默认行为不变。

- [ ] **Step 1: 修改常量定义**

将第 179 行：

```typescript
const STRUCTURE_UNIT_ASSEMBLER_ENABLED = true;
```

改为：

```typescript
const STRUCTURE_UNIT_ASSEMBLER_ENABLED =
  typeof process !== 'undefined' && process.env?.LISTEN_GRAPHIC_STRUCTURE_UNIT_ASSEMBLER_ENABLED != null
    ? process.env.LISTEN_GRAPHIC_STRUCTURE_UNIT_ASSEMBLER_ENABLED === 'true'
    : true;
```

在 Node.js 测试环境（vitest）下，`process.env` 可用；在浏览器扩展环境（service worker）下不设置此变量，默认 `true`。

- [ ] **Step 2: 运行现有 mock 测试确认默认行为不变**

```bash
cd apps/extension && pnpm test:structure:mock 2>&1 | tail -20
```

预期：全部 structure-focused 测试通过。特别是 "ws 调试会话会暴露 assembler 运行与 structure unit" 测试应通过，因为它依赖 `STRUCTURE_UNIT_ASSEMBLER_ENABLED = true`。

- [ ] **Step 3: 添加 env var 关闭 assembler 的测试用例**

在 `apps/extension/src/service-worker/index.test.ts` 中（assembler 相关测试附近，约第 1420 行之后），新增一个测试：

```typescript
it('LISTEN_GRAPHIC_STRUCTURE_UNIT_ASSEMBLER_ENABLED=false 时会跳过 assembler 直接走旧路径', async () => {
  const original = process.env.LISTEN_GRAPHIC_STRUCTURE_UNIT_ASSEMBLER_ENABLED;
  process.env.LISTEN_GRAPHIC_STRUCTURE_UNIT_ASSEMBLER_ENABLED = 'false';

  try {
    // 需要重新 import 模块以让新常量生效
    // 这要求在 vitest 中做模块隔离：vi.resetModules()

    vi.resetModules();

    const { sendMessage } = await import('../src/service-worker/index.js');

    // ... 发送一条 utterance，验证走的是旧路径（没有 assemblerRuns）
    // （此测试的具体实现取决于 index.ts 的模块结构）
  } finally {
    process.env.LISTEN_GRAPHIC_STRUCTURE_UNIT_ASSEMBLER_ENABLED = original;
  }
});
```

**注意：** 如果 `vi.resetModules()` 会影响到其他测试，则需要将此测试放在独立的测试文件中。先尝试 `vi.resetModules()` 方案；如果不行，改为在 `vitest.workspace` 中创建独立 project。

- [ ] **Step 4: 运行测试确认全部通过**

```bash
cd apps/extension && pnpm test:run 2>&1 | tail -20
```

- [ ] **Step 5: 提交**

```bash
git add apps/extension/src/service-worker/index.ts apps/extension/src/service-worker/index.test.ts
git commit -m "feat: STRUCTURE_UNIT_ASSEMBLER_ENABLED 支持环境变量控制"
```

---

### Task 4: Strict Replay 支持 `--no-assembler` + 创建对比编排脚本

**Files:**
- Modify: `apps/extension/scripts/run-structure-replay-strict.mjs`
- Create: `apps/extension/scripts/compare-assembler-baseline.mjs`
- Modify: `apps/extension/package.json`

**背景：** 当 KPI 离线对比完成后（Task 1-2），需要做真实 structurer 的对比来比较 emptyOutputRatio 和最终图谱质量。strict replay 脚本当前 spawn vitest 子进程运行真实结构器。需要让它支持 `--no-assembler` flag，以及创建一个编排脚本自动跑两轮并对比 diagnostic artifact。

- [ ] **Step 1: 修改 `run-structure-replay-strict.mjs` 支持 `--no-assembler`**

在 `baseEnv` 之后、主循环之前添加：

```javascript
const noAssembler = process.argv.includes('--no-assembler');
if (noAssembler) {
  baseEnv.LISTEN_GRAPHIC_STRUCTURE_UNIT_ASSEMBLER_ENABLED = 'false';
}

const modeLabel = noAssembler ? 'no-assembler' : 'with-assembler';
console.log(`[strict-replay] mode: ${modeLabel}`);
```

在 `overallSummary` 对象中增加 mode 字段：

```javascript
const overallSummary = {
  startedAt: new Date().toISOString(),
  finishedAt: '',
  strict: baseEnv.LISTEN_GRAPHIC_E2E_STRUCTURE_ALLOW_EXTERNAL_SKIP === '0',
  fixtureCount: fixtureNames.length,
  mode: modeLabel,
  results: [],
};
```

- [ ] **Step 2: 创建 `compare-assembler-baseline.mjs`**

新建文件 `apps/extension/scripts/compare-assembler-baseline.mjs`：

```javascript
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const extensionRoot = fileURLToPath(new URL('..', import.meta.url));
const artifactDir = path.join(
  extensionRoot, 'src', 'service-worker', 'fixtures', 'structure', 'artifacts', 'provider-instability',
);
const compareArtifactDir = path.join(artifactDir, 'assembler-comparison');

function runReplay(label, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.platform === 'win32' ? 'cmd.exe' : 'node',
      process.platform === 'win32'
        ? ['/c', 'node', './scripts/run-structure-replay-strict.mjs', ...args]
        : ['./scripts/run-structure-replay-strict.mjs', ...args],
      { cwd: extensionRoot, stdio: 'inherit' },
    );
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${label} replay exited with code ${code}`));
    });
  });
}

async function main() {
  console.log('=== Assembler Baseline Comparison ===');
  console.log('');

  // Step 1: Run with-assembler replay
  console.log('>>> Step 1/3: Running WITH assembler strict replay...');
  await runReplay('with-assembler');

  // Snapshot artifacts from with-assembler run
  const withSnapshots = snapshotArtifacts('with-assembler');

  // Step 2: Run no-assembler replay
  console.log('');
  console.log('>>> Step 2/3: Running NO assembler strict replay...');
  await runReplay('no-assembler', ['--no-assembler']);

  // Snapshot artifacts from no-assembler run
  const withoutSnapshots = snapshotArtifacts('no-assembler');

  // Step 3: Generate comparison report
  console.log('');
  console.log('>>> Step 3/3: Generating comparison report...');
  const report = buildComparisonReport(withSnapshots, withoutSnapshots);

  fs.mkdirSync(compareArtifactDir, { recursive: true });
  const reportPath = path.join(
    compareArtifactDir,
    `comparison-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
  );
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`Report saved to: ${reportPath}`);

  printComparisonReport(report);
}

function snapshotArtifacts(label) {
  const fixtures = fs.readdirSync(artifactDir)
    .filter((f) => f.endsWith('.diagnostic.json'))
    .map((f) => {
      const filePath = path.join(artifactDir, f);
      const stat = fs.statSync(filePath);
      return { name: f, path: filePath, mtimeMs: stat.mtimeMs };
    });

  return fixtures.map((f) => {
    const artifact = JSON.parse(fs.readFileSync(f.path, 'utf-8'));
    return {
      fixtureName: f.name.replace(/\.attempt-\d+\.diagnostic\.json$/, ''),
      ...extractGraphMetrics(artifact),
    };
  });
}

function extractGraphMetrics(artifact) {
  const traces = Array.isArray(artifact.fetchTraces) ? artifact.fetchTraces : [];
  const parsedOutputs = traces
    .map((t) => {
      try {
        if (typeof t?.responseBody !== 'string' || !t.responseBody.trim()) return null;
        const resp = JSON.parse(t.responseBody);
        const content = resp?.choices?.[0]?.message?.content;
        if (typeof content !== 'string') return null;
        const start = content.indexOf('{');
        const end = content.lastIndexOf('}');
        if (start < 0 || end <= start) return null;
        const parsed = JSON.parse(content.slice(start, end + 1));
        return { nodes: Array.isArray(parsed.nodes) ? parsed.nodes : [], edges: Array.isArray(parsed.edges) ? parsed.edges : [] };
      } catch { return null; }
    })
    .filter(Boolean);

  const emptyCount = parsedOutputs.filter((o) => o.nodes.length === 0 && o.edges.length === 0).length;
  const totalNodes = parsedOutputs.reduce((s, o) => s + o.nodes.length, 0);
  const totalEdges = parsedOutputs.reduce((s, o) => s + o.edges.length, 0);

  return {
    structurerCalls: parsedOutputs.length,
    emptyOutputCount: emptyCount,
    emptyOutputRatio: parsedOutputs.length > 0 ? Number((emptyCount / parsedOutputs.length).toFixed(3)) : null,
    totalNodes,
    totalEdges,
    avgNodesPerCall: parsedOutputs.length > 0 ? Number((totalNodes / parsedOutputs.length).toFixed(2)) : 0,
    avgEdgesPerCall: parsedOutputs.length > 0 ? Number((totalEdges / parsedOutputs.length).toFixed(2)) : 0,
  };
}

function buildComparisonReport(withData, withoutData) {
  const fixtures = [...new Set([...withData.map((d) => d.fixtureName), ...withoutData.map((d) => d.fixtureName)])].sort();
  const perFixture = fixtures.map((name) => {
    const w = withData.find((d) => d.fixtureName === name) || null;
    const n = withoutData.find((d) => d.fixtureName === name) || null;
    return {
      fixtureName: name,
      withAssembler: w ? { ...w, fixtureName: undefined } : null,
      noAssembler: n ? { ...n, fixtureName: undefined } : null,
    };
  });

  const withTotals = aggregateMetrics(withData);
  const withoutTotals = aggregateMetrics(withoutData);

  return {
    generatedAt: new Date().toISOString(),
    perFixture,
    summary: { withAssembler: withTotals, noAssembler: withoutTotals },
  };
}

function aggregateMetrics(data) {
  return {
    totalStructurerCalls: data.reduce((s, d) => s + d.structurerCalls, 0),
    totalEmptyOutputs: data.reduce((s, d) => s + d.emptyOutputCount, 0),
    emptyOutputRatio: data.reduce((s, d) => s + d.structurerCalls, 0) > 0
      ? Number((data.reduce((s, d) => s + d.emptyOutputCount, 0) / data.reduce((s, d) => s + d.structurerCalls, 0)).toFixed(3))
      : null,
    totalNodes: data.reduce((s, d) => s + d.totalNodes, 0),
    totalEdges: data.reduce((s, d) => s + d.totalEdges, 0),
    avgNodesPerCall: data.reduce((s, d) => s + d.structurerCalls, 0) > 0
      ? Number((data.reduce((s, d) => s + d.totalNodes, 0) / data.reduce((s, d) => s + d.structurerCalls, 0)).toFixed(2))
      : 0,
  };
}

function printComparisonReport(report) {
  console.log('');
  console.log('=== Comparison Report ===');
  const s = report.summary;
  console.log('┌──────────────────────────────────┬───────────────┬───────────────┐');
  console.log('│ Metric                           │ With Assembler│ No Assembler  │');
  console.log('├──────────────────────────────────┼───────────────┼───────────────┤');
  console.log(`│ total structurer calls           │ ${String(s.withAssembler.totalStructurerCalls).padEnd(13)} │ ${String(s.noAssembler.totalStructurerCalls).padEnd(13)} │`);
  console.log(`│ total empty outputs              │ ${String(s.withAssembler.totalEmptyOutputs).padEnd(13)} │ ${String(s.noAssembler.totalEmptyOutputs).padEnd(13)} │`);
  console.log(`│ empty output ratio               │ ${String(formatRatio(s.withAssembler.emptyOutputRatio)).padEnd(13)} │ ${String(formatRatio(s.noAssembler.emptyOutputRatio)).padEnd(13)} │`);
  console.log(`│ total nodes generated            │ ${String(s.withAssembler.totalNodes).padEnd(13)} │ ${String(s.noAssembler.totalNodes).padEnd(13)} │`);
  console.log(`│ total edges generated            │ ${String(s.withAssembler.totalEdges).padEnd(13)} │ ${String(s.noAssembler.totalEdges).padEnd(13)} │`);
  console.log(`│ avg nodes per call               │ ${String(s.withAssembler.avgNodesPerCall).padEnd(13)} │ ${String(s.noAssembler.avgNodesPerCall).padEnd(13)} │`);
  console.log('└──────────────────────────────────┴───────────────┴───────────────┘');
}

function formatRatio(v) {
  return v == null ? 'n/a' : String(v);
}

main().catch((err) => { console.error(err); process.exit(1); });
```

- [ ] **Step 3: 添加 npm scripts**

在 `apps/extension/package.json` 的 scripts 中添加：

```json
"test:structure:replay:no-assembler": "node ./scripts/run-structure-replay-strict.mjs --no-assembler",
"test:structure:compare:baseline": "node ./scripts/compare-assembler-baseline.mjs"
```

- [ ] **Step 4: 提交**

```bash
git add apps/extension/scripts/run-structure-replay-strict.mjs apps/extension/scripts/compare-assembler-baseline.mjs apps/extension/package.json
git commit -m "feat: 新增 assembler baseline 回放对照脚本"
```

---

## 验证清单

完成所有 task 后的端到端验证：

1. **离线 KPI 对照**
   ```bash
   cd apps/extension
   pnpm test:structure:ws:kpi        # with-assembler only（原有功能不受影响）
   pnpm test:structure:ws:kpi:compare # 新增：side-by-side 对比
   ```

2. **mock 测试全量通过**
   ```bash
   pnpm test:run  # 确认 env var 改动不影响测试
   ```

3. **真实 structurer 对照**（需要 API key 环境变量）
   ```bash
   pnpm test:structure:compare:baseline  # 自动跑两轮 + 输出对比报告
   ```

4. **报告输出位置**
   - 离线对比：stdout 表格
   - 真实对照：`fixtures/structure/artifacts/provider-instability/assembler-comparison/comparison-*.json`
