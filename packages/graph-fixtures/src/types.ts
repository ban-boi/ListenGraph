import type { z } from 'zod';

import type { MergedGraph } from '@listen-graphic/schema';

import type {
  fixtureManifestSchema,
  manifestEntrySchema,
  sequenceFixtureSchema,
  regressionCaseSchema,
  regressionManifestSchema,
  hardExpectationsSchema,
  softBaselinesSchema,
  degradationBudgetSchema,
  regressionCaseStatusSchema,
} from './schemas';

export type SequenceFixture = z.infer<typeof sequenceFixtureSchema>;
export type FixtureManifest = z.infer<typeof fixtureManifestSchema>;
export type ManifestEntry = z.infer<typeof manifestEntrySchema>;

export type RegressionCase = z.infer<typeof regressionCaseSchema>;
export type RegressionManifest = z.infer<typeof regressionManifestSchema>;
export type HardExpectations = z.infer<typeof hardExpectationsSchema>;
export type SoftBaselines = z.infer<typeof softBaselinesSchema>;
export type DegradationBudget = z.infer<typeof degradationBudgetSchema>;
export type RegressionCaseStatus = z.infer<typeof regressionCaseStatusSchema>;

export type ValidationReport = {
  ok: boolean;
  errors: string[];
  warnings: string[];
};

export type StepPayload = {
  addedNodeIds: string[];
  anchorNodeIds: string[];
  shouldPreserveView: boolean;
};

export type { MergedGraph };
