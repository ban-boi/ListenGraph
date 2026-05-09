import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const extensionRoot = fileURLToPath(new URL('..', import.meta.url));
const fixtureDir = path.join(extensionRoot, 'src', 'service-worker', 'fixtures', 'structure');
const withAssemblerArtifactDir = path.join(fixtureDir, 'artifacts', 'provider-instability');
const noAssemblerArtifactDir = path.join(withAssemblerArtifactDir, 'no-assembler');
const compareReportDir = path.join(withAssemblerArtifactDir, 'assembler-comparison');

function discoverFixtureNames() {
  return fs
    .readdirSync(fixtureDir)
    .filter((name) => name.endsWith('.json') && name.startsWith('replay-realtime-'))
    .map((name) => name.replace(/\.json$/i, ''))
    .sort();
}

function runReplay(args = []) {
  return new Promise((resolve, reject) => {
    const cmd = process.platform === 'win32' ? 'cmd.exe' : 'node';
    const cmdArgs = process.platform === 'win32'
      ? ['/c', 'node', './scripts/run-structure-replay-strict.mjs', ...args]
      : ['node', './scripts/run-structure-replay-strict.mjs', ...args];
    const child = spawn(cmd, cmdArgs, { cwd: extensionRoot, stdio: 'inherit' });
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`replay exited with code ${code}`));
    });
  });
}

function findLatestDiagnostic(dir, fixtureName) {
  if (!fs.existsSync(dir)) return null;

  const candidates = fs
    .readdirSync(dir)
    .filter(
      (name) =>
        name.startsWith(`${fixtureName}.attempt-`) &&
        name.endsWith('.diagnostic.json'),
    )
    .map((name) => ({
      name,
      path: path.join(dir, name),
      attempt: Number.parseInt(name.match(/\.attempt-(\d+)\./)?.[1] ?? '0', 10),
    }))
    .sort((a, b) => b.attempt - a.attempt);

  return candidates[0] ?? null;
}

function extractGraphMetrics(filePath) {
  try {
    const artifact = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const traces = Array.isArray(artifact.fetchTraces) ? artifact.fetchTraces : [];
    const parsedOutputs = [];

    for (const t of traces) {
      try {
        if (typeof t?.responseBody !== 'string' || !t.responseBody.trim()) continue;

        let graphJson = null;

        // 路径 1：完整 JSON — 直接解析
        try {
          const resp = JSON.parse(t.responseBody);
          const content = resp?.choices?.[0]?.message?.content;
          if (typeof content === 'string') {
            const start = content.indexOf('{');
            const end = content.lastIndexOf('}');
            if (start >= 0 && end > start) {
              graphJson = JSON.parse(content.slice(start, end + 1));
            }
          }
        } catch {
          // 路径 2：截断 JSON — 从原始字符串提取 content 字段值
          // responseBody 格式: ...,"content":"{\"topic\":...,\"nodes\":[...],\"edges\":[...]}",...
          // 找到 "content":" 之后、下一个 ","reasoning_content"（或行尾）之前的内容
          const contentMatch = t.responseBody.match(
            /"content"\s*:\s*"((?:[^"\\]|\\.)*)"/,
          );
          if (contentMatch) {
            try {
              const contentStr = JSON.parse(`"${contentMatch[1]}"`);
              const start = contentStr.indexOf('{');
              const end = contentStr.lastIndexOf('}');
              if (start >= 0 && end > start) {
                graphJson = JSON.parse(contentStr.slice(start, end + 1));
              }
            } catch { /* regex 提取也失败，跳过 */ }
          }
        }

        if (graphJson) {
          parsedOutputs.push({
            nodes: Array.isArray(graphJson.nodes) ? graphJson.nodes : [],
            edges: Array.isArray(graphJson.edges) ? graphJson.edges : [],
          });
        }
      } catch { /* skip unparseable trace */ }
    }

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
  } catch {
    return null;
  }
}

function buildComparisonReport(fixtureNames, withMetrics, withoutMetrics) {
  const perFixture = fixtureNames.map((name) => ({
    fixtureName: name,
    withAssembler: withMetrics.get(name) ?? null,
    noAssembler: withoutMetrics.get(name) ?? null,
  }));

  const withTotals = aggregateMetrics(withMetrics);
  const withoutTotals = aggregateMetrics(withoutMetrics);

  const getRatio = (empty, total) => (total > 0 ? Number((empty / total).toFixed(3)) : null);
  const getAvg = (val, total) => (total > 0 ? Number((val / total).toFixed(2)) : 0);

  return {
    generatedAt: new Date().toISOString(),
    perFixture,
    summary: {
      withAssembler: {
        totalStructurerCalls: withTotals.calls,
        totalEmptyOutputs: withTotals.empties,
        emptyOutputRatio: getRatio(withTotals.empties, withTotals.calls),
        totalNodes: withTotals.nodes,
        totalEdges: withTotals.edges,
        avgNodesPerCall: getAvg(withTotals.nodes, withTotals.calls),
      },
      noAssembler: {
        totalStructurerCalls: withoutTotals.calls,
        totalEmptyOutputs: withoutTotals.empties,
        emptyOutputRatio: getRatio(withoutTotals.empties, withoutTotals.calls),
        totalNodes: withoutTotals.nodes,
        totalEdges: withoutTotals.edges,
        avgNodesPerCall: getAvg(withoutTotals.nodes, withoutTotals.calls),
      },
    },
  };
}

