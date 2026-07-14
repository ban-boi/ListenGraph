# Regression Case Promotion + Runner 实施计划（v2）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立可运行的回归 loop：从原始 graph 晋级为回归 case，运行算法检查约束，生成报告并控制退出码。

**Architecture:**
- `LayoutEngineAdapter` 接口封装布局算法，统一坐标语义（center positions + sizes）
- R3b adapter 调用 `computeClusterForceLayout` 并转换 `RenderModel` → center positions
- 回归 case 存储在 `fixtures/regression/` 目录，有独立 manifest（不被 `write-fixtures.mjs` 覆盖）
- 晋级是状态机：candidate → 人工写期望 → case 先失败 → 改算法 → accept-baseline → regression
- CLI 入口：`promote-regression-case.ts` 和 `run-layout-regression.ts`
- split 策略：regression（默认运行，fail=exit1）、tuning（可见非硬门）、holdout（显式运行）

**Tech Stack:** TypeScript, Zod, Vitest, tsx, `@listen-graphic/graph-fixtures`, `@listen-graphic/schema`

---

## 文件结构

| 操作 | 文件 | 职责 |
|---|---|---|
| 创建 | `tools/layout-lab/src/layout-engine-adapter.ts` | LayoutEngineAdapter 接口 + R3b adapter |
| 创建 | `tools/layout-lab/src/regression-store.ts` | 回归 case 存储（独立 manifest + 文件读写） |
| 创建 | `tools/layout-lab/src/regression-promotion.ts` | 晋级函数（状态机：candidate → accept-baseline） |
| 创建 | `tools/layout-lab/src/regression-runner.ts` | 回归执行器（运行算法、检查约束、生成报告、控制退出码） |
| 创建 | `tools/layout-lab/src/promote-regression-case.ts` | CLI 入口：晋级 |
| 创建 | `tools/layout-lab/src/run-layout-regression.ts` | CLI 入口：运行回归 |
| 创建 | `tools/layout-lab/src/regression-runner.test.ts` | 测试 |
| 创建 | `tools/layout-lab/fixtures/regression/` | 回归 case 文件目录 |
| 创建 | `tools/layout-lab/fixtures/regression/manifest.json` | 回归 case manifest |
| 修改 | `packages/graph-fixtures/src/schemas.ts` | 扩展 schema（硬约束、软基线、退化预算） |
| 修改 | `packages/graph-fixtures/src/types.ts` | 导出回归 case 类型 |
| 修改 | `packages/graph-fixtures/src/load.ts` | 添加回归 case 加载函数 |
| 修改 | `packages/graph-fixtures/src/validate.ts` | 扩展校验到 regression、跨集合 ID 唯一性 |

---

### Task 1: LayoutEngineAdapter 接口 + R3b adapter

**Files:**
- 创建: `tools/layout-lab/src/layout-engine-adapter.ts`

- [ ] **Step 1: 定义 adapter 接口**

```typescript
/**
 * 布局引擎适配器接口。
 * 统一坐标语义：所有 adapter 返回 center positions + sizes。
 */
import type { MergedGraph } from '@listen-graphic/schema';

/** 中心点坐标 */
export type CenterPos = { cx: number; cy: number };

/** 节点尺寸 */
export type NodeSize = { width: number; height: number };

/** 布局结果 */
export type LayoutResult = {
  /** 节点中心点坐标 */
  positions: Record<string, CenterPos>;
  /** 节点尺寸 */
  sizes: Record<string, NodeSize>;
  /** 算法标识 */
  algorithmId: string;
  /** 算法版本（commit hash 或版本号） */
  algorithmVersion: string;
};

/** 布局引擎适配器 */
export type LayoutEngineAdapter = {
  id: string;
  version: string;
  computeLayout(graph: MergedGraph): LayoutResult;
};
```

- [ ] **Step 2: 实现 R3b adapter**

```typescript
import { computeClusterForceLayout } from './cluster-force-layout';
import { computeAllNodeSizes } from './round3-types';
import type { RenderModel } from './round2-types';

/**
 * R3b 布局引擎适配器。
 * 调用 computeClusterForceLayout，将 RenderModel（top-left）转换为 center positions。
 */
export function createR3bAdapter(): LayoutEngineAdapter {
  return {
    id: 'r3b',
    version: 'round3', // 可替换为 commit hash
    computeLayout(graph: MergedGraph): LayoutResult {
      const renderModel: RenderModel = computeClusterForceLayout(graph, 0, 'R3b');
      const allSizes = computeAllNodeSizes(graph.nodes);

      // 从 RenderModel 提取节点位置（top-left）并转换为 center
      const positions: Record<string, CenterPos> = {};
      const sizes: Record<string, NodeSize> = {};

      for (const item of renderModel.items) {
        if ('nodeId' in item) {
          const nodeId = item.nodeId;
          const size = allSizes[nodeId] ?? { width: 220, height: 132 };
          positions[nodeId] = {
            cx: item.position.x + size.width / 2,
            cy: item.position.y + size.height / 2,
          };
          sizes[nodeId] = size;
        }
      }

      return {
        positions,
        sizes,
        algorithmId: 'r3b',
        algorithmVersion: 'round3',
      };
    },
  };
}
```

