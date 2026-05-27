import type { z } from 'zod';

import type { MergedGraph } from '@listen-graphic/schema';

import type {
  fixtureManifestSchema,
  manifestEntrySchema,
  sequenceFixtureSchema,
} from './schemas';

export type SequenceFixture = z.infer<typeof sequenceFixtureSchema>;
export type FixtureManifest = z.infer<typeof fixtureManifestSchema>;
export type ManifestEntry = z.infer<typeof manifestEntrySchema>;

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
