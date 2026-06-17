// apps/extension/scripts/prepare-local-replay-fixtures.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageRoot = path.resolve(__dirname, '..');
const asrFixtureDir = path.resolve(packageRoot, 'src', 'service-worker', 'fixtures', 'asr-realtime');
const artifactDir = path.resolve(asrFixtureDir, 'artifacts');
const segmentDir = path.resolve(artifactDir, 'segments');
const structureFixtureDir = path.resolve(packageRoot, 'src', 'service-worker', 'fixtures', 'structure');

main();

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  if (options.segments) {
    processSegments(options);
    return;
  }

  if (!fs.existsSync(artifactDir)) {
    throw new Error(`Artifact 目录不存在: ${artifactDir}。先运行 run-local-asr-for-artifacts.mjs。`);
  }

  fs.mkdirSync(structureFixtureDir, { recursive: true });

  const localArtifacts = fs
    .readdirSync(artifactDir)
    .filter((name) => name.startsWith('local_') && name.endsWith('.utterances.json'))
    .sort()
    .map((name) => ({
      fileName: name,
      path: path.join(artifactDir, name),
      raw: JSON.parse(fs.readFileSync(path.join(artifactDir, name), 'utf-8')),
    }));

  if (localArtifacts.length === 0) {
    throw new Error('未找到 local artifact (local_*.utterances.json)。先运行 run-local-asr-for-artifacts.mjs。');
  }

  const summary = [];
  for (const entry of localArtifacts) {
    const artifact = entry.raw;
    const replayName = buildReplayName(artifact.fixtureName);

    if (options.filter && !replayName.toLowerCase().includes(options.filter)) {
      continue;
    }

    const utterances = Array.isArray(artifact.utterances) ? artifact.utterances : [];
    if (utterances.length === 0) {
      console.warn(`跳过 ${artifact.fixtureName}: 无 utterances`);
      continue;
    }

    const structureFixture = {
      name: replayName,
      transcripts: utterances.map((utt, index) => ({
        chunkId: `${sanitizeFileName(replayName)}_${String(index + 1).padStart(2, '0')}`,
        text: utt.text,
        startMs: utt.startMs,
        endMs: utt.endMs,
        raw: {
          source: 'local-asr-replay',
          artifactFixtureName: artifact.fixtureName,
          utteranceId: utt.utteranceId ?? '',
          confidence: utt.confidence ?? 0,
          finalReason: utt.finalReason ?? '',
        },
      })),
      acceptance: buildWeakAcceptance(utterances),
    };

    const outputPath = path.join(structureFixtureDir, `${replayName}.json`);
    const existedBeforeWrite = fs.existsSync(outputPath);
    if (options.force || !existedBeforeWrite) {
      fs.writeFileSync(outputPath, `${JSON.stringify(structureFixture, null, 2)}\n`);
    }

    summary.push({
      replayName,
      outputPath,
      utteranceCount: utterances.length,
      preserved: !options.force && fs.existsSync(outputPath),
    });
  }

  console.log(`生成了 ${summary.length} 个 structure replay fixture scaffold。`);
  for (const item of summary) {
    console.log(`- ${item.replayName}`);
    console.log(`  文件: ${path.relative(packageRoot, item.outputPath)}`);
    console.log(`  utterances: ${item.utteranceCount}`);
    if (item.preserved) {
      console.log(`  状态: 已保留已有文件（用 --force 覆盖）`);
    }
    console.log(`  ⚠️  acceptance 需要人工校准`);
  }
}

/**
 * 从 segment 文件生成 replay-local-segNN-*.json fixture。
 * 读取 manifest 过滤 keep: false 的段。
 */
