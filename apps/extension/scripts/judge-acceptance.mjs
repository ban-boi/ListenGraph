// apps/extension/scripts/judge-acceptance.mjs
// 使用 LLM 对 graph artifacts 进行盲评，生成 judgment 和校准总结。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageRoot = path.resolve(__dirname, '..');
const segmentDir = path.resolve(
  packageRoot, 'src', 'service-worker', 'fixtures',
  'asr-realtime', 'artifacts', 'segments',
);
const graphsDir = path.resolve(segmentDir, 'graphs');
const judgmentDir = path.resolve(segmentDir, 'judgments');

// ── 环境变量 ───────────────────────────────────────────────────
const API_KEY = process.env.LISTEN_GRAPHIC_JUDGE_API_KEY ?? '';
const BASE_URL = process.env.LISTEN_GRAPHIC_JUDGE_BASE_URL ?? 'https://api.openai.com/v1';
const MODEL = process.env.LISTEN_GRAPHIC_JUDGE_MODEL ?? 'gpt-4o';

// ── 常量 ───────────────────────────────────────────────────────
const SYSTEM_PROMPT = `你是一个知识图谱质量评审专家。你的任务是对比两份从同一段语音转写生成的知识图谱，按固定 rubric 评分。

严格输出 JSON 格式，不要包含 markdown 代码块标记。`;

main();

// ── 入口 ───────────────────────────────────────────────────────
async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  validateEnv();

  // 发现 graph artifact 文件
  const graphFiles = discoverGraphFiles(options.filter);
  if (graphFiles.length === 0) {
    console.log('未找到匹配的 graph artifact 文件。');
    console.log(`路径: ${graphsDir}`);
    return;
  }

  fs.mkdirSync(judgmentDir, { recursive: true });

  console.log(`开始评判 ${graphFiles.length} 个 graph artifacts...`);
  console.log(`模型: ${MODEL} | API: ${BASE_URL}`);
  console.log('');

  const results = [];
  let succeeded = 0;
  let skipped = 0;
  let failed = 0;

  for (const graphFile of graphFiles) {
    const fixtureName = extractFixtureName(graphFile.fileName);

    // 检查是否已有 judgment
    if (!options.force && hasExistingJudgment(fixtureName)) {
      console.log(`跳过 ${fixtureName}（已有 judgment，用 --force 重新评判）`);
      skipped++;
      continue;
    }

    // 读取 segment utterances
    const segmentFile = findSegmentFile(graphFile.fileName);
    if (!segmentFile) {
      console.warn(`跳过 ${fixtureName}：未找到对应 segment 文件`);
      skipped++;
      continue;
    }

    const segment = readJsonFile(segmentFile);
    const graphArtifact = readJsonFile(graphFile.path);

    try {
      const judgment = await judgeSegment(fixtureName, segment, graphArtifact);
      writeJudgment(judgment);
      results.push(judgment);
      succeeded++;
      console.log(`完成 ${fixtureName} → 偏好: ${judgment.preferredActual}`);
    } catch (err) {
      failed++;
      console.error(`失败 ${fixtureName}: ${err.message}`);
    }
  }

  // 生成校准总结
  if (results.length > 0) {
    writeCalibrationSummary(results);
  }

  // 最终报告
  console.log('');
  console.log('=== 评判完成 ===');
  console.log(`成功: ${succeeded} | 跳过: ${skipped} | 失败: ${failed}`);
}

// ── 文件发现 ───────────────────────────────────────────────────

/** 发现 graphs 目录下所有 graph artifact 文件 */
function discoverGraphFiles(filter) {
  if (!fs.existsSync(graphsDir)) return [];

  const filesByFixtureName = new Map();
  for (const name of fs
    .readdirSync(graphsDir)
    .filter(
      (name) =>
        /^replay-local-seg\d+/u.test(name) &&
        (name.endsWith('.graphs.json') || name.endsWith('.combined-graph.json')),
    )
    .filter((name) => !filter || name.toLowerCase().includes(filter.toLowerCase()))
    .sort()) {
    const fixtureName = extractFixtureName(name);
    const existing = filesByFixtureName.get(fixtureName);
    if (!existing || name.endsWith('.graphs.json')) {
      filesByFixtureName.set(fixtureName, { fileName: name, path: path.join(graphsDir, name) });
    }
  }

  return [...filesByFixtureName.values()].sort((a, b) => a.fileName.localeCompare(b.fileName));
}

