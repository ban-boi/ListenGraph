import { describe, expect, it } from 'vitest';

import { installFixtureSequenceDev } from './fixture-sequence-dev';
import type { FixtureLabDeps } from './fixture-sequence-controller';

function makeDeps(): FixtureLabDeps {
  return {
    dispatch: () => undefined,
    graphRef: { current: null as never },
    activeViewSessionRef: { current: null },
    addLog: () => undefined,
    setAutoTourSeed: () => undefined,
    onFixtureLabReset: () => undefined,
  };
}

describe('fixture sequence DEV registry', () => {
  it('lists semantic pattern fixtures', () => {
    const previousApi = globalThis.__listenGraphicFixture;

    try {
      installFixtureSequenceDev({ current: makeDeps() });

      expect(globalThis.__listenGraphicFixture?.list()).toEqual(
        expect.arrayContaining([
          'seq-incremental-growth',
          'seq-late-burst',
          'seq-view-switch-mid',
          'seq-pattern-question-three-points',
          'seq-pattern-claim-reason-example',
          'seq-pattern-opposition',
          'seq-pattern-causal-chain',
          'seq-pattern-timeline-note',
        ]),
      );
    } finally {
      globalThis.__listenGraphicFixture = previousApi;
    }
  });
});
