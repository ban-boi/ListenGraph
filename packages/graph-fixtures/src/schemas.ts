import { z } from 'zod';

export const nodeTypeSchema = z.enum([
  'claim',
  'reason',
  'example',
  'question',
  'conclusion',
]);

export const edgeTypeSchema = z.enum([
  'supports',
  'opposes',
  'causes',
  'follows',
  'example_of',
]);

export const graphNodeStatusSchema = z.enum(['draft', 'confirmed']);

export const viewTypeSchema = z.enum([
  'timeline',
  'causal',
  'comparison',
  'hierarchy',
]);

export const graphNodeSchema = z.object({
  id: z.string(),
  type: nodeTypeSchema,
  text: z.string(),
  speaker: z.string().optional(),
  timestampMs: z.number(),
  confidence: z.number().optional(),
  status: graphNodeStatusSchema,
  topicId: z.string().optional(),
  evidenceChunkIds: z.array(z.string()).optional(),
});

export const graphEdgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  type: edgeTypeSchema,
  confidence: z.number().optional(),
  evidenceChunkIds: z.array(z.string()).optional(),
});

export const mergedGraphSchema = z.object({
  sessionId: z.string(),
  revision: z.number(),
  topics: z.array(
    z.object({
      topicId: z.string(),
      title: z.string(),
      startMs: z.number(),
      endMs: z.number(),
    }),
  ),
  nodes: z.array(graphNodeSchema),
  edges: z.array(graphEdgeSchema),
  viewHints: z
    .object({
      defaultView: viewTypeSchema.optional(),
      scores: z.record(viewTypeSchema, z.number()).optional(),
    })
    .optional(),
  updatedAt: z.number(),
});

export const sequenceStepSchema = z.object({
  label: z.string(),
  graph: mergedGraphSchema,
});

export const sequenceFixtureSchema = z.object({
  id: z.string(),
  kind: z.literal('sequence'),
  description: z.string(),
  sessionId: z.string(),
  playback: z
    .object({
      preserveView: z.boolean().optional(),
    })
    .optional(),
  steps: z.array(sequenceStepSchema),
});

export const manifestEntrySchema = z.object({
  id: z.string(),
  file: z.string(),
  tags: z.array(z.string()).optional(),
  primaryView: viewTypeSchema.optional(),
  description: z.string().optional(),
});

export const fixtureManifestSchema = z.object({
  version: z.literal(1),
  sequences: z.array(manifestEntrySchema),
  snapshots: z.array(manifestEntrySchema),
});