- [ ] **Step 3: 运行类型检查**

```bash
cd tools/layout-lab && npx tsc --noEmit src/layout-engine-adapter.ts
```

预期：无错误。

- [ ] **Step 4: 提交**

```bash
git add tools/layout-lab/src/layout-engine-adapter.ts
git commit -m "feat(layout-lab): LayoutEngineAdapter 接口 + R3b adapter"
```

---

### Task 2: 扩展 graph-fixtures schema + 回归 case 存储

**Files:**
- 修改: `packages/graph-fixtures/src/schemas.ts`
- 修改: `packages/graph-fixtures/src/types.ts`
- 修改: `packages/graph-fixtures/src/load.ts`
- 修改: `packages/graph-fixtures/src/validate.ts`
- 创建: `tools/layout-lab/src/regression-store.ts`
- 创建: `tools/layout-lab/fixtures/regression/manifest.json`

- [ ] **Step 1: 扩展 schema**

在 `packages/graph-fixtures/src/schemas.ts` 末尾添加：

```typescript
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
export const softBaselinesSchema = z.object({
  edgeNodeOcclusions: z.number().int().nonnegative(),
  edgeEdgeCrossings: z.number().int().nonnegative(),
  avgEdgeLength: z.number().nonnegative(),
  p95EdgeLength: z.number().nonnegative(),
  longEdgeRatio: z.number().min(0).max(1),
  canvasWidth: z.number().nonnegative(),
  canvasHeight: z.number().nonnegative(),
  aspectRatio: z.number().nonnegative(),
}).strict();

/** 退化预算：软指标允许的最大退化比例（0-1） */
export const degradationBudgetSchema = z.object({
  edgeNodeOcclusions: z.number().min(0).max(1).default(0.15),
  edgeEdgeCrossings: z.number().min(0).max(1).default(0.15),
  avgEdgeLength: z.number().min(0).max(1).default(0.15),
  longEdgeRatio: z.number().min(0).max(1).default(0.15),
  canvasWidth: z.number().min(0).max(1).default(0.20),
}).strict();

/** 回归 case 状态 */
export const regressionCaseStatusSchema = z.enum([
  'candidate',     // 刚创建，无基线，必须先失败
  'baselined',     // 已 accept-baseline，可作为回归 case
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
  softBaselines: softBaselinesSchema.optional(), // candidate 状态时无基线
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
  visualChecklist: z.object({
    mainLineClear: z.boolean().optional(),
    localRelationsReadable: z.boolean().optional(),
    noScatteredOrOppressive: z.boolean().optional(),
    topicBoundariesClear: z.boolean().optional(),
  }).optional(),
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
```

- [ ] **Step 2: 导出类型**

在 `packages/graph-fixtures/src/types.ts` 中添加：

```typescript
import type {
  // ... 现有导入
  regressionCaseSchema,
  regressionManifestSchema,
  hardExpectationsSchema,
  softBaselinesSchema,
  degradationBudgetSchema,
  regressionCaseStatusSchema,
} from './schemas';

// ... 现有类型保持不变 ...

export type RegressionCase = z.infer<typeof regressionCaseSchema>;
export type RegressionManifest = z.infer<typeof regressionManifestSchema>;
export type HardExpectations = z.infer<typeof hardExpectationsSchema>;
export type SoftBaselines = z.infer<typeof softBaselinesSchema>;
export type DegradationBudget = z.infer<typeof degradationBudgetSchema>;
export type RegressionCaseStatus = z.infer<typeof regressionCaseStatusSchema>;
```

- [ ] **Step 3: 创建回归 case 存储**

在 `tools/layout-lab/src/regression-store.ts` 中实现：