function aggregateMetrics(metricsMap) {
  let calls = 0;
  let empties = 0;
  let nodes = 0;
  let edges = 0;
  for (const m of metricsMap.values()) {
    if (!m) continue;
    calls += m.structurerCalls;
    empties += m.emptyOutputCount;
    nodes += m.totalNodes;
    edges += m.totalEdges;
  }
  return { calls, empties, nodes, edges };
}

function printComparisonReport(report) {
  const s = report.summary;
  const fmt = (v) => (v == null ? 'n/a' : String(v));

  console.log('');
  console.log('=== Assembler Baseline Comparison Report ===');
  console.log('');
  console.log('┌──────────────────────────────────┬───────────────┬───────────────┐');
  console.log('│ Metric                           │ With Assembler│ No Assembler  │');
  console.log('├──────────────────────────────────┼───────────────┼───────────────┤');
  console.log(`│ total structurer calls           │ ${String(s.withAssembler.totalStructurerCalls).padEnd(13)} │ ${String(s.noAssembler.totalStructurerCalls).padEnd(13)} │`);
  console.log(`│ total empty outputs              │ ${String(s.withAssembler.totalEmptyOutputs).padEnd(13)} │ ${String(s.noAssembler.totalEmptyOutputs).padEnd(13)} │`);
  console.log(`│ empty output ratio               │ ${String(fmt(s.withAssembler.emptyOutputRatio)).padEnd(13)} │ ${String(fmt(s.noAssembler.emptyOutputRatio)).padEnd(13)} │`);
  console.log(`│ total nodes generated            │ ${String(s.withAssembler.totalNodes).padEnd(13)} │ ${String(s.noAssembler.totalNodes).padEnd(13)} │`);
  console.log(`│ total edges generated            │ ${String(s.withAssembler.totalEdges).padEnd(13)} │ ${String(s.noAssembler.totalEdges).padEnd(13)} │`);
  console.log(`│ avg nodes per call               │ ${String(s.withAssembler.avgNodesPerCall).padEnd(13)} │ ${String(s.noAssembler.avgNodesPerCall).padEnd(13)} │`);
  console.log('└──────────────────────────────────┴───────────────┴───────────────┘');

  const fixturesWithData = report.perFixture.filter((f) => f.withAssembler || f.noAssembler);
  if (fixturesWithData.length > 0) {
    console.log('');
    console.log('Per-fixture:');
    for (const f of fixturesWithData) {
      console.log(`  ${f.fixtureName}:`);
      const w = f.withAssembler;
      const n = f.noAssembler;
      console.log(`    calls:         with=${w ? w.structurerCalls : 'n/a'}  without=${n ? n.structurerCalls : 'n/a'}`);
      console.log(`    emptyRatio:    with=${w ? fmt(w.emptyOutputRatio) : 'n/a'}  without=${n ? fmt(n.emptyOutputRatio) : 'n/a'}`);
      console.log(`    nodes:         with=${w ? w.totalNodes : 'n/a'}  without=${n ? n.totalNodes : 'n/a'}`);
      console.log(`    edges:         with=${w ? w.totalEdges : 'n/a'}  without=${n ? n.totalEdges : 'n/a'}`);
    }
  }
}

async function main() {
  const fixtureNames = discoverFixtureNames();
  console.log(`=== Assembler Baseline Comparison (${fixtureNames.length} fixtures) ===`);
  console.log('');

  // --- Step 1: Collect existing with-assembler artifacts ---
  console.log('>>> Step 1/3: Reading existing with-assembler artifacts...');
  const withMetrics = new Map();
  let withFound = 0;
  for (const name of fixtureNames) {
    const artifact = findLatestDiagnostic(withAssemblerArtifactDir, name);
    if (artifact) {
      const metrics = extractGraphMetrics(artifact.path);
      if (metrics) {
        withMetrics.set(name, metrics);
        withFound++;
      }
    }
  }
  console.log(`  Found ${withFound}/${fixtureNames.length} fixtures with existing artifacts`);
  console.log('');

  // --- Step 2: Run no-assembler replay ---
  console.log('>>> Step 2/3: Running NO assembler strict replay...');
  console.log('  (requires LISTEN_GRAPHIC_E2E_STRUCTURER_TYPE and LISTEN_GRAPHIC_E2E_STRUCTURER_API_KEY)');
  console.log('');

  const diagDirRelative = path.relative(extensionRoot, noAssemblerArtifactDir);
  await runReplay(['--no-assembler', `--diagnostic-dir=${diagDirRelative}`]);

  // --- Step 3: Read no-assembler artifacts and compare ---
  console.log('');
  console.log('>>> Step 3/3: Reading no-assembler artifacts and comparing...');
  const withoutMetrics = new Map();
  let withoutFound = 0;
  for (const name of fixtureNames) {
    const artifact = findLatestDiagnostic(noAssemblerArtifactDir, name);
    if (artifact) {
      const metrics = extractGraphMetrics(artifact.path);
      if (metrics) {
        withoutMetrics.set(name, metrics);
        withoutFound++;
      }
    }
  }
  console.log(`  Found ${withoutFound}/${fixtureNames.length} fixtures with no-assembler artifacts`);
  console.log('');

  const report = buildComparisonReport(fixtureNames, withMetrics, withoutMetrics);

  fs.mkdirSync(compareReportDir, { recursive: true });
  const reportPath = path.join(
    compareReportDir,
    `comparison-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
  );
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`Report saved to: ${reportPath}`);

  printComparisonReport(report);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
