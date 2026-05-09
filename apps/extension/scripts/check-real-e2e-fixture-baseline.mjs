import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const extensionRoot = path.resolve(__dirname, '..');
const fixtureRoot = path.join(extensionRoot, 'e2e', 'fixtures');
const manifestPath = path.join(fixtureRoot, 'fixture-manifest.json');

main();

function main() {
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Fixture manifest not found: ${manifestPath}`);
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  const failures = [];
  const warnings = [];

  if (manifest.fixtureSetId !== 'local-bridge-baseline-v1') {
    failures.push('fixtureSetId must be "local-bridge-baseline-v1"');
  }

  if (!Array.isArray(manifest.provenance?.sourceFiles) || manifest.provenance.sourceFiles.length === 0) {
    failures.push('provenance.sourceFiles must be a non-empty array');
  }

  if (!Array.isArray(manifest.baselineNotes) || manifest.baselineNotes.length < 2) {
    failures.push('baselineNotes should describe why this fixture is a long-term baseline');
  }

  if (!Array.isArray(manifest.chunks) || manifest.chunks.length < 4) {
    failures.push('chunks must contain at least 4 audio entries');
  }

  const chunkDurations = [];
  for (const [index, chunk] of (manifest.chunks ?? []).entries()) {
    if (typeof chunk.url !== 'string' || chunk.url.trim().length === 0) {
      failures.push(`chunk[${index}] is missing url`);
      continue;
    }

    const audioPath = path.join(fixtureRoot, chunk.url.replace(/^\//, '').replaceAll('/', path.sep));
    if (!fs.existsSync(audioPath)) {
      failures.push(`chunk[${index}] audio file does not exist: ${audioPath}`);
      continue;
    }

    const wavInfo = readPcmWavInfo(audioPath);
    if (!wavInfo) {
      failures.push(`chunk[${index}] is not a supported PCM WAV: ${audioPath}`);
      continue;
    }

    if (wavInfo.channels !== 1) {
      failures.push(`chunk[${index}] must be mono, received ${wavInfo.channels}`);
    }

    if (wavInfo.sampleRate !== 16000) {
      failures.push(`chunk[${index}] must be 16kHz, received ${wavInfo.sampleRate}`);
    }

    if (wavInfo.bitsPerSample !== 16) {
      failures.push(`chunk[${index}] must be 16-bit PCM, received ${wavInfo.bitsPerSample}`);
    }

    const declaredDurationMs = Math.max(0, (chunk.endMs ?? 0) - (chunk.startMs ?? 0));
    chunkDurations.push(declaredDurationMs);
    const actualDurationMs = Math.round((wavInfo.sampleCount / wavInfo.sampleRate) * 1000);
    const deltaMs = Math.abs(actualDurationMs - declaredDurationMs);
    if (deltaMs > 1500) {
      warnings.push(
        `chunk[${index}] declared duration ${declaredDurationMs}ms differs from wav duration ${actualDurationMs}ms by ${deltaMs}ms`,
      );
    }
  }

  const totalDeclaredDurationMs = chunkDurations.reduce((sum, value) => sum + value, 0);
  if (totalDeclaredDurationMs < 12000) {
    failures.push('total declared fixture duration is too short for a stable real E2E baseline');
  }

  if ((manifest.realAcceptance?.minTranscriptChunks ?? 0) < 1) {
    failures.push('realAcceptance.minTranscriptChunks must be >= 1');
  }

  if ((manifest.realAcceptance?.minGraphNodes ?? 0) < 1) {
    failures.push('realAcceptance.minGraphNodes must be >= 1');
  }

  if ((manifest.realAcceptance?.minKeywordGroupHits ?? 0) < 2) {
    failures.push('realAcceptance.minKeywordGroupHits must be >= 2');
  }

  const keywordGroups = manifest.realAcceptance?.keywordGroups;
  if (!Array.isArray(keywordGroups) || keywordGroups.length < 3) {
    failures.push('realAcceptance.keywordGroups must contain at least 3 keyword groups');
  } else {
    for (const [index, group] of keywordGroups.entries()) {
      if (!Array.isArray(group) || group.length === 0) {
        failures.push(`realAcceptance.keywordGroups[${index}] must be a non-empty array`);
      }
    }
  }

  if (!manifest.verification?.staticCommand || !manifest.verification?.runtimeCommands) {
    failures.push('verification.staticCommand and verification.runtimeCommands are required');
  }

  if (failures.length > 0) {
    console.error('Real E2E fixture baseline check failed:');
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  console.log(`Real E2E fixture baseline OK: ${manifest.fixtureSetId}`);
  console.log(`- chunks: ${manifest.chunks.length}`);
  console.log(`- declared duration: ${totalDeclaredDurationMs}ms`);
  console.log(`- keyword groups: ${keywordGroups.length}`);
  if (warnings.length > 0) {
    console.log('Warnings:');
    for (const warning of warnings) {
      console.log(`- ${warning}`);
    }
  }
}

function readPcmWavInfo(filePath) {
  const buffer = fs.readFileSync(filePath);
  if (buffer.length < 44) {
    return null;
  }

  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    return null;
  }

  let offset = 12;
  let channels = null;
  let sampleRate = null;
  let bitsPerSample = null;
  let dataSize = null;

  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString('ascii', offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const chunkBodyStart = offset + 8;
    const chunkBodyEnd = chunkBodyStart + chunkSize;

    if (chunkBodyEnd > buffer.length) {
      return null;
    }

    if (chunkId === 'fmt ') {
      const audioFormat = buffer.readUInt16LE(chunkBodyStart);
      channels = buffer.readUInt16LE(chunkBodyStart + 2);
      sampleRate = buffer.readUInt32LE(chunkBodyStart + 4);
      bitsPerSample = buffer.readUInt16LE(chunkBodyStart + 14);
      if (audioFormat !== 1) {
        return null;
      }
    }

    if (chunkId === 'data') {
      dataSize = chunkSize;
    }

    offset = chunkBodyEnd + (chunkSize % 2);
  }

  if (
    channels == null ||
    sampleRate == null ||
    bitsPerSample == null ||
    dataSize == null ||
    bitsPerSample <= 0
  ) {
    return null;
  }

  const bytesPerSample = bitsPerSample / 8;
  const sampleCount = dataSize / bytesPerSample / channels;

  return {
    channels,
    sampleRate,
    bitsPerSample,
    sampleCount,
  };
}
