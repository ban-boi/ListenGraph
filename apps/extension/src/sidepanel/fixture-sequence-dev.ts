import type { RefObject } from 'react';
import type { SequenceFixture } from '@listen-graphic/graph-fixtures/types';

import seqIncremental from '../../../../packages/graph-fixtures/fixtures/sequences/seq-incremental-growth.json';
import seqLateBurst from '../../../../packages/graph-fixtures/fixtures/sequences/seq-late-burst.json';
import seqViewSwitchMid from '../../../../packages/graph-fixtures/fixtures/sequences/seq-view-switch-mid.json';
import seqPatternCausalChain from '../../../../packages/graph-fixtures/fixtures/sequences/seq-pattern-causal-chain.json';
import seqPatternClaimReasonExample from '../../../../packages/graph-fixtures/fixtures/sequences/seq-pattern-claim-reason-example.json';
import seqPatternOpposition from '../../../../packages/graph-fixtures/fixtures/sequences/seq-pattern-opposition.json';
import seqPatternQuestionThreePoints from '../../../../packages/graph-fixtures/fixtures/sequences/seq-pattern-question-three-points.json';
import seqPatternTimelineNote from '../../../../packages/graph-fixtures/fixtures/sequences/seq-pattern-timeline-note.json';

import {
  createFixtureSequenceController,
  type FixtureLabDeps,
} from './fixture-sequence-controller';

const SEQUENCE_MAP: Record<string, SequenceFixture> = {
  'seq-incremental-growth': seqIncremental as SequenceFixture,
  'seq-late-burst': seqLateBurst as SequenceFixture,
  'seq-view-switch-mid': seqViewSwitchMid as SequenceFixture,
  'seq-pattern-question-three-points': seqPatternQuestionThreePoints as SequenceFixture,
  'seq-pattern-claim-reason-example': seqPatternClaimReasonExample as SequenceFixture,
  'seq-pattern-opposition': seqPatternOpposition as SequenceFixture,
  'seq-pattern-causal-chain': seqPatternCausalChain as SequenceFixture,
  'seq-pattern-timeline-note': seqPatternTimelineNote as SequenceFixture,
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
