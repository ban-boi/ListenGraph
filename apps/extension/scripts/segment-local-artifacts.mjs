// apps/extension/scripts/segment-local-artifacts.mjs
// 将 local ASR artifact 按 silence gap 分段，输出 segment 文件和 manifest。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ARTIFACT_DIR = path.resolve(__dirname, '..', 'src', 'service-worker', 'fixtures', 'asr-realtime', 'artifacts');
const SEGMENT_DIR = path.resolve(ARTIFACT_DIR, 'segments');

// ── 默认分段参数 ──────────────────────────────────────────────
const DEFAULT_GAP_MS = 5000;
const DEFAULT_MIN_DURATION_MS = 30000;
const DEFAULT_MAX_DURATION_MS = 120000;

main();

// ── 入口 ──────────────────────────────────────────────────────
function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  if (!fs.existsSync(ARTIFACT_DIR)) {
    throw new Error(`Artifact 目录不存在: ${ARTIFACT_DIR}。先运行 run-local-asr-for-artifacts.mjs。`);
  }

  const inputFiles = resolveInputFiles(options);
  if (inputFiles.length === 0) {
    console.log('未找到匹配的 artifact 文件。');
    return;
  }

  fs.mkdirSync(SEGMENT_DIR, { recursive: true });

  for (const filePath of inputFiles) {
    processOneArtifact(filePath, options);
  }
}

// ── 文件解析 ──────────────────────────────────────────────────
function resolveInputFiles(options) {
  if (options.input) {
    const resolved = path.isAbsolute(options.input)
      ? options.input
      : path.resolve(ARTIFACT_DIR, options.input);
    if (!fs.existsSync(resolved)) {
      throw new Error(`指定文件不存在: ${resolved}`);
    }
    return [resolved];
  }

  return fs
    .readdirSync(ARTIFACT_DIR)
    .filter((name) => name.startsWith('local_full_') && name.endsWith('.utterances.json'))
    .sort()
    .map((name) => path.join(ARTIFACT_DIR, name));
}