function processSegments(options) {
  if (!fs.existsSync(segmentDir)) {
    throw new Error(`Segment 目录不存在: ${segmentDir}。先运行 segment-local-artifacts.mjs。`);
  }

  fs.mkdirSync(structureFixtureDir, { recursive: true });

  // 查找所有 segment 文件
  const segmentFiles = fs
    .readdirSync(segmentDir)
    .filter((name) => name.startsWith('local_') && name.endsWith('_seg.json') === false && /_seg\d+\.json$/.test(name))
    .sort()
    .map((name) => ({
      fileName: name,
      path: path.join(segmentDir, name),
    }));

  if (segmentFiles.length === 0) {
    throw new Error(`未找到 segment 文件 (${segmentDir}/local_*_seg*.json)。先运行 segment-local-artifacts.mjs。`);
  }

  // 尝试读取 manifest 获取 keep/mergeWithNext 信息
  const manifests = loadManifests(segmentDir);

  const summary = [];
  for (const entry of segmentFiles) {
    const segment = JSON.parse(fs.readFileSync(entry.path, 'utf-8'));
    const segIndex = segment.segmentIndex ?? 0;
    const segId = `seg${String(segIndex).padStart(2, '0')}`;

    // 检查 manifest 是否标记 keep: false
    const manifestKey = entry.fileName.replace(/\.json$/, '');
    const manifestEntry = manifests[manifestKey]?.segments?.[segId];
    if (manifestEntry && !manifestEntry.keep) {
      console.log(`跳过 ${segId} (manifest 标记 keep: false: ${manifestEntry.note || '无备注'})`);
      continue;
    }

    const utterances = Array.isArray(segment.utterances) ? segment.utterances : [];
    if (utterances.length === 0) {
      console.warn(`跳过 ${segId}: 无 utterances`);
      continue;
    }

    const replayName = buildSegmentReplayName(segment.sourceArtifact, segIndex, utterances);

    if (options.filter && !replayName.toLowerCase().includes(options.filter)) {
      continue;
    }

    const structureFixture = {
      name: replayName,
      transcripts: utterances.map((utt, index) => ({
        chunkId: `${sanitizeFileName(replayName)}_${String(index + 1).padStart(2, '0')}`,
        text: utt.text,
        startMs: utt.startMs,
        endMs: utt.endMs,
        raw: {
          source: 'local-asr-replay',
          artifactFixtureName: segment.sourceArtifact ?? '',
          segmentIndex: segIndex,
          utteranceId: utt.utteranceId ?? '',
          confidence: utt.confidence ?? 0,
          finalReason: utt.finalReason ?? '',
        },
      })),
      acceptance: buildWeakAcceptance(utterances),
    };

    const outputPath = path.join(structureFixtureDir, `${replayName}.json`);
    const existedBeforeWrite = fs.existsSync(outputPath);
    if (options.force || !existedBeforeWrite) {
      fs.writeFileSync(outputPath, `${JSON.stringify(structureFixture, null, 2)}\n`);
    }

    summary.push({
      replayName,
      outputPath,
      utteranceCount: utterances.length,
      durationMs: segment.meta?.durationMs ?? 0,
      preserved: !options.force && existedBeforeWrite,
    });
  }

  console.log(`从 segments 生成了 ${summary.length} 个 structure replay fixture scaffold。`);
  for (const item of summary) {
    console.log(`- ${item.replayName}`);
    console.log(`  文件: ${path.relative(packageRoot, item.outputPath)}`);
    console.log(`  utterances: ${item.utteranceCount} | 时长: ${(item.durationMs / 1000).toFixed(1)}s`);
    if (item.preserved) {
      console.log(`  状态: 已保留已有文件（用 --force 覆盖）`);
    }
    console.log(`  ⚠️  acceptance 需要人工校准`);
  }
}

/**
 * 读取 segments 目录下的所有 manifest 文件。
 * 返回 { fileNameWithoutExt: manifestData } 映射。
 */
function loadManifests(dir) {
  const manifests = {};
  if (!fs.existsSync(dir)) return manifests;

  const manifestFiles = fs
    .readdirSync(dir)
    .filter((name) => name.startsWith('local_') && name.endsWith('_manifest.json'));

  for (const name of manifestFiles) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf-8'));
      const key = name.replace('_manifest.json', '');
      manifests[key] = data;
    } catch {
      // manifest 解析失败，忽略
    }
  }
  return manifests;
}

/**
 * 从 segment 信息生成 replay fixture name。
 * 格式：replay-local-seg<NN>-<简短描述>
 */