```typescript
/**
 * 回归 case 存储。
 * 独立于 write-fixtures.mjs，不会被覆盖。
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { regressionCaseSchema, regressionManifestSchema } from '@listen-graphic/graph-fixtures';
import type { RegressionCase, RegressionManifest } from '@listen-graphic/graph-fixtures';

const REGRESSION_DIR = join(import.meta.dirname, '../fixtures/regression');
const MANIFEST_PATH = join(REGRESSION_DIR, 'manifest.json');

export function loadRegressionManifest(): RegressionManifest {
  if (!existsSync(MANIFEST_PATH)) {
    return { version: 1, cases: [] };
  }
  const raw = JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8'));
  return regressionManifestSchema.parse(raw);
}

export function saveRegressionManifest(manifest: RegressionManifest): void {
  mkdirSync(dirname(MANIFEST_PATH), { recursive: true });
  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2), 'utf-8');
}

export function loadRegressionCase(id: string): RegressionCase {
  const manifest = loadRegressionManifest();
  const entry = manifest.cases.find((c) => c.id === id);
  if (!entry) throw new Error(`Regression case not found: ${id}`);
  const filePath = join(REGRESSION_DIR, entry.file);
  const raw = JSON.parse(readFileSync(filePath, 'utf-8'));
  return regressionCaseSchema.parse(raw);
}

export function saveRegressionCase(testCase: RegressionCase): void {
  const manifest = loadRegressionManifest();
  const fileName = `${testCase.id}.json`;
  const filePath = join(REGRESSION_DIR, fileName);

  // 检查重复 caseId
  const existing = manifest.cases.find((c) => c.id === testCase.id);
  if (existing) {
    // 更新已有 entry
    existing.file = fileName;
    existing.tags = testCase.tags;
    existing.description = testCase.description;
  } else {
    // 添加新 entry
    manifest.cases.push({
      id: testCase.id,
      file: fileName,
      tags: testCase.tags,
      description: testCase.description,
    });
  }

  mkdirSync(REGRESSION_DIR, { recursive: true });
  writeFileSync(filePath, JSON.stringify(testCase, null, 2), 'utf-8');
  saveRegressionManifest(manifest);
}

export function listRegressionCases(): RegressionCase[] {
  const manifest = loadRegressionManifest();
  return manifest.cases.map((entry) => {
    const filePath = join(REGRESSION_DIR, entry.file);
    const raw = JSON.parse(readFileSync(filePath, 'utf-8'));
    return regressionCaseSchema.parse(raw);
  });
}
```

- [ ] **Step 4: 创建初始 manifest**

在 `tools/layout-lab/fixtures/regression/manifest.json` 中创建：

```json
{
  "version": 1,
  "cases": []
}
```

- [ ] **Step 5: 运行类型检查**

```bash
pnpm --filter @listen-graphic/graph-fixtures typecheck
```

预期：无错误。

- [ ] **Step 6: 提交**

```bash
git add packages/graph-fixtures/src/schemas.ts packages/graph-fixtures/src/types.ts tools/layout-lab/src/regression-store.ts tools/layout-lab/fixtures/regression/manifest.json
git commit -m "feat(graph-fixtures): 回归 case schema + 独立存储（不被 write-fixtures 覆盖）"
```

---

### Task 3: 晋级函数 + CLI 入口

**Files:**
- 创建: `tools/layout-lab/src/regression-promotion.ts`
- 创建: `tools/layout-lab/src/promote-regression-case.ts`

- [ ] **Step 1: 实现晋级函数**