// ── 单个 artifact 处理 ────────────────────────────────────────
function processOneArtifact(filePath, options) {
  const fileName = path.basename(filePath);
  console.log(`\n处理: ${fileName}`);

  const raw = readJsonFile(filePath);
  const utterances = raw.utterances;
  if (!Array.isArray(utterances) || utterances.length === 0) {
    console.warn(`  跳过: 无 utterances`);
    return;
  }

  // 防御性排序：按 startMs 升序
  const sorted = [...utterances].sort((a, b) => (a.startMs ?? 0) - (b.startMs ?? 0));

  const segments = segmentUtterances(sorted, options);
  console.log(`  分段数: ${segments.length}`);

  // 从 artifact 文件名提取短名称，用于输出文件前缀
  const shortName = fileName
    .replace(/^local_full_/, '')
    .replace(/\.utterances\.json$/, '');
  const safePrefix = sanitizeFileName(shortName);

  // 仅在 --force 模式下清理旧文件，避免参数变化后残留陈旧 segment
  if (options.force) {
    cleanOldSegments(safePrefix);
  }

  // 写入 segment 文件
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const segId = String(i).padStart(2, '0');
    const outputName = `local_${safePrefix}_seg${segId}.json`;

    const outputPath = path.join(SEGMENT_DIR, outputName);
    if (!options.force && fs.existsSync(outputPath)) {
      console.log(`  跳过已有: ${outputName}（用 --force 覆盖）`);
      continue;
    }

    const output = {
      sourceArtifact: fileName,
      segmentIndex: i,
      utterances: seg.utterances,
      meta: seg.meta,
    };

    fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`);
  }

  // 写入 manifest
  writeManifest(fileName, safePrefix, segments);
}

/** 清理该 artifact 前缀对应的旧 segment 和 manifest 文件 */
function cleanOldSegments(safePrefix) {
  const prefix = `local_${safePrefix}_`;
  const existing = fs.readdirSync(SEGMENT_DIR);
  for (const name of existing) {
    if (name.startsWith(prefix) && (name.includes('_seg') || name.includes('_manifest'))) {
      fs.unlinkSync(path.join(SEGMENT_DIR, name));
    }
  }
}

// ── 分段算法 ──────────────────────────────────────────────────
/**
 * 确定性分段：
 * 1. 按 gap > threshold 硬分割
 * 2. 超 max 的段在内部最大 gap 处再切一刀
 * 3. 太短的段尝试与前一回合并
 * 4. 噪声 utterance 不参与分段计算
 */
function segmentUtterances(sorted, options) {
  const gapThreshold = options.gapMs;
  const minDuration = options.minDurationMs;
  const maxDuration = options.maxDurationMs;

  // 标记噪声 utterance
  const annotated = sorted.map((utt) => ({
    utt,
    isNoise: isNoiseUtterance(utt.text),
  }));

  // 第一步：按 gap 硬分割
  let rawSegments = splitByGap(annotated, gapThreshold);

  // 第二步：超长段内部再切
  rawSegments = splitOversized(rawSegments, maxDuration, gapThreshold);

  // 第三步：太短的段尝试合并到前一段
  rawSegments = mergeUndersized(rawSegments, minDuration, maxDuration);

  // 生成 meta 信息
  return rawSegments.map((seg, index) => buildSegmentMeta(seg, index, rawSegments, sorted));
}

/**
 * 按 gap > threshold 硬分割。
 * 噪声 utterance 不参与 gap 计算，但仍归入当前段。
 */
function splitByGap(annotated, gapThreshold) {
  if (annotated.length === 0) return [];

  const segments = [];
  let current = [annotated[0]];

  for (let i = 1; i < annotated.length; i++) {
    const prev = current[current.length - 1];
    const curr = annotated[i];

    // 只有两个都不是噪声时才计算 gap
    const gap = !prev.isNoise && !curr.isNoise
      ? (curr.utt.startMs ?? 0) - (prev.utt.endMs ?? 0)
      : 0;

    if (gap > gapThreshold) {
      segments.push(current);
      current = [curr];
    } else {
      current.push(curr);
    }
  }

  if (current.length > 0) {
    segments.push(current);
  }

  return segments;
}

/**
 * 对超过 maxDuration 的段，在段内找最大 gap 处再切一刀。
 * 递归处理直到所有段都 <= maxDuration。
 */
function splitOversized(segments, maxDuration, gapThreshold) {
  const result = [];

  for (const seg of segments) {
    const duration = computeDuration(seg);
    if (duration <= maxDuration) {
      result.push(seg);
      continue;
    }

    // 在段内找最大非噪声 gap
    const splitIndex = findLargestGapIndex(seg);
    if (splitIndex === -1) {
      // 无合适 gap，强制在中间位置平分
      const mid = Math.floor(seg.length / 2);
      if (mid > 0) {
        result.push(seg.slice(0, mid));
        result.push(seg.slice(mid));
      } else {
        result.push(seg);
      }
    } else {
      result.push(seg.slice(0, splitIndex + 1));
      result.push(seg.slice(splitIndex + 1));
    }
  }

  // 如果切分后仍有超长段，递归处理
  const hasOversized = result.some((seg) => computeDuration(seg) > maxDuration);
  if (hasOversized) {
    return splitOversized(result, maxDuration, gapThreshold);
  }

  return result;
}

/**
 * 找到段内最大的非噪声 gap 位置，返回该 gap 前一个 utterance 的索引。
 * 返回 -1 表示没有可用 gap（段内所有 utterance 连续）。
 */
function findLargestGapIndex(seg) {
  let maxGap = 0;
  let maxIndex = -1;

  for (let i = 0; i < seg.length - 1; i++) {
    const prev = seg[i];
    const curr = seg[i + 1];
    if (prev.isNoise || curr.isNoise) continue;

    const gap = (curr.utt.startMs ?? 0) - (prev.utt.endMs ?? 0);
    if (gap > maxGap) {
      maxGap = gap;
      maxIndex = i;
    }
  }

  return maxIndex;
}

/**
 * 将过短的段与前一回合并，除非合并后超过 maxDuration。
 * 最后一段如果是短的，保持不合并。
 */
function mergeUndersized(segments, minDuration, maxDuration) {
  if (segments.length <= 1) return segments;

  const result = [segments[0]];

  for (let i = 1; i < segments.length; i++) {
    const prev = result[result.length - 1];
    const curr = segments[i];
    const currDuration = computeDuration(curr);

    // 当前段不短，直接保留
    if (currDuration >= minDuration) {
      result.push(curr);
      continue;
    }

    // 尝试与前一回合并
    const mergedDuration = computeMergedDuration(prev, curr);
    if (mergedDuration <= maxDuration) {
      result[result.length - 1] = [...prev, ...curr];
    } else {
      result.push(curr);
    }
  }

  return result;
}

// ── 辅助函数 ──────────────────────────────────────────────────

/** 判断 utterance 是否为噪声：去除空白后 < 2 字符且不含中文/英文字符 */
function isNoiseUtterance(text) {
  if (!text) return true;
  const trimmed = text.replace(/\s/g, '');
  if (trimmed.length >= 2) return false;
  // 含中文或英文字符则不视为噪声
  if (/[\p{Script=Han}a-zA-Z]/u.test(trimmed)) return false;
  return true;
}

/** 计算一个段的时长（最后一个 utt.endMs - 第一个 utt.startMs） */
function computeDuration(annotatedSeg) {
  if (annotatedSeg.length === 0) return 0;
  const first = annotatedSeg[0].utt.startMs ?? 0;
  const last = annotatedSeg[annotatedSeg.length - 1].utt.endMs ?? 0;
  return Math.max(0, last - first);
}

/** 计算两段合并后的时长 */
function computeMergedDuration(segA, segB) {
  if (segA.length === 0 && segB.length === 0) return 0;
  const first = segA.length > 0
    ? (segA[0].utt.startMs ?? 0)
    : (segB[0].utt.startMs ?? 0);
  const last = segB.length > 0
    ? (segB[segB.length - 1].utt.endMs ?? 0)
    : (segA[segA.length - 1].utt.endMs ?? 0);
  return Math.max(0, last - first);
}

/** 为分段构建 meta 信息 */
function buildSegmentMeta(seg, index, allSegments, allSorted) {
  const utterances = seg.map((a) => a.utt);
  const startMs = utterances[0].startMs ?? 0;
  const endMs = utterances[utterances.length - 1].endMs ?? 0;
  const durationMs = Math.max(0, endMs - startMs);

  // gapBeforeMs：当前段与前一段之间的间隔
  let gapBeforeMs = null;
  if (index > 0) {
    const prevSeg = allSegments[index - 1];
    const prevEnd = prevSeg[prevSeg.length - 1].utt.endMs ?? 0;
    gapBeforeMs = startMs - prevEnd;
  }

  // gapAfterMs：当前段与后一段之间的间隔
  let gapAfterMs = null;
  if (index < allSegments.length - 1) {
    const nextSeg = allSegments[index + 1];
    const nextStart = nextSeg[0].utt.startMs ?? 0;
    gapAfterMs = nextStart - endMs;
  }

  return {
    utterances,
    meta: {
      durationMs,
      utteranceCount: utterances.length,
      startMs,
      endMs,
      gapBeforeMs,
      gapAfterMs,
    },
  };
}

// ── Manifest ──────────────────────────────────────────────────
function writeManifest(fileName, safePrefix, segments) {
  const manifest = {
    sourceArtifact: fileName,
    segmentCount: segments.length,
    generatedAt: new Date().toISOString(),
    segments: segments.map((seg, i) => {
      const segId = `seg${String(i).padStart(2, '0')}`;
      const utterances = seg.utterances;
      const note = deriveSegmentNote(utterances);
      return {
        id: segId,
        keep: true,
        mergeWithNext: false,
        note,
      };
    }),
  };

  const manifestName = `local_${safePrefix}_manifest.json`;
  const manifestPath = path.join(SEGMENT_DIR, manifestName);
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`  写入 manifest: ${manifestName}（${segments.length} 段）`);
}

/** 为 manifest 中的每个段生成简短备注 */
function deriveSegmentNote(utterances) {
  if (utterances.length === 0) return '空段';

  // 检查是否全部为噪声
  const allNoise = utterances.every((u) => isNoiseUtterance(u.text));
  if (allNoise) return '纯噪声';

  // 检查是否大部分为短 utterance（可能是掌声/笑声区域）
  const shortCount = utterances.filter((u) => (u.text ?? '').replace(/\s/g, '').length < 4).length;
  const ratio = shortCount / utterances.length;
  if (ratio >= 0.8 && utterances.length >= 3) return '多为短片段';

  return '';
}

// ── 文件名清理 ────────────────────────────────────────────────
function sanitizeFileName(value) {
  return value.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
}

// ── JSON 读取 ─────────────────────────────────────────────────
function readJsonFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  try {
    return JSON.parse(content);
  } catch (err) {
    throw new Error(`JSON 解析失败 (${path.basename(filePath)}): ${err.message}`);
  }
}

// ── CLI 参数解析 ──────────────────────────────────────────────
function parseArgs(argv) {
  const options = {
    input: null,
    gapMs: DEFAULT_GAP_MS,
    minDurationMs: DEFAULT_MIN_DURATION_MS,
    maxDurationMs: DEFAULT_MAX_DURATION_MS,
    force: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const cur = argv[i];
    switch (cur) {
      case '--input':
        options.input = requireValue(argv, ++i, '--input');
        break;
      case '--gap': {
        const val = Number(requireValue(argv, ++i, '--gap'));
        if (!Number.isFinite(val) || val <= 0) throw new Error('--gap 必须为正整数（毫秒）');
        options.gapMs = val;
        break;
      }
      case '--min-duration': {
        const val = Number(requireValue(argv, ++i, '--min-duration'));
        if (!Number.isFinite(val) || val <= 0) throw new Error('--min-duration 必须为正整数（毫秒）');
        options.minDurationMs = val;
        break;
      }
      case '--max-duration': {
        const val = Number(requireValue(argv, ++i, '--max-duration'));
        if (!Number.isFinite(val) || val <= 0) throw new Error('--max-duration 必须为正整数（毫秒）');
        options.maxDurationMs = val;
        break;
      }
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

  if (options.minDurationMs >= options.maxDurationMs) {
    throw new Error('--min-duration 必须小于 --max-duration');
  }

  return options;
}

function requireValue(argv, index, flag) {
  const value = argv[index];
  if (!value) throw new Error(`${flag} 需要一个值`);
  return value;
}

function printHelp() {
  console.log(`将 local ASR artifact 按 silence gap 分段。

用法:
  node scripts/segment-local-artifacts.mjs [选项]

选项:
  --input <file>        指定单个 artifact 文件路径（绝对或相对于 artifacts 目录）
                        默认处理所有 local_full_*.utterances.json
  --gap <ms>            间隔阈值，超过此值视为分段点（默认 ${DEFAULT_GAP_MS}）
  --min-duration <ms>   最短分段时长，短于此值会尝试合并到前一段（默认 ${DEFAULT_MIN_DURATION_MS}）
  --max-duration <ms>   最长分段时长，超过此值会在段内最大 gap 处再切（默认 ${DEFAULT_MAX_DURATION_MS}）
  --force               覆盖已有的 segment 文件
  --help                显示此帮助

输出:
  artifacts/segments/local_<name>_seg<NN>.json   — 分段 utterance 文件
  artifacts/segments/local_<name>_manifest.json  — 分段清单

前提:
  先运行 node scripts/run-local-asr-for-artifacts.mjs 生成 local artifact。
`);
}
