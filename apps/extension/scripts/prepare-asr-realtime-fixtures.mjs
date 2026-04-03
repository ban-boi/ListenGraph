import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(packageRoot, '..', '..');
const defaultSourceDir = path.resolve(repoRoot, 'raw_audio&text');
const defaultFixtureDir = path.resolve(
  packageRoot,
  'src',
  'service-worker',
  'fixtures',
  'asr-realtime',
);
const defaultAudioDir = path.resolve(defaultFixtureDir, 'audio', 'generated');
const defaultClipDurationMs = 120_000;

main();

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const sourceDir = path.resolve(packageRoot, options.sourceDir ?? defaultSourceDir);
  const fixtureDir = path.resolve(packageRoot, options.fixtureDir ?? defaultFixtureDir);
  const audioDir = path.resolve(packageRoot, options.audioDir ?? defaultAudioDir);
  const clipDurationMs = options.clipSeconds <= 0 ? undefined : options.clipSeconds * 1000;

  if (!fs.existsSync(sourceDir)) {
    throw new Error(`Source directory not found: ${sourceDir}`);
  }

  const items = collectSourceItems(sourceDir);
  if (items.length === 0) {
    throw new Error(`No .mp3 or .wav files found under ${sourceDir}`);
  }

  const needsFfmpeg = items.some((item) => {
    if (item.audioExt !== '.mp3') {
      return false;
    }
    const outputAudioPath = path.join(audioDir, `${sanitizeFileName(item.baseName)}.wav`);
    return options.force || !fs.existsSync(outputAudioPath);
  });
  const ffmpegBinary = options.ffmpegPath ?? process.env.FFMPEG_PATH ?? findFfmpegBinary();
  if (needsFfmpeg && !ffmpegBinary && !options.dryRun) {
    throw new Error(
      [
        'MP3 source files were found, but ffmpeg is not available.',
        'Install ffmpeg and add it to PATH, or rerun with --ffmpeg <path-to-ffmpeg>.',
        'You can preview the planned conversions with --dry-run.',
      ].join(' '),
    );
  }

  fs.mkdirSync(fixtureDir, { recursive: true });
  fs.mkdirSync(audioDir, { recursive: true });

  const summary = [];
  for (const item of items) {
    const audioOutputPath = path.join(audioDir, `${sanitizeFileName(item.baseName)}.wav`);
    if (!options.dryRun) {
      prepareAudioAsset(item, audioOutputPath, {
        ffmpegBinary,
        overwrite: options.force,
      });
    }

    const generated = buildGeneratedFixture(item, {
      sourceDir,
      fixtureDir,
      audioDir,
      audioOutputPath,
      clipDurationMs,
    });

    const shouldWriteFixture = options.force || !fs.existsSync(generated.fixtureFilePath);
    if (!options.dryRun && shouldWriteFixture) {
      fs.writeFileSync(generated.fixtureFilePath, `${JSON.stringify(generated.fixture, null, 2)}\n`);
    }

    summary.push({
      sourceAudio: path.relative(repoRoot, item.audioPath),
      sourceText: item.textPath ? path.relative(repoRoot, item.textPath) : null,
      targetAudio: path.relative(repoRoot, generated.audioOutputPath),
      targetFixture: path.relative(repoRoot, generated.fixtureFilePath),
      anchors: generated.fixture.acceptance.mustContainTexts ?? [],
      fixturePreserved: !shouldWriteFixture,
    });
  }

  const modeLabel = options.dryRun ? 'Dry run' : 'Prepared';
  console.log(`${modeLabel} ${summary.length} ASR realtime fixture(s).`);
  for (const item of summary) {
    console.log(`- audio: ${item.sourceAudio}`);
    if (item.sourceText) {
      console.log(`  text: ${item.sourceText}`);
    }
    console.log(`  wav: ${item.targetAudio}`);
    console.log(`  fixture: ${item.targetFixture}`);
    if (item.fixturePreserved) {
      console.log('  fixture status: preserved existing curated JSON');
    }
    if (item.anchors.length > 0) {
      console.log(`  anchors: ${item.anchors.join(' | ')}`);
    }
  }
}

