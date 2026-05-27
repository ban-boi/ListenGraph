import { describe, it, beforeEach, afterEach } from 'vitest';
import { playSequenceAndAssert } from './graph-fixtures.test-helper';
import {
  reactFlowFitViewSpy,
  setupAppTests,
  teardownAppTests,
} from './__test-helpers__/app-test-helpers';

describe('Fixture sequence lab', () => {
  beforeEach(() => {
    setupAppTests();
    reactFlowFitViewSpy.mockClear();
  });

  afterEach(() => {
    teardownAppTests();
  });

  it('seq-incremental-growth: fitView only on first step with nodes', async () => {
    await playSequenceAndAssert({
      fixtureId: 'seq-incremental-growth',
      assertions: [
        { afterStep: 0, expectFitViewCalls: 1 },
        { afterStep: 3, expectFitViewCalls: 1 },
      ],
    });
  });
});