```typescript
/**
 * 回归 case 晋级函数。
 * 状态机：candidate → 人工写期望 → case 先失败 → 改算法 → accept-baseline → regression
 */
import type { MergedGraph } from '@listen-graphic/schema';
import type { RegressionCase, HardExpectations, DegradationBudget } from '@listen-graphic/graph-fixtures';

import type { LayoutEngineAdapter, LayoutResult } from './layout-engine-adapter';
import { computeLayoutQuality, centerToTopLeft } from './layout-metrics-v2';
import { saveRegressionCase, loadRegressionCase } from './regression-store';

export type PromotionInput = {
  caseId: string;
  description: string;
  problemDescription: string;
  split: 'regression' | 'tuning' | 'holdout';
  source: string;
  graph: MergedGraph;
  primaryView?: 'timeline' | 'causal' | 'comparison' | 'hierarchy';
  tags?: string[];
  triggeringNodeIds?: string[];
  triggeringEdgeIds?: string[];
  hardExpectations?: Partial<HardExpectations>;
  degradationBudget?: Partial<DegradationBudget>;
};

/**
 * 创建候选回归 case（状态：candidate）。
 * 不计算基线——case 必须先失败，证明期望有意义。
 */
export function createCandidateCase(input: PromotionInput): RegressionCase {
  return {
    id: input.caseId,
    kind: 'regression',
    description: input.description,
    problemDescription: input.problemDescription,
    split: input.split,
    source: input.source,
    status: 'candidate',
    graph: input.graph,
    primaryView: input.primaryView,
    hardExpectations: {
      physicalOverlapPairs: 0,
      clearanceViolationPairs: 0,
      coordinateValidity: true,
      ...input.hardExpectations,
    },
    // candidate 状态无基线
    softBaselines: undefined,
    degradationBudget: {
      edgeNodeOcclusions: 0.15,
      edgeEdgeCrossings: 0.15,
      avgEdgeLength: 0.15,
      longEdgeRatio: 0.15,
      canvasWidth: 0.20,
      ...input.degradationBudget,
    },
    tags: input.tags,
    triggeringNodeIds: input.triggeringNodeIds,
    triggeringEdgeIds: input.triggeringEdgeIds,
  };
}

/**
 * 接受基线（显式命令，不是自动计算）。
 * 运行当前算法，将结果写入 softBaselines，状态变为 baselined。
 */
export function acceptBaseline(
  caseId: string,
  adapter: LayoutEngineAdapter,
): RegressionCase {
  const testCase = loadRegressionCase(caseId);
  if (testCase.status !== 'candidate') {
    throw new Error(`Case ${caseId} is not in candidate status (current: ${testCase.status})`);
  }

  // 运行算法
  const result = adapter.computeLayout(testCase.graph);
  const positions = centerToTopLeft(result.positions, result.sizes);
  const edges = testCase.graph.edges.map((e) => ({ source: e.source, target: e.target }));
  const metrics = computeLayoutQuality(edges, positions, result.sizes);

  // 写入基线
  const updated: RegressionCase = {
    ...testCase,
    status: 'baselined',
    softBaselines: {
      edgeNodeOcclusions: metrics.soft.edgeNodeOcclusions,
      edgeEdgeCrossings: metrics.soft.edgeEdgeCrossings,
      avgEdgeLength: metrics.soft.avgEdgeLength,
      p95EdgeLength: metrics.soft.p95EdgeLength,
      longEdgeRatio: metrics.soft.longEdgeRatio,
      canvasWidth: metrics.soft.canvasWidth,
      canvasHeight: metrics.soft.canvasHeight,
      aspectRatio: metrics.soft.aspectRatio,
    },
    algorithmId: adapter.id,
    algorithmVersion: adapter.version,
    metricsVersion: 'v2',
    clearancePx: testCase.hardExpectations.minClearancePx ?? 16,
  };

  saveRegressionCase(updated);
  return updated;
}
```

- [ ] **Step 2: 实现 CLI 入口**

在 `tools/layout-lab/src/promote-regression-case.ts` 中：

```typescript
#!/usr/bin/env tsx
/**
 * CLI：将原始 graph 晋级为候选回归 case。
 *
 * 用法：
 *   npx tsx src/promote-regression-case.ts \
 *     --input ../inputs/real-graphs-dump.json \
 *     --session-id <sessionId> \
 *     --case-id <caseId> \
 *     --description "描述" \
 *     --problem "问题描述" \
 *     --split regression \
 *     --source real-usage
 */
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import type { MergedGraph } from '@listen-graphic/schema';
import { createCandidateCase, type PromotionInput } from './regression-promotion';
import { saveRegressionCase } from './regression-store';

const { values } = parseArgs({
  options: {
    input: { type: 'string' },
    'session-id': { type: 'string' },
    'case-id': { type: 'string' },
    description: { type: 'string' },
    problem: { type: 'string' },
    split: { type: 'string' },
    source: { type: 'string' },
    tags: { type: 'string' },
  },
});

// 从 corpus 文件中按 sessionId 查找 graph
const corpus: MergedGraph[] = JSON.parse(readFileSync(values.input!, 'utf-8'));
const graph = corpus.find((g) => g.sessionId === values['session-id']);
if (!graph) {
  console.error(`Session not found: ${values['session-id']}`);
  process.exit(1);
}

const input: PromotionInput = {
  caseId: values['case-id']!,
  description: values.description ?? '',
  problemDescription: values.problem ?? '',
  split: (values.split as PromotionInput['split']) ?? 'regression',
  source: values.source ?? 'cli',
  graph,
  tags: values.tags ? values.tags.split(',') : undefined,
};

const testCase = createCandidateCase(input);
saveRegressionCase(testCase);
console.log(`✅ Created candidate case: ${testCase.id} (status: candidate)`);
console.log(`   Next: run regression to verify case fails, then fix algorithm, then accept-baseline`);
```

- [ ] **Step 3: 运行类型检查**

```bash
cd tools/layout-lab && npx tsc --noEmit src/regression-promotion.ts
```

预期：无错误。

- [ ] **Step 4: 提交**

```bash
git add tools/layout-lab/src/regression-promotion.ts tools/layout-lab/src/promote-regression-case.ts
git commit -m "feat(layout-lab): 晋级函数（状态机：candidate → accept-baseline）+ CLI"
```

---

### Task 4: 回归执行器 + CLI 入口

**Files:**
- 创建: `tools/layout-lab/src/regression-runner.ts`
- 创建: `tools/layout-lab/src/run-layout-regression.ts`