function parseArgs(argv) {
  const options = {
    sourceDir: undefined,
    fixtureDir: undefined,
    audioDir: undefined,
    ffmpegPath: undefined,
    clipSeconds: defaultClipDurationMs / 1000,
    force: false,
    dryRun: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    switch (current) {
      case '--source':
        options.sourceDir = requireValue(argv, ++index, '--source');
        break;
      case '--fixture-dir':
        options.fixtureDir = requireValue(argv, ++index, '--fixture-dir');
        break;
      case '--audio-dir':
        options.audioDir = requireValue(argv, ++index, '--audio-dir');
        break;
      case '--ffmpeg':
        options.ffmpegPath = requireValue(argv, ++index, '--ffmpeg');
        break;
      case '--clip-seconds':
        options.clipSeconds = parseNonNegativeInteger(
          requireValue(argv, ++index, '--clip-seconds'),
          '--clip-seconds',
        );
        break;
      case '--force':
        options.force = true;
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${current}`);
    }
  }

  return options;
}

function requireValue(argv, index, flag) {
  const value = argv[index];
  if (!value) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function printHelp() {
  console.log(`Prepare raw mp3/txt assets for Tencent realtime ASR real tests.

Usage:
  pnpm --filter extension prepare:asr:real -- [options]

Options:
  --source <dir>       Source directory. Default: ../../raw_audio&text
  --fixture-dir <dir>  Output fixture directory
  --audio-dir <dir>    Output wav directory
  --ffmpeg <path>      Explicit ffmpeg binary path
  --clip-seconds <n>   Limit each generated fixture to the first N seconds. Default: 120
  --force              Rebuild wav output even if it already exists
  --dry-run            Print planned outputs without writing files
  --help               Show this message
`);
}

function collectSourceItems(sourceDir) {
  return fs
    .readdirSync(sourceDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => /\.(mp3|wav)$/i.test(name))
    .sort((left, right) => left.localeCompare(right, 'zh-CN'))
    .map((audioName) => {
      const parsed = path.parse(audioName);
      const textPath = path.join(sourceDir, `${parsed.name}.txt`);
      return {
        baseName: parsed.name,
        audioExt: parsed.ext.toLowerCase(),
        audioPath: path.join(sourceDir, audioName),
        textPath: fs.existsSync(textPath) ? textPath : null,
      };
    });
}

function buildGeneratedFixture(item, paths) {
  const safeBaseName = sanitizeFileName(item.baseName);
  const fixtureFilePath = path.join(paths.fixtureDir, `generated-${safeBaseName}.json`);
  const transcriptText = item.textPath ? fs.readFileSync(item.textPath, 'utf-8') : '';
  const transcriptWindow = selectTranscriptWindow(
    transcriptText,
    paths.audioOutputPath,
    paths.clipDurationMs,
  );
  const maxAnchorCount = paths.clipDurationMs ? 2 : 3;
  const anchors = extractAnchorPhrases(transcriptWindow, maxAnchorCount);
  const acceptance = {
    minStableUtterances: paths.clipDurationMs ? Math.min(2, Math.max(1, anchors.length)) : anchors.length >= 3 ? 3 : 1,
  };
  if (anchors.length > 0) {
    acceptance.mustContainTexts = anchors;
  }

  const fixture = {
    name: `generated:${item.baseName}`,
    audioFile: normalizeSlashes(path.relative(paths.fixtureDir, paths.audioOutputPath)),
    audioClipDurationMs: paths.clipDurationMs,
    generatedFrom: {
      sourceAudioFile: normalizeSlashes(path.relative(repoRoot, item.audioPath)),
      sourceTextFile: item.textPath ? normalizeSlashes(path.relative(repoRoot, item.textPath)) : undefined,
    },
    acceptance,
    notes: [
      'Generated from raw_audio&text by prepare-asr-realtime-fixtures.mjs.',
      'Review generated anchors after the first real ASR run and tighten them if needed.',
    ],
  };

  return {
    audioOutputPath: paths.audioOutputPath,
    fixtureFilePath,
    fixture,
  };
}

function prepareAudioAsset(item, outputPath, options) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  if (!options.overwrite && fs.existsSync(outputPath)) {
    return;
  }

  if (item.audioExt === '.wav') {
    fs.copyFileSync(item.audioPath, outputPath);
    return;
  }

  if (item.audioExt !== '.mp3') {
    throw new Error(`Unsupported audio extension: ${item.audioExt}`);
  }

  if (!options.ffmpegBinary) {
    throw new Error(`ffmpeg is required to convert ${item.audioPath}`);
  }

  const result = spawnSync(
    options.ffmpegBinary,
    ['-y', '-i', item.audioPath, '-ac', '1', '-ar', '16000', '-f', 'wav', outputPath],
    {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  if (result.status !== 0) {
    const stderr = (result.stderr || '').trim();
    throw new Error(
      `ffmpeg failed while converting ${item.audioPath}: ${stderr || `exit code ${result.status}`}`,
    );
  }
}

function extractAnchorPhrases(transcriptText, maxAnchorCount = 3) {
  const normalizedSentences = transcriptText
    .split(/[\r\n。！？!?；;]+/u)
    .map((sentence, index) => ({
      index,
      sentence: normalizeSentence(sentence),
    }))
    .filter((entry) => entry.sentence.length >= 12 && entry.sentence.length <= 48)
    .filter((entry) => /[\p{Script=Han}A-Za-z0-9]/u.test(entry.sentence));

  const uniqueSentences = [];
  const seen = new Set();
  for (const entry of normalizedSentences) {
    if (seen.has(entry.sentence)) {
      continue;
    }
    seen.add(entry.sentence);
    uniqueSentences.push(entry);
  }

  if (uniqueSentences.length === 0) {
    return [];
  }

  const ranked = uniqueSentences
    .map((entry) => ({
      ...entry,
      score: scoreSentence(entry.sentence),
      anchor: toAnchor(entry.sentence),
    }))
    .sort((left, right) => right.score - left.score);

  const selected = [];
  for (const candidate of ranked) {
    const overlapsExisting = selected.some(
      (entry) =>
        entry.anchor.includes(candidate.anchor) || candidate.anchor.includes(entry.anchor),
    );
    if (overlapsExisting) {
      continue;
    }
    selected.push(candidate);
    if (selected.length >= maxAnchorCount) {
      break;
    }
  }

  return selected
    .sort((left, right) => left.index - right.index)
    .map((entry) => entry.anchor)
    .filter((anchor) => anchor.length >= 6);
}

function selectTranscriptWindow(transcriptText, audioOutputPath, clipDurationMs) {
  if (!transcriptText || !clipDurationMs || !fs.existsSync(audioOutputPath)) {
    return transcriptText;
  }

  const totalDurationMs = getApproximateWavDurationMs(audioOutputPath);
  if (!totalDurationMs || totalDurationMs <= 0) {
    return transcriptText;
  }

  const ratio = Math.min(1, clipDurationMs / totalDurationMs);
  const endIndex = Math.max(
    Math.min(transcriptText.length, Math.ceil(transcriptText.length * ratio * 1.25)),
    Math.min(transcriptText.length, 400),
  );
  return transcriptText.slice(0, endIndex);
}

function normalizeSentence(value) {
  return value.replace(/[\s，。、,.!?！？：“”"'‘’（）()【】\[\]《》<>]/gu, '');
}

function toAnchor(sentence) {
  if (sentence.length <= 16) {
    return sentence;
  }
  return sentence.slice(0, 16);
}

function scoreSentence(sentence) {
  const uniqueChars = new Set(sentence).size;
  const hanChars = Array.from(sentence).filter((char) => /\p{Script=Han}/u.test(char)).length;
  const alnumChars = Array.from(sentence).filter((char) => /[A-Za-z0-9]/u.test(char)).length;
  const lengthPenalty = Math.abs(sentence.length - 18);
  return uniqueChars * 2 + hanChars + alnumChars - lengthPenalty;
}

function getApproximateWavDurationMs(audioPath) {
  const stats = fs.statSync(audioPath);
  const bytesPerSecond = 16000 * 2;
  const audioBytes = Math.max(0, stats.size - 44);
  return Math.floor((audioBytes / bytesPerSecond) * 1000);
}

function parseNonNegativeInteger(rawValue, flag) {
  const value = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${flag} must be a non-negative integer`);
  }
  return value;
}

function sanitizeFileName(value) {
  return value.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
}

function normalizeSlashes(value) {
  return value.replace(/\\/g, '/');
}

function findFfmpegBinary() {
  const result = spawnSync('where.exe', ['ffmpeg'], {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  if (result.status !== 0) {
    return null;
  }

  const candidate = (result.stdout || '')
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find(Boolean);

  return candidate || null;
}
