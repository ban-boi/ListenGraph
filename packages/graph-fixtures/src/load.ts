import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { MergedGraph } from '@listen-graphic/schema';

import { fixtureManifestSchema, mergedGraphSchema, sequenceFixtureSchema } from './schemas';
import type { FixtureManifest, ManifestEntry, SequenceFixture } from './types';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');

let cachedManifest: FixtureManifest | null = null;

function readJsonFile<T>(relativePath: string): T {
  const content = readFileSync(join(fixturesDir, relativePath), 'utf-8');
  return JSON.parse(content) as T;
}

export function getFixturesDir(): string {
  return fixturesDir;
}

export function loadManifest(): FixtureManifest {
  if (!cachedManifest) {
    const raw = readJsonFile<unknown>('manifest.json');
    cachedManifest = fixtureManifestSchema.parse(raw);
  }
  return cachedManifest;
}

export function listSequences(): ManifestEntry[] {
  return loadManifest().sequences;
}

export function listSnapshots(): ManifestEntry[] {
  return loadManifest().snapshots;
}

export function loadSequence(id: string): SequenceFixture {
  const entry = listSequences().find((sequence) => sequence.id === id);
  if (!entry) {
    throw new Error(`Sequence fixture not found: ${id}`);
  }

  const raw = readJsonFile<unknown>(entry.file);
  const fixture = sequenceFixtureSchema.parse(raw);
  if (fixture.id !== id) {
    throw new Error(`Sequence fixture id mismatch: expected ${id}, got ${fixture.id}`);
  }
  return fixture;
}

export function loadSnapshot(id: string): MergedGraph {
  const entry = listSnapshots().find((snapshot) => snapshot.id === id);
  if (!entry) {
    throw new Error(`Snapshot fixture not found: ${id}`);
  }

  const raw = readJsonFile<unknown>(entry.file);
  return mergedGraphSchema.parse(raw);
}