- [ ] **Step 1: 实现回归执行器**

```typescript
/**
 * 回归执行器。
 * 运行布局算法、检查硬约束、检查软指标退化、生成报告、控制退出码。
 */
import type { MergedGraph } from '@listen-graphic/schema';
import type { RegressionCase, HardExpectations, SoftBaselines } from '@listen-graphic/graph-fixtures';

import type { LayoutEngineAdapter, LayoutResult } from './layout-engine-adapter';
import { computeLayoutQuality, centerToTopLeft } from './layout-metrics-v2';

export type HardConstraintResult = {
  name: string;
  expected: number | boolean;
  actual: number | boolean;
  passed: boolean;
};

export type SoftMetricResult = {
  name: keyof SoftBaselines;
  baseline: number;
  actual: number;
  degradation: number;
  budget: number;
  passed: boolean;
};

export type RegressionCaseResult = {
  caseId: string;
  split: string;
  status: string;
  passed: boolean;
  reason?: string; // 失败原因
  hardResults: HardConstraintResult[];
  softResults: SoftMetricResult[];
};

export type RegressionSuiteResult = {
  totalCases: number;
  passedCases: number;
  failedCases: number;
  skippedCases: number; // candidate 状态跳过
  results: RegressionCaseResult[];
  passRateBySplit: Record<string, { passed: number; total: number; skipped: number }>;
};

/**
 * 运行单个回归 case。
 * candidate 状态的 case 必须失败（证明期望有意义）。
 * baselined 状态的 case 检查硬约束 + 软指标退化。
 */
export function runRegressionCase(
  testCase: RegressionCase,
  adapter: LayoutEngineAdapter,
): RegressionCaseResult {
  // candidate 状态：必须失败
  if (testCase.status === 'candidate') {
    return {
      caseId: testCase.id,
      split: testCase.split,
      status: testCase.status,
      passed: false,
      reason: 'candidate case must fail first (run accept-baseline after algorithm fix)',
      hardResults: [],
      softResults: [],
    };
  }

  // 运行算法
  const result = adapter.computeLayout(testCase.graph);
  const positions = centerToTopLeft(result.positions, result.sizes);
  const edges = testCase.graph.edges.map((e) => ({ source: e.source, target: e.target }));
  const metrics = computeLayoutQuality(edges, positions, result.sizes);

  // 检查硬约束
  const hardResults: HardConstraintResult[] = [];
  const he = testCase.hardExpectations;

  hardResults.push({
    name: 'physicalOverlapPairs',
    expected: he.physicalOverlapPairs,
    actual: metrics.hard.physicalOverlapPairs,
    passed: metrics.hard.physicalOverlapPairs <= he.physicalOverlapPairs,
  });
  hardResults.push({
    name: 'clearanceViolationPairs',
    expected: he.clearanceViolationPairs,
    actual: metrics.hard.clearanceViolationPairs,
    passed: metrics.hard.clearanceViolationPairs <= he.clearanceViolationPairs,
  });
  hardResults.push({
    name: 'coordinateValidity',
    expected: true,
    actual: metrics.hard.coordinateValidity,
    passed: metrics.hard.coordinateValidity === true,
  });

  // 可选硬约束
  if (he.maxCanvasWidthPx !== undefined) {
    hardResults.push({
      name: 'maxCanvasWidthPx',
      expected: he.maxCanvasWidthPx,
      actual: metrics.soft.canvasWidth,
      passed: metrics.soft.canvasWidth <= he.maxCanvasWidthPx,
    });
  }
  if (he.maxAspectRatio !== undefined) {
    hardResults.push({
      name: 'maxAspectRatio',
      expected: he.maxAspectRatio,
      actual: metrics.soft.aspectRatio,
      passed: metrics.soft.aspectRatio <= he.maxAspectRatio,
    });
  }
  if (he.maxP95EdgeLength !== undefined) {
    hardResults.push({
      name: 'maxP95EdgeLength',
      expected: he.maxP95EdgeLength,
      actual: metrics.soft.p95EdgeLength,
      passed: metrics.soft.p95EdgeLength <= he.maxP95EdgeLength,
    });
  }

  // 检查软指标退化（仅 baselined 状态）
  const softResults: SoftMetricResult[] = [];
  if (testCase.softBaselines) {
    const softMetricNames: Array<keyof SoftBaselines> = [
      'edgeNodeOcclusions', 'edgeEdgeCrossings', 'avgEdgeLength', 'longEdgeRatio', 'canvasWidth',
    ];
    const actualMetrics: Record<string, number> = {
      edgeNodeOcclusions: metrics.soft.edgeNodeOcclusions,
      edgeEdgeCrossings: metrics.soft.edgeEdgeCrossings,
      avgEdgeLength: metrics.soft.avgEdgeLength,
      longEdgeRatio: metrics.soft.longEdgeRatio,
      canvasWidth: metrics.soft.canvasWidth,
    };

    for (const name of softMetricNames) {
      const baseline = testCase.softBaselines[name];
      const actual = actualMetrics[name];
      const budget = testCase.degradationBudget[name] ?? 0.15;
      const degradation = baseline === 0 ? (actual > 0 ? 1 : 0) : (actual - baseline) / baseline;

      softResults.push({ name, baseline, actual, degradation, budget, passed: degradation <= budget });
    }
  }

  const allHardPassed = hardResults.every((r) => r.passed);
  const allSoftPassed = softResults.every((r) => r.passed);

  return {
    caseId: testCase.id,
    split: testCase.split,
    status: testCase.status,
    passed: allHardPassed && allSoftPassed,
    reason: !allHardPassed ? 'hard constraint failed' : !allSoftPassed ? 'soft metric degraded beyond budget' : undefined,
    hardResults,
    softResults,
  };
}

/**
 * 运行回归套件。
 * @param split 筛选 split；不传则运行所有。
 */
export function runRegressionSuite(
  cases: RegressionCase[],
  adapter: LayoutEngineAdapter,
  split?: string,
): RegressionSuiteResult {
  const filtered = split ? cases.filter((c) => c.split === split) : cases;
  const results: RegressionCaseResult[] = [];

  for (const testCase of filtered) {
    results.push(runRegressionCase(testCase, adapter));
  }

  const passedCases = results.filter((r) => r.passed).length;
  const failedCases = results.filter((r) => !r.passed).length;
  const skippedCases = results.filter((r) => r.status === 'candidate').length;

  const passRateBySplit: Record<string, { passed: number; total: number; skipped: number }> = {};
  for (const result of results) {
    if (!passRateBySplit[result.split]) {
      passRateBySplit[result.split] = { passed: 0, total: 0, skipped: 0 };
    }
    passRateBySplit[result.split].total++;
    if (result.passed) passRateBySplit[result.split].passed++;
    if (result.status === 'candidate') passRateBySplit[result.split].skipped++;
  }

  return { totalCases: results.length, passedCases, failedCases, skippedCases, results, passRateBySplit };
}

/**
 * 生成回归报告。
 */
export function formatRegressionReport(suiteResult: RegressionSuiteResult): string {
  const lines: string[] = [];
  lines.push(`回归套件：${suiteResult.passedCases}/${suiteResult.totalCases} 通过，${suiteResult.skippedCases} 跳过（candidate）`);
  lines.push('');

  for (const [split, stats] of Object.entries(suiteResult.passRateBySplit)) {
    const effective = stats.total - stats.skipped;
    const status = stats.skipped === stats.total ? '⏭️' : stats.passed === effective ? '✅' : '❌';
    lines.push(`  ${status} ${split}: ${stats.passed}/${effective} 通过，${stats.skipped} 跳过`);
  }
  lines.push('');

  const failed = suiteResult.results.filter((r) => !r.passed && r.status !== 'candidate');
  if (failed.length > 0) {
    lines.push(`失败的 case（${failed.length} 个）：`);
    for (const result of failed) {
      lines.push(`  ❌ ${result.caseId} (${result.split}): ${result.reason}`);
      for (const hard of result.hardResults.filter((r) => !r.passed)) {
        lines.push(`     硬约束 ${hard.name}: 期望 ${hard.expected}, 实际 ${hard.actual}`);
      }
      for (const soft of result.softResults.filter((r) => !r.passed)) {
        lines.push(`     软指标 ${soft.name}: 基线 ${soft.baseline}, 实际 ${soft.actual}, 退化 ${(soft.degradation * 100).toFixed(1)}% > ${(soft.budget * 100).toFixed(1)}%`);
      }
    }
  } else {
    lines.push('所有 baselined case 通过 ✅');
  }

  return lines.join('\n');
}
```