/** 从 graph 文件名提取 fixtureName */
function extractFixtureName(graphFileName) {
  return graphFileName.replace(/\.(graphs|combined-graph)\.json$/, '');
}

/** 根据 graph 文件名反查对应 segment 文件 */
function findSegmentFile(graphFileName) {
  if (!fs.existsSync(segmentDir)) return null;

  // graph 文件名格式: replay-local-seg01-xxx.graphs.json
  // segment 文件名格式: local_xxx_seg01.json
  // 从 fixtureName 提取 seg 编号
  const segMatch = graphFileName.match(/seg(\d+)/);
  if (!segMatch) return null;
  const segNum = segMatch[1];

  // 遍历 segment 目录找对应 seg 编号的文件
  const candidates = fs
    .readdirSync(segmentDir)
    .filter((name) =>
      name.startsWith('local_') &&
      name.endsWith(`_seg${segNum}.json`) &&
      !name.endsWith('_manifest.json'),
    );

  return candidates.length > 0 ? path.join(segmentDir, candidates[0]) : null;
}

/** 检查是否已有 judgment 文件 */
function hasExistingJudgment(fixtureName) {
  const judgmentPath = path.join(judgmentDir, `${fixtureName}.judgment.json`);
  return fs.existsSync(judgmentPath);
}

// ── 核心评判逻辑 ───────────────────────────────────────────────

/** 对单个 segment 进行盲评 */
async function judgeSegment(fixtureName, segment, graphArtifact) {
  // 随机映射 graphA/B → graph1/2
  const swap = Math.random() > 0.5;
  const labelMapping = swap
    ? { graph1: 'graphB', graph2: 'graphA' }
    : { graph1: 'graphA', graph2: 'graphB' };

  const mappedGraph1 = swap ? graphArtifact.graphB : graphArtifact.graphA;
  const mappedGraph2 = swap ? graphArtifact.graphA : graphArtifact.graphB;

  const userPrompt = buildUserPrompt(segment.utterances, mappedGraph1, mappedGraph2);
  const llmResponse = await callLlm(userPrompt);
  const parsed = parseLlmResponse(llmResponse);

  // 将评分中的 graph1/graph2 映射回 graphA/graphB
  const resolvedPreferredActual = resolvePreferred(parsed.preferred, labelMapping);
  const resolvedScores = resolveScores(parsed, labelMapping);

  return {
    fixtureName,
    labelMapping,
    coverage: resolvedScores.coverage,
    faithfulness: resolvedScores.faithfulness,
    relationQuality: resolvedScores.relationQuality,
    noiseHandling: resolvedScores.noiseHandling,
    preferred: parsed.preferred,
    preferredActual: resolvedPreferredActual,
    shouldPromoteToFixture: parsed.shouldPromoteToFixture,
    promoteReason: parsed.promoteReason,
    suggestedAcceptanceDraft: parsed.suggestedAcceptanceDraft,
    generatedAt: new Date().toISOString(),
  };
}

