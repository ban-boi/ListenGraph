import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageRoot = path.resolve(__dirname, '..');
const asrFixtureDir = path.resolve(packageRoot, 'src', 'service-worker', 'fixtures', 'asr-realtime');
const artifactDir = path.resolve(asrFixtureDir, 'artifacts');
const structureFixtureDir = path.resolve(packageRoot, 'src', 'service-worker', 'fixtures', 'structure');

main();

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  if (!fs.existsSync(asrFixtureDir)) {
    throw new Error(`ASR fixture directory not found: ${asrFixtureDir}`);
  }

  if (!fs.existsSync(artifactDir)) {
    throw new Error(
      `ASR artifact directory not found: ${artifactDir}. Run the realtime ASR test with LISTEN_GRAPHIC_E2E_ASR_WRITE_ARTIFACTS=1 first.`,
    );
  }

  fs.mkdirSync(structureFixtureDir, { recursive: true });

  const asrFixtures = fs
    .readdirSync(asrFixtureDir)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => ({
      fileName: name,
      path: path.join(asrFixtureDir, name),
      raw: JSON.parse(fs.readFileSync(path.join(asrFixtureDir, name), 'utf-8')),
    }))
    .filter((entry) => entry.raw.structureReplay);

  if (asrFixtures.length === 0) {
    throw new Error('No ASR fixtures contain structureReplay metadata.');
  }

  const summary = [];
  for (const entry of asrFixtures) {
    const fixture = entry.raw;
    const replayName = fixture.structureReplay.name;
    if (options.filter && !replayName.toLowerCase().includes(options.filter)) {
      continue;
    }

    const artifactPath = path.join(artifactDir, `${sanitizeFileName(fixture.name)}.utterances.json`);
    if (!fs.existsSync(artifactPath)) {
      throw new Error(
        `Missing ASR artifact for ${fixture.name}: ${artifactPath}. Re-run realtime ASR with LISTEN_GRAPHIC_E2E_ASR_WRITE_ARTIFACTS=1.`,
      );
    }

    const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf-8'));
    const utterances = Array.isArray(artifact.utterances) ? artifact.utterances : [];
    if (utterances.length === 0) {
      throw new Error(`ASR artifact ${artifactPath} did not contain utterances.`);
    }

    const structureFixture = {
      name: replayName,
      transcripts: utterances.map((utterance, index) => ({
        chunkId: `${sanitizeFileName(replayName)}_${String(index + 1).padStart(2, '0')}`,
        text: utterance.text,
        startMs: utterance.startMs,
        endMs: utterance.endMs,
        raw: {
          source: 'tencent-realtime-replay',
          artifactFixtureName: fixture.name,
          messageId: utterance.messageId,
          voiceId: utterance.voiceId,
        },
      })),
      acceptance: fixture.structureReplay.acceptance,
    };

    const outputPath = path.join(structureFixtureDir, `${replayName}.json`);
    if (options.force || !fs.existsSync(outputPath)) {
      fs.writeFileSync(outputPath, `${JSON.stringify(structureFixture, null, 2)}\n`);
    }

    summary.push({
      replayName,
      outputPath,
      utteranceCount: utterances.length,
      preserved: !options.force && fs.existsSync(outputPath) && !options.overwroteByDefault,
    });
  }

  console.log(`Prepared ${summary.length} structure replay fixture(s).`);
  for (const item of summary) {
    console.log(`- ${item.replayName}`);
    console.log(`  file: ${path.relative(packageRoot, item.outputPath)}`);
    console.log(`  utterances: ${item.utteranceCount}`);
  }
}

function parseArgs(argv) {
  const options = {
    force: false,
    help: false,
    filter: '',
    overwroteByDefault: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    switch (current) {
      case '--force':
        options.force = true;
        break;
      case '--filter':
        options.filter = requireValue(argv, ++index, '--filter').trim().toLowerCase();
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
  console.log(`Build structure replay fixtures from recorded Tencent realtime ASR artifacts.

Usage:
  pnpm --filter extension prepare:structure:replay -- [options]

Options:
  --filter <text>  Only rebuild replay fixtures whose name contains the text
  --force          Overwrite existing replay fixtures
  --help           Show this message
`);
}

function sanitizeFileName(value) {
  return value.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
}
