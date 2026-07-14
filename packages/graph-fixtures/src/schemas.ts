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

export const visualExpectationSchema = z.object({
  rootNode: z.string().optional(),
  branchNodes: z.array(z.string()).optional(),
  chainNodes: z.array(z.string()).optional(),
  layout: z
    .enum(['fanout', 'support-chain', 'opposition', 'causal-chain', 'timeline-note'])
    .optional(),
  noOverlap: z.boolean().optional(),
  edgeHandlesReasonable: z.boolean().optional(),
  autoTourReadable: z.boolean().optional(),
});

export const sequenceFixtureSchema = z.object({
  id: z.string(),
  kind: z.literal('sequence'),
  description: z.string(),
  sessionId: z.string(),
  visualExpectations: visualExpectationSchema.optional(),
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

// ── 回归 Case Schema ──

/** 硬约束：必须通过 */
export const hardExpectationsSchema = z.object({
  /** 真实几何重叠对数上限（通常为 0） */
  physicalOverlapPairs: z.number().int().nonnegative().default(0),
  /** 净距不足阈值的对数上限（通常为 0） */
  clearanceViolationPairs: z.number().int().nonnegative().default(0),
  /** 坐标必须有效（无 NaN/Infinity），始终为 true */
  coordinateValidity: z.literal(true).default(true),
  /** 画布宽度上限（px），防止横向溢出 */
  maxCanvasWidthPx: z.number().positive().optional(),
  /** 宽高比上限，防止过度横向扩展 */
  maxAspectRatio: z.number().positive().optional(),
  /** P95 边长上限（px） */
  maxP95EdgeLength: z.number().positive().optional(),
  /** 最小净距（px） */
  minClearancePx: z.number().nonnegative().optional(),
});

/** 软指标基线：由 accept-baseline 命令显式写入 */
export const softBaselinesSchema = z
  .object({
    edgeNodeOcclusions: z.number().int().nonnegative(),
    edgeEdgeCrossings: z.number().int().nonnegative(),
    avgEdgeLength: z.number().nonnegative(),
    p95EdgeLength: z.number().nonnegative(),
    longEdgeRatio: z.number().min(0).max(1),
    canvasWidth: z.number().nonnegative(),
    canvasHeight: z.number().nonnegative(),
    aspectRatio: z.number().nonnegative(),
  })
  .strict();

/** 退化预算：软指标允许的最大退化比例（0-1） */
export const degradationBudgetSchema = z
  .object({
    edgeNodeOcclusions: z.number().min(0).max(1).default(0.15),
    edgeEdgeCrossings: z.number().min(0).max(1).default(0.15),
    avgEdgeLength: z.number().min(0).max(1).default(0.15),
    longEdgeRatio: z.number().min(0).max(1).default(0.15),
    canvasWidth: z.number().min(0).max(1).default(0.2),
  })
  .strict();

/** 回归 case 状态 */
export const regressionCaseStatusSchema = z.enum([
  'candidate', // 刚创建，无基线，必须先失败
  'baselined', // 已 accept-baseline，可作为回归 case
]);

/** 回归 case fixture schema */
export const regressionCaseSchema = z.object({
  id: z.string(),
  kind: z.literal('regression'),
  description: z.string(),
  problemDescription: z.string(),
  split: z.enum(['regression', 'tuning', 'holdout']),
  source: z.string(),
  status: regressionCaseStatusSchema.default('candidate'),
  graph: mergedGraphSchema,
  primaryView: viewTypeSchema.optional(),
  hardExpectations: hardExpectationsSchema.default({}),
  softBaselines: softBaselinesSchema.optional(),
  degradationBudget: degradationBudgetSchema.default({}),
  tags: z.array(z.string()).optional(),
  triggeringNodeIds: z.array(z.string()).optional(),
  triggeringEdgeIds: z.array(z.string()).optional(),
  /** 算法信息（由 accept-baseline 写入） */
  algorithmId: z.string().optional(),
  algorithmVersion: z.string().optional(),
  metricsVersion: z.string().optional(),
  clearancePx: z.number().nonnegative().optional(),
  /** 视觉验收（人工填写） */
  visualChecklist: z
    .object({
      mainLineClear: z.boolean().optional(),
      localRelationsReadable: z.boolean().optional(),
      noScatteredOrOppressive: z.boolean().optional(),
      topicBoundariesClear: z.boolean().optional(),
    })
    .optional(),
  /** 参考截图路径 */
  referenceScreenshot: z.string().optional(),
  /** 人工裁决 */
  humanVerdict: z.enum(['accept', 'reject', 'needs-work']).optional(),
  humanVerdictNote: z.string().optional(),
  humanVerdictAt: z.number().optional(),
});

/** 回归 case manifest（独立于 write-fixtures.mjs） */
export const regressionManifestSchema = z.object({
  version: z.literal(1),
  cases: z.array(manifestEntrySchema),
});