/** 构建 user prompt */
function buildUserPrompt(utterances, graph1, graph2) {
  const uttList = utterances
    .map((u, i) => `${i + 1}. ${u.text} (${u.startMs}-${u.endMs})`)
    .join('\n');

  const nodes1 = formatNodes(graph1.nodes);
  const edges1 = formatEdges(graph1.edges);
  const nodes2 = formatNodes(graph2.nodes);
  const edges2 = formatEdges(graph2.edges);

  return `## 原始 ASR 转写
以下是原始语音识别输出的 utterance 序列（可能含噪声、碎片、截断）：

${uttList}

## Graph1
节点：
${nodes1}
边：
${edges1}

## Graph2
节点：
${nodes2}
边：
${edges2}

## 评分 Rubric（1-5 分）

### coverage（覆盖率）
图中是否覆盖了原始 utterances 的主要语义点？
- 5: 覆盖所有核心论点
- 3: 覆盖部分，遗漏了一些重要点
- 1: 大量遗漏

### faithfulness（忠实度）
节点文本是否忠实于原始文本？
- 5: 所有节点文本都能在原文中找到对应
- 3: 大部分忠实，有少量推断
- 1: 出现明显幻觉（原文完全没说的内容）

### relationQuality（关系质量）
边类型（supports/opposes/causes/follows/example_of）是否准确？
- 5: 所有边类型准确反映语义关系
- 3: 大部分准确，少量标错
- 1: 大量关系类型错误（如把反对标为支持）

### noiseHandling（噪声处理）
口头禅/停顿/碎片是否被合理过滤？
- 5: 完全过滤，图中只有实质内容
- 3: 大部分过滤，少量噪声残留
- 1: 口头禅、语气词变成了节点

## 输出格式

\`\`\`json
{
  "coverage": {
    "graph1": <1-5>,
    "graph2": <1-5>,
    "reason": "评分理由"
  },
  "faithfulness": {
    "graph1": <1-5>,
    "graph2": <1-5>,
    "reason": "评分理由"
  },
  "relationQuality": {
    "graph1": <1-5>,
    "graph2": <1-5>,
    "reason": "评分理由"
  },
  "noiseHandling": {
    "graph1": <1-5>,
    "graph2": <1-5>,
    "reason": "评分理由"
  },
  "preferred": "graph1" | "graph2" | "tie",
  "shouldPromoteToFixture": true | false,
  "promoteReason": "为什么推荐/不推荐作为回归 fixture",
  "suggestedAcceptanceDraft": {
    "minMergedNodes": <number>,
    "maxMergedNodes": <number>,
    "minMergedEdges": <number>,
    "allowFallback": <boolean>,
    "mustContainOneOfTexts": [
      ["关键词1", "同义词1"],
      ["关键词2", "同义词2"]
    ],
    "forbiddenTexts": ["不应出现的词"],
    "mustHaveNodeTypes": ["claim"],
    "reviewStatus": "ai_draft"
  }
}
\`\`\`

注意：
1. mustContainOneOfTexts 选 3-5 组核心语义锚点，每组 2-3 个同义表达
2. 不要自动添加 requiredEdgeTypes——边类型有合理浮动
3. mustHaveNodeTypes 最多要求 "claim" 类型
4. 如果原始内容信息量极低（纯开场/掌声/过渡），shouldPromoteToFixture 设为 false`;
}

/** 格式化节点列表 */
function formatNodes(nodes) {
  if (!Array.isArray(nodes) || nodes.length === 0) return '（无节点）';
  return nodes
    .map((n) => `${n.id ?? '?'} | ${n.type ?? '?'} | ${n.text ?? ''}`)
    .join('\n');
}

/** 格式化边列表 */
function formatEdges(edges) {
  if (!Array.isArray(edges) || edges.length === 0) return '（无边）';
  return edges
    .map((e) => `${e.sourceText ?? '?'} → ${e.targetText ?? '?'} | ${e.type ?? '?'} | ${e.confidence ?? '?'}`)
    .join('\n');
}

// ── LLM 调用 ──────────────────────────────────────────────────

/** 调用 OpenAI-compatible API */
async function callLlm(userPrompt) {
  const url = `${BASE_URL}/chat/completions`;
  const body = {
    model: MODEL,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.3,
    response_format: { type: 'json_object' },
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEY}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`API 返回 ${response.status}: ${text.slice(0, 200)}`);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    throw new Error('API 返回空内容');
  }
  return content;
}

// ── 响应解析 ──────────────────────────────────────────────────

/** 解析 LLM 返回的 JSON */
function parseLlmResponse(raw) {
  const cleaned = stripMarkdownCodeBlock(raw);
  try {
    return JSON.parse(cleaned);
  } catch {
    throw new Error(`LLM 返回非 JSON: ${cleaned.slice(0, 100)}`);
  }
}

/** 移除 markdown 代码块标记 */
function stripMarkdownCodeBlock(text) {
  const trimmed = text.trim();
  const match = trimmed.match(/^```(?:json)?\s*\n([\s\S]*?)\n```$/);
  if (match) return match[1];
  return trimmed;
}

/** 将偏好从 graph1/graph2 映射回 graphA/graphB */
function resolvePreferred(preferred, labelMapping) {
  if (preferred === 'tie') return 'tie';
  return labelMapping[preferred] ?? preferred;
}