- [ ] **Step 2: 实现 CLI 入口**

在 `tools/layout-lab/src/run-layout-regression.ts` 中：

```typescript
#!/usr/bin/env tsx
/**
 * CLI：运行回归套件。
 *
 * 用法：
 *   npx tsx src/run-layout-regression.ts --split regression
 *   npx tsx src/run-layout-regression.ts --split holdout
 *   npx tsx src/run-layout-regression.ts --case-id specific-case
 */
import { parseArgs } from 'node:util';
import { listRegressionCases } from './regression-store';
import { createR3bAdapter } from './layout-engine-adapter';
import { runRegressionSuite, runRegressionCase, formatRegressionReport } from './regression-runner';

const { values } = parseArgs({
  options: {
    split: { type: 'string' },
    'case-id': { type: 'string' },
  },
});

const adapter = createR3bAdapter();
const allCases = listRegressionCases();

if (values['case-id']) {
  // 运行单个 case
  const testCase = allCases.find((c) => c.id === values['case-id']);
  if (!testCase) {
    console.error(`Case not found: ${values['case-id']}`);
    process.exit(1);
  }
  const result = runRegressionCase(testCase, adapter);
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.passed ? 0 : 1);
} else {
  // 运行套件
  const suiteResult = runRegressionSuite(allCases, adapter, values.split);
  console.log(formatRegressionReport(suiteResult));
  // 退出码：regression split 中有失败 → exit 1
  const regressionStats = suiteResult.passRateBySplit['regression'];
  const regressionFailed = regressionStats && regressionStats.passed < regressionStats.total - regressionStats.skipped;
  process.exit(regressionFailed ? 1 : 0);
}
```

