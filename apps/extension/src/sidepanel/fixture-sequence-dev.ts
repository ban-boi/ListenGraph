import type { RefObject } from 'react';
import type { SequenceFixture } from '@listen-graphic/graph-fixtures/types';

import seqIncremental from '../../../../packages/graph-fixtures/fixtures/sequences/seq-incremental-growth.json';
import seqLateBurst from '../../../../packages/graph-fixtures/fixtures/sequences/seq-late-burst.json';
import seqViewSwitchMid from '../../../../packages/graph-fixtures/fixtures/sequences/seq-view-switch-mid.json';

import {
  createFixtureSequenceController,
  type FixtureLabDeps,
} from './fixture-sequence-controller';

const SEQUENCE_MAP: Record<string, SequenceFixture> = {
  'seq-incremental-growth': seqIncremental as SequenceFixture,
  'seq-late-burst': seqLateBurst as SequenceFixture,
  'seq-view-switch-mid': seqViewSwitchMid as SequenceFixture,
};

export type FixtureLabDepsRef = RefObject<FixtureLabDeps>;

export function installFixtureSequenceDev(depsRef: FixtureLabDepsRef): void {
  if (!import.meta.env.DEV && import.meta.env.VITE_FIXTURE_LAB !== 'true') return;

  const getDeps = () => depsRef.current;

  globalThis.__listenGraphicFixture = createFixtureSequenceController(getDeps, {
    list: () => Object.keys(SEQUENCE_MAP),
    load: (id) => SEQUENCE_MAP[id] ?? null,
  });
}