/** 将评分维度中的 graph1/graph2 映射回 graphA/graphB */
function resolveScores(parsed, labelMapping) {
  const dims = ['coverage', 'faithfulness', 'relationQuality', 'noiseHandling'];
  const resolved = {};

  for (const dim of dims) {
    const entry = parsed[dim];
    if (!entry) continue;

    resolved[dim] = {
      graphA: entry[labelMapping.graph1 === 'graphA' ? 'graph1' : 'graph2'],
      graphB: entry[labelMapping.graph1 === 'graphA' ? 'graph2' : 'graph1'],
      reason: entry.reason ?? '',
    };
  }

  return resolved;
}

// ── 写入输出 ──────────────────────────────────────────────────

/** 写入单个 judgment 文件 */
function writeJudgment(judgment) {
  const filePath = path.join(judgmentDir, `${judgment.fixtureName}.judgment.json`);
  fs.writeFileSync(filePath, `${JSON.stringify(judgment, null, 2)}\n`);
}

/** 生成并写入校准总结 */
function writeCalibrationSummary(results) {
  const summaryPath = path.join(segmentDir, 'calibration-summary.md');

  const promoted = results.filter((r) => r.shouldPromoteToFixture);
  const skipped = results.filter((r) => !r.shouldPromoteToFixture);

  // 统计偏好
  let preferA = 0;
  let preferB = 0;
  let tieCount = 0;
  for (const r of results) {
    if (r.preferredActual === 'graphA') preferA++;
    else if (r.preferredActual === 'graphB') preferB++;
    else tieCount++;
  }

  // 按维度汇总平均分
  const dimStats = computeDimensionAverages(results);

  const now = new Date();
  const timestamp = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())} ${pad2(now.getHours())}:${pad2(now.getMinutes())}`;

  const lines = [
    `# LLM Judge 校准总结`,
    ``,
    `生成时间: ${timestamp}`,
    ``,
    `## 概览`,
    `- segments: ${results.length} | promote: ${promoted.length} | skip: ${skipped.length}`,
    `- graphA (with assembler) 被偏好: ${preferA} 次`,
    `- graphB (without assembler) 被偏好: ${preferB} 次`,
    `- tie: ${tieCount} 次`,
    ``,
    `## 推荐保留（shouldPromoteToFixture=true）`,
    generatePromotedTable(promoted),
    ``,
    `## 推荐跳过`,
    generateSkippedTable(skipped),
    ``,
    `## Assembler 效果`,
    generateAssemblerEffect(dimStats),
    ``,
  ];

  fs.writeFileSync(summaryPath, lines.join('\n'));
  console.log(`校准总结已写入: ${summaryPath}`);
}

/** 生成推荐保留的表格 */
function generatePromotedTable(promoted) {
  if (promoted.length === 0) return '（无）';

  const header = '| Seg | 概要 | Cov A/B | Faith A/B | Rel A/B | Noise A/B | 偏好 |';
  const sep =     '|-----|------|---------|-----------|---------|-----------|------|';
  const rows = promoted.map((r) => {
    const seg = extractSegLabel(r.fixtureName);
    const summary = (r.promoteReason ?? '').slice(0, 20);
    return `| ${seg} | ${summary} | ${fmtDim(r.coverage)} | ${fmtDim(r.faithfulness)} | ${fmtDim(r.relationQuality)} | ${fmtDim(r.noiseHandling)} | ${r.preferredActual} |`;
  });

  return [header, sep, ...rows].join('\n');
}

/** 生成推荐跳过的表格 */
function generateSkippedTable(skipped) {
  if (skipped.length === 0) return '（无）';

  const header = '| Seg | 原因 |';
  const sep =     '|-----|------|';
  const rows = skipped.map((r) => {
    const seg = extractSegLabel(r.fixtureName);
    const reason = (r.promoteReason ?? '').slice(0, 50);
    return `| ${seg} | ${reason} |`;
  });

  return [header, sep, ...rows].join('\n');
}