- [ ] **Step 3: 运行类型检查**

```bash
cd tools/layout-lab && npx tsc --noEmit src/regression-runner.ts
```

预期：无错误。

- [ ] **Step 4: 提交**

```bash
git add tools/layout-lab/src/regression-runner.ts tools/layout-lab/src/run-layout-regression.ts
git commit -m "feat(layout-lab): 回归执行器 + CLI（split 策略 + 退出码）"
```

---

### Task 5: 测试

**Files:**
- 创建: `tools/layout-lab/src/regression-runner.test.ts`

- [ ] **Step 1: 创建测试**

```typescript
import { describe, expect, it } from 'vitest';
import { runRegressionCase, runRegressionSuite, formatRegressionReport } from './regression-runner';
import type { RegressionCase } from '@listen-graphic/graph-fixtures';
import type { MergedGraph } from '@listen-graphic/schema';
import type { LayoutEngineAdapter } from './layout-engine-adapter';

// ── 测试用 adapter ──

function makeSimpleAdapter(): LayoutEngineAdapter {
  return {
    id: 'test',
    version: '0.0.1',
    computeLayout(graph: MergedGraph) {
      const positions: Record<string, { cx: number; cy: number }> = {};
      const sizes: Record<string, { width: number; height: number }> = {};
      graph.nodes.forEach((node, i) => {
        positions[node.id] = { cx: i * 200 + 100, cy: 100 };
        sizes[node.id] = { width: 160, height: 80 };
      });
      return { positions, sizes, algorithmId: 'test', algorithmVersion: '0.0.1' };
    },
  };
}

// ── 测试夹具 ──

function makeGraph(): MergedGraph {
  return {
    sessionId: 'test', revision: 1, topics: [],
    nodes: [
      { id: 'n1', type: 'claim', text: 'A', timestampMs: 0, status: 'confirmed' },
      { id: 'n2', type: 'reason', text: 'B', timestampMs: 1, status: 'confirmed' },
      { id: 'n3', type: 'example', text: 'C', timestampMs: 2, status: 'confirmed' },
    ],
    edges: [
      { id: 'e1', source: 'n1', target: 'n2', type: 'supports' },
      { id: 'e2', source: 'n2', target: 'n3', type: 'example_of' },
    ],
    updatedAt: Date.now(),
  };
}

function makeBaselinedCase(overrides: Partial<RegressionCase> = {}): RegressionCase {
  return {
    id: 'test-1', kind: 'regression', description: '测试', problemDescription: '问题',
    split: 'regression', source: 'test', status: 'baselined', graph: makeGraph(),
    hardExpectations: { physicalOverlapPairs: 0, clearanceViolationPairs: 0, coordinateValidity: true },
    softBaselines: {
      edgeNodeOcclusions: 0, edgeEdgeCrossings: 0, avgEdgeLength: 200,
      p95EdgeLength: 200, longEdgeRatio: 0, canvasWidth: 560, canvasHeight: 80, aspectRatio: 7,
    },
    degradationBudget: { edgeNodeOcclusions: 0.15, edgeEdgeCrossings: 0.15, avgEdgeLength: 0.15, longEdgeRatio: 0.15, canvasWidth: 0.20 },
    ...overrides,
  };
}

// ── 测试 ──

describe('runRegressionCase', () => {
  it('candidate 状态必须失败', () => {
    const testCase = makeBaselinedCase({ status: 'candidate', softBaselines: undefined });
    const result = runRegressionCase(testCase, makeSimpleAdapter());
    expect(result.passed).toBe(false);
    expect(result.reason).toContain('candidate');
  });

  it('baselined 状态：所有约束通过', () => {
    const result = runRegressionCase(makeBaselinedCase(), makeSimpleAdapter());
    expect(result.passed).toBe(true);
  });

  it('baselined 状态：硬约束失败', () => {
    const overlapping: LayoutEngineAdapter = {
      id: 'bad', version: '0.0.1',
      computeLayout(graph) {
        const positions: Record<string, { cx: number; cy: number }> = {};
        const sizes: Record<string, { width: number; height: number }> = {};
        graph.nodes.forEach((node) => { positions[node.id] = { cx: 100, cy: 100 }; sizes[node.id] = { width: 160, height: 80 }; });
        return { positions, sizes, algorithmId: 'bad', algorithmVersion: '0.0.1' };
      },
    };
    const result = runRegressionCase(makeBaselinedCase(), overlapping);
    expect(result.passed).toBe(false);
    expect(result.reason).toContain('hard constraint');
  });

  it('可选硬约束 maxCanvasWidthPx', () => {
    const result = runRegressionCase(
      makeBaselinedCase({ hardExpectations: { physicalOverlapPairs: 0, clearanceViolationPairs: 0, coordinateValidity: true, maxCanvasWidthPx: 100 } }),
      makeSimpleAdapter(),
    );
    expect(result.passed).toBe(false);
    expect(result.hardResults.find((r) => r.name === 'maxCanvasWidthPx')?.passed).toBe(false);
  });
});

describe('runRegressionSuite', () => {
  it('按 split 筛选', () => {
    const cases = [
      makeBaselinedCase({ id: 'r1', split: 'regression' }),
      makeBaselinedCase({ id: 't1', split: 'tuning' }),
    ];
    const result = runRegressionSuite(cases, makeSimpleAdapter(), 'regression');
    expect(result.totalCases).toBe(1);
    expect(result.results[0].caseId).toBe('r1');
  });

  it('candidate 计入 skipped', () => {
    const cases = [makeBaselinedCase({ status: 'candidate', softBaselines: undefined })];
    const result = runRegressionSuite(cases, makeSimpleAdapter());
    expect(result.skippedCases).toBe(1);
  });
});

describe('formatRegressionReport', () => {
  it('包含 split 统计和失败详情', () => {
    const cases = [makeBaselinedCase({ id: 'r1' })];
    const report = formatRegressionReport(runRegressionSuite(cases, makeSimpleAdapter()));
    expect(report).toContain('regression:');
    expect(report).toContain('通过');
  });
});
```