function buildSegmentReplayName(sourceArtifact, segIndex, utterances) {
  const segLabel = `seg${String(segIndex).padStart(2, '0')}`;
  // 从前几条 utterance 提取简短描述
  const preview = utterances
    .slice(0, 3)
    .map((u) => u.text.trim())
    .join('')
    .slice(0, 20);
  const slug = preview.replace(/[<>:"/\\|?*\x00-\x1F]/g, '').replace(/\s+/g, '-').slice(0, 15) || 'segment';
  return `replay-local-${segLabel}-${slug}`;
}

/**
 * 从 fixture name 生成 replay fixture name。
 * "generated:1_信息密集型_罗翔十一学校讲座" → "replay-local-1-信息密集型-罗翔十一学校讲座"
 */
function buildReplayName(fixtureName) {
  const raw = fixtureName.replace(/^generated:/, '');
  const safe = raw.replace(/[<>:"/\\|?*\x00-\x1F]/g, '-').replace(/_+/g, '-');
  return `replay-local-${safe}`;
}

/**
 * 生成弱 acceptance scaffold。
 * 保守估计，标记需要人工校准。
 */
function buildWeakAcceptance(utterances) {
  const totalText = utterances.map((u) => u.text).join('');
  const weakAnchors = extractWeakAnchors(totalText);

  // 公式：sqrt(N)，对短音频合理（10 条→3），对长音频不爆炸（482 条→21）
  // 这只是脚手架估算，不是质量标准——必须人工校准
  const acceptance = {
    _quality: 'weak_scaffold',
    minSegments: 1,
    minMergedNodes: Math.max(2, Math.floor(Math.sqrt(utterances.length))),
    minMergedEdges: 0,
    allowFallback: true,
    manualReviewTags: ['weak_scaffold', 'needs-acceptance-calibration', 'local-asr-source'],
  };

  if (weakAnchors.length > 0) {
    acceptance.mustContainOneOfTexts = weakAnchors.map((anchor) => [anchor]);
  }

  return acceptance;
}

/**
 * 从 utterance 文本中提取弱锚点短语。
 * 策略：按中文标点分句，选长度 6-16 字符、含中文的片段，取前 3 个。
 */
function extractWeakAnchors(totalText, maxCount = 3) {
  const sentences = totalText
    .split(/[。！？；\n\r]+/u)
    .map((s) => s.trim())
    .filter((s) => s.length >= 6 && s.length <= 16)
    .filter((s) => /[\p{Script=Han}]/u.test(s));

  const unique = [];
  const seen = new Set();
  for (const s of sentences) {
    const normalized = s.replace(/[\s，、,.]/gu, '');
    if (normalized.length < 4 || seen.has(normalized)) continue;
    seen.add(normalized);
    unique.push(normalized);
    if (unique.length >= maxCount) break;
  }

  return unique;
}

function parseArgs(argv) {
  const options = { force: false, help: false, filter: '', segments: false };
  for (let i = 0; i < argv.length; i += 1) {
    const cur = argv[i];
    switch (cur) {
      case '--force':
        options.force = true;
        break;
      case '--filter':
        options.filter = requireValue(argv, ++i, '--filter').trim().toLowerCase();
        break;
      case '--segments':
        options.segments = true;
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

function requireValue(argv, index, flag) {
  const value = argv[index];
  if (!value) throw new Error(`${flag} 需要一个值`);
  return value;
}

function printHelp() {
  console.log(`从本地 ASR artifact 或 segment 文件生成 structure replay fixture scaffold。

用法:
  node scripts/prepare-local-replay-fixtures.mjs [选项]

模式:
  默认              从完整 artifact 生成 replay-local-*.json
  --segments        从 segment 文件生成 replay-local-segNN-*.json

选项:
  --filter <text>   只生成名称包含此文本的 fixture
  --force           覆盖已有的 replay fixture
  --segments        从 artifacts/segments/ 读取分段文件
  --help            显示此帮助

前提:
  默认模式：先运行 run-local-asr-for-artifacts.mjs 生成 local artifact。
  --segments 模式：先运行 segment-local-artifacts.mjs 生成 segment 文件。

输出:
  src/service-worker/fixtures/structure/replay-local-*.json

注意:
  acceptance 是弱 scaffold，必须人工校准后才能作为回归门槛。
  _quality: "weak_scaffold" 标记此为脚手架，不是质量标准。
`);
}

function sanitizeFileName(value) {
  return value.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
}
