// apps/extension/scripts/promote-judgment-to-fixture.mjs
// 将 LLM Judge 生成的 acceptance 草稿（judgment.suggestedAcceptanceDraft）
// 严格落地到对应的 replay-local-segNN fixture 的 acceptance 字段。
//
// 严格策略：草稿原样落地（含 maxMergedNodes 上界、mustContainOneOfTexts 长句、
// forbiddenTexts、mustHaveNodeTypes）。目的是用 strict 测试诊断 AI 草稿与
// structurer 真实输出的差距，而非追求一次通过。
//
// 副作用：清除 weak_scaffold 标记（_quality + manualReviewTags 里对应项），
// 保留 local-asr-source 标记。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const extensionRoot = path.resolve(__dirname, '..');
const fixtureDir = path.join(extensionRoot, 'src', 'service-worker', 'fixtures', 'structure');
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

main();

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    printHelp();
    return;
  }

  // 找所有 judgment（只处理 replay-local-segNN）
  const judgments = fs
    .readdirSync(judgmentDir)
    .filter((n) => n.startsWith('replay-local-seg') && n.endsWith('.judgment.json'))
    .map((n) => ({
      judgmentFile: n,
      fixtureName: n.replace(/\.judgment\.json$/i, ''),
      data: readJson(path.join(judgmentDir, n)),
    }))
    .filter((j) => opts.filter ? j.fixtureName.toLowerCase().includes(opts.filter.toLowerCase()) : true);

  if (judgments.length === 0) {
    console.log('未找到匹配的 judgment。');
    return;
  }

  console.log(`找到 ${judgments.length} 个 judgment，开始落地（${opts.dryRun ? 'dry-run' : '写入'}）...\n`);

  let promoted = 0;
  let skipped = 0;

  for (const j of judgments) {
    const fixturePath = path.join(fixtureDir, `${j.fixtureName}.json`);
    if (!fs.existsSync(fixturePath)) {
      console.warn(`  跳过 ${j.fixtureName}：找不到对应 fixture`);
      skipped++;
      continue;
    }

    if (!j.data.shouldPromoteToFixture) {
      console.log(`  跳过 ${j.fixtureName}：shouldPromoteToFixture=false`);
      skipped++;
      continue;
    }

    const draft = j.data.suggestedAcceptanceDraft;
    if (!draft) {
      console.warn(`  跳过 ${j.fixtureName}：无 suggestedAcceptanceDraft`);
      skipped++;
      continue;
    }

    const fixture = readJson(fixturePath);

    // 检查是否已落地（且非 force）
    const alreadyPromoted = fixture.acceptance?.promotedFrom;
    if (alreadyPromoted && !opts.force) {
      console.log(`  跳过 ${j.fixtureName}：已落地（promotedFrom=${alreadyPromoted}），用 --force 覆盖`);
      skipped++;
      continue;
    }

    const newAcceptance = buildAcceptance(draft, j.data.generatedAt);
    fixture.acceptance = newAcceptance;

    console.log(`  ${opts.dryRun ? '[dry-run] ' : ''}${j.fixtureName}`);
    console.log(`    nodes: ${draft.minMergedNodes}-${draft.maxMergedNodes ?? '∞'} | edges≥${draft.minMergedEdges} | fallback:${draft.allowFallback}`);
    console.log(`    mustContainOneOf: ${draft.mustContainOneOfTexts?.length ?? 0}组 | forbidden: ${draft.forbiddenTexts?.length ?? 0}个 | nodeTypes: ${JSON.stringify(draft.mustHaveNodeTypes ?? [])}`);

    if (!opts.dryRun) {
      fs.writeFileSync(fixturePath, `${JSON.stringify(fixture, null, 2)}\n`);
    }
    promoted++;
  }

  console.log(`\n完成：落地 ${promoted} | 跳过 ${skipped}`);
}

/**
 * 从 draft 构建 acceptance，严格落地 + 保留必读字段 + 清 weak_scaffold 标记。
 * 保留 minSegments（测试必读），保留 local-asr-source 标记。
 */
function buildAcceptance(draft, generatedAt) {
  const acc = {
    minSegments: 1, // 测试必读字段，保留默认
    minMergedNodes: draft.minMergedNodes,
    minMergedEdges: draft.minMergedEdges,
    allowFallback: draft.allowFallback ?? true,
    manualReviewTags: ['local-asr-source'], // 清掉 weak_scaffold + needs-acceptance-calibration，留 local 来源
    promotedFrom: generatedAt, // 溯源：来自哪个 judgment
  };

  // 以下为草稿特有字段，原样落地（严格策略）
  if (draft.maxMergedNodes != null) acc.maxMergedNodes = draft.maxMergedNodes;
  if (draft.mustContainOneOfTexts?.length) acc.mustContainOneOfTexts = draft.mustContainOneOfTexts;
  if (draft.forbiddenTexts?.length) acc.forbiddenTexts = draft.forbiddenTexts;
  if (draft.mustHaveNodeTypes?.length) acc.mustHaveNodeTypes = draft.mustHaveNodeTypes;

  return acc;
}

// ── 辅助 ──

function readJson(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch (err) {
    throw new Error(`JSON 解析失败 (${path.basename(p)}): ${err.message}`);
  }
}

function parseArgs(argv) {
  const opts = { filter: '', force: false, dryRun: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const cur = argv[i];
    if (cur === '--filter') opts.filter = argv[++i] ?? '';
    else if (cur === '--force') opts.force = true;
    else if (cur === '--dry-run') opts.dryRun = true;
    else if (cur === '--help' || cur === '-h') opts.help = true;
    else throw new Error(`未知参数: ${cur}`);
  }
  return opts;
}

function printHelp() {
  console.log(`将 LLM Judge 草稿严格落地到 fixture 的 acceptance。

用法:
  node scripts/promote-judgment-to-fixture.mjs [选项]

选项:
  --filter <substring>   只处理 fixture 名包含此文本的
  --force                覆盖已落地的 fixture（已带 promotedFrom）
  --dry-run              只预览不写入
  --help                 显示此帮助

策略: 严格落地（草稿原样进 acceptance，含 maxMergedNodes 上界）。
清除 weak_scaffold 标记，保留 local-asr-source。
落地后跑: pnpm test:structure:real:replay:local （诊断红绿分布）
`);
}