/** 生成 Assembler 效果汇总 */
function generateAssemblerEffect(dimStats) {
  const dims = ['coverage', 'faithfulness', 'relationQuality', 'noiseHandling'];
  const labels = {
    coverage: '覆盖率',
    faithfulness: '忠实度',
    relationQuality: '关系质量',
    noiseHandling: '噪声处理',
  };

  const header = '| 维度 | graphA 均分 | graphB 均分 | 差值 |';
  const sep =     '|------|------------|------------|------|';
  const rows = dims.map((dim) => {
    const stat = dimStats[dim] ?? { avgA: 0, avgB: 0 };
    const diff = (stat.avgA - stat.avgB).toFixed(2);
    const sign = Number(diff) > 0 ? '+' : '';
    return `| ${labels[dim]} | ${stat.avgA.toFixed(2)} | ${stat.avgB.toFixed(2)} | ${sign}${diff} |`;
  });

  return [header, sep, ...rows].join('\n');
}

/** 计算各维度平均分 */
function computeDimensionAverages(results) {
  const dims = ['coverage', 'faithfulness', 'relationQuality', 'noiseHandling'];
  const stats = {};

  for (const dim of dims) {
    let sumA = 0;
    let sumB = 0;
    let count = 0;

    for (const r of results) {
      const entry = r[dim];
      if (!entry) continue;
      sumA += Number(entry.graphA) || 0;
      sumB += Number(entry.graphB) || 0;
      count++;
    }

    stats[dim] = {
      avgA: count > 0 ? sumA / count : 0,
      avgB: count > 0 ? sumB / count : 0,
    };
  }

  return stats;
}

// ── 辅助函数 ──────────────────────────────────────────────────

/** 格式化维度得分为 "A/B" */
function fmtDim(dimEntry) {
  if (!dimEntry) return '?/?';
  return `${dimEntry.graphA ?? '?'}/${dimEntry.graphB ?? '?'}`;
}

/** 从 fixtureName 提取 seg 标签 */
function extractSegLabel(fixtureName) {
  const match = fixtureName.match(/(seg\d+)/);
  return match ? match[1] : fixtureName.slice(-10);
}

/** 两位数补零 */
function pad2(n) {
  return String(n).padStart(2, '0');
}

/** 读取 JSON 文件 */
function readJsonFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  try {
    return JSON.parse(content);
  } catch (err) {
    throw new Error(`JSON 解析失败 (${path.basename(filePath)}): ${err.message}`);
  }
}

// ── 环境校验 ──────────────────────────────────────────────────

/** 校验必要的环境变量 */
function validateEnv() {
  if (!API_KEY) {
    console.error('错误: 必须设置环境变量 LISTEN_GRAPHIC_JUDGE_API_KEY');
    process.exit(1);
  }
}

// ── CLI 参数 ──────────────────────────────────────────────────

/** 解析命令行参数 */
function parseArgs(argv) {
  const options = { filter: '', force: false, help: false };

  for (let i = 0; i < argv.length; i++) {
    const cur = argv[i];
    switch (cur) {
      case '--filter':
        options.filter = requireValue(argv, ++i, '--filter');
        break;
      case '--force':
        options.force = true;
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
      default:
        throw new Error(`未知参数: ${cur}`);
    }
  }

  return options;
}

/** 获取 flag 的值 */
function requireValue(argv, index, flag) {
  const value = argv[index];
  if (!value) throw new Error(`${flag} 需要一个值`);
  return value;
}

/** 显示帮助信息 */
function printHelp() {
  console.log(`使用 LLM 对 graph artifacts 进行盲评，生成 judgment 和校准总结。

用法:
  node scripts/judge-acceptance.mjs [选项]

选项:
  --filter <substring>   只处理文件名包含此文本的 graph artifact
  --force                重新评判已有 judgment 的 segment
  --help                 显示此帮助

环境变量:
  LISTEN_GRAPHIC_JUDGE_API_KEY    （必填）OpenAI-compatible API Key
  LISTEN_GRAPHIC_JUDGE_BASE_URL   （可选）API 地址，默认 https://api.openai.com/v1
  LISTEN_GRAPHIC_JUDGE_MODEL      （可选）模型名，默认 gpt-4o

输入:
  artifacts/segments/graphs/replay-local-segNN-*.graphs.json

输出:
  artifacts/segments/judgments/replay-local-segNN-<slug>.judgment.json
  artifacts/segments/calibration-summary.md
`);
}