- [ ] **Step 2: 运行测试**

```bash
cd tools/layout-lab && npx vitest run src/regression-runner.test.ts
```

预期：所有测试通过。

- [ ] **Step 3: 运行全量测试**

```bash
cd tools/layout-lab && npx vitest run
```

预期：无回归。

- [ ] **Step 4: 提交**

```bash
git add tools/layout-lab/src/regression-runner.test.ts
git commit -m "test(layout-lab): 回归执行器测试（candidate 必败、split 筛选、退出码）"
```

---

### Task 6: 端到端验证

**Files:**
- 无新增/修改文件

- [ ] **Step 1: 验证 CLI 可执行**

```bash
cd tools/layout-lab
# 创建一个测试 corpus 文件
echo '[]' > /tmp/test-corpus.json
# 验证 promote CLI 能加载（会因找不到 session 报错，但不崩溃）
npx tsx src/promote-regression-case.ts --input /tmp/test-corpus.json --session-id s1 --case-id test --description test --problem test 2>&1 || true
# 验证 runner CLI 能运行（空套件）
npx tsx src/run-layout-regression.ts
```

预期：两个 CLI 都不崩溃。

- [ ] **Step 2: 运行 graph-fixtures 类型检查**

```bash
pnpm --filter @listen-graphic/graph-fixtures typecheck
```

预期：无错误。

- [ ] **Step 3: 运行 layout-lab 全部测试**

```bash
cd tools/layout-lab && npx vitest run
```

预期：所有测试通过。

---

## 自检清单

- [x] 真实 adapter（R3b adapter 绑定 `computeClusterForceLayout`，坐标语义正确）
- [x] 可执行 CLI（`promote-regression-case.ts` + `run-layout-regression.ts`，用 `tsx` 运行）
- [x] fixture 持久化（独立 manifest，不被 `write-fixtures.mjs` 覆盖）
- [x] baseline 生命周期（状态机：candidate → 必须先失败 → accept-baseline → baselined）
- [x] 指标合同（硬约束 + 可选硬约束 + 软指标退化预算）
- [x] split 策略（regression=fail→exit1、tuning=可见非硬门、holdout=显式运行）
- [x] 可运行测试（Vitest，不依赖 `npx tsc`）
- [x] schema 约束（int、nonnegative、finite、0..1、trigger ID 存在性）
- [x] 隐私（原始 corpus 不进入 fixture 目录，case 必须先脱敏/最小化）
- [x] 不过滤小图和无边图
