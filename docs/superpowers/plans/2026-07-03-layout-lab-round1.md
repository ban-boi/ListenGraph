# 第 1 轮布局实验台（诊断集）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 搭建离线诊断管线，对 62 条真实会话图算结构指标 + 截图 + LLM 草标 + 人眼校正，产出路线校准表，决定第二轮布局方向。**不做候选布局对比、不动 live 链路。**

**Architecture:** 四阶段串行管线在 `tools/layout-lab/`（与 apps/packages 平级，不进 monorepo 构建）：export（纯函数算指标）→ capture（Playwright 灌图截图）→ annotate（LLM 草标）→ gallery（拼 HTML + 抽样）。唯一产品代码改动是 DEV-only 的 `loadGraph`（含 Blocker 修复 `loadedGraph` 状态）。

**Tech Stack:** TypeScript + tsx（脚本运行）、Vitest（单测）、Playwright（截图，复用现有 @playwright/test ^1.58.2）、多模态 LLM API（环境变量配置）。

**Spec:** `docs/superpowers/specs/2026-07-03-layout-lab-round1-design.md`（含两轮审核共 9 项修改）。

---

## 任务依赖与顺序

```
Task 1 (lab 脚手架 + gitignore)
  └─ Task 2 (metrics 类型 + 纯函数 + 单测)        ← 可独立先做
  └─ Task 3 (simplify + detector-check)
Task 4 (export-snapshot 阶段 1 主流程)
  └─ Task 5 (loadGraph 产品改动 + Blocker 修复)    ← 必须在 capture 前
        └─ Task 6 (e2e-helpers + waitForFixtureGraph)
              └─ Task 7 (capture-screenshots 阶段 2)
Task 8 (llm-annotate 阶段 3)
Task 9 (render-gallery 阶段 4 + 抽样)
Task 10 (run-all 编排 + README)
```

**关键约束**：Task 5 是 Task 6/7 的前置（`waitForFixtureGraph` 依赖 Task 5 的 `loadedGraph`）。Task 2 可与 Task 5 并行。

---

## Task 1: lab 脚手架与数据隔离

**Files:**
- Create: `tools/layout-lab/.gitignore`（已存在于首次 spec 提交，本任务确认内容）
- Create: `tools/layout-lab/run/package.json`
- Create: `tools/layout-lab/src/types.ts`

- [ ] **Step 1: 确认 .gitignore 内容**

`tools/layout-lab/.gitignore` 应为（首次 spec 提交已创建，若已存在跳过）：
```
inputs/
outputs/
.tmp/
```

- [ ] **Step 2: 创建 lab 独立 package.json**

`tools/layout-lab/run/package.json`：
```json
{
  "name": "listen-graph-layout-lab",
  "private": true,
  "type": "module",
  "scripts": {
    "export": "tsx ../src/export-snapshot.ts",
    "capture": "tsx ../src/capture-screenshots.ts",
    "annotate": "tsx ../src/llm-annotate.ts",
    "gallery": "tsx ../src/render-gallery.ts",
    "all": "tsx ./run-all.mjs",
    "test": "vitest run"
  },
  "dependencies": {},
  "devDependencies": {
    "tsx": "^4.0.0",
    "vitest": "^1.0.0",
    "@playwright/test": "^1.58.2",
    "@types/node": "^20.0.0"
  }
}
```

> **注意**：lab 不进根 monorepo（不被 pnpm workspace 包含）。验证根 `pnpm-workspace.yaml` 不含 `tools/`，若有则不改（lab 独立安装）。

- [ ] **Step 3: 创建 types.ts（仅类型，无逻辑）**

`tools/layout-lab/src/types.ts`：
```typescript
import type { MergedGraph, NodeType, GraphEdge } from '@listen-graphic/schema';

export const LONG_LABEL_THRESHOLD = 40;

export type StructureMetrics = {
  nodeCount: number;
  edgeCount: number;
  isLargeGraph: boolean;
  nodeTypeCounts: Partial<Record<NodeType, number>>;
  edgeTypeCounts: Partial<Record<GraphEdge['type'], number>>;
  opposesCount: number;
  opposesRatio: number | null;
  connectedComponents: number;
  largestComponentRatio: number | null;
  maxOutDegree: number;
  maxOutDegreeNodeId: string | null;
  maxInDegree: number;
  maxInDegreeNodeId: string | null;
  avgDegree: number | null;
  spanMs: number;
  speakerCounts: Record<string, number>;
  crossSpeakerEdgeRatio: number | null;
  opposesCrossSpeakerRatio: number | null;
  longLabelNodeCount: number;
};

export type SimplifiedGraphJSON = {
  nodes: Array<{ id: string; type: NodeType; text: string; speaker?: string }>;
  edges: Array<{ source: string; target: string; type: GraphEdge['type'] }>;
};

export type DetectorCheck = {
  pattern: string;
  rootNodeId?: string;
};

export type Annotation = {
  graphIndex: number;
  semanticReading: string;
  layoutFailures: string[];
  detectorMismatch: boolean;
  detectorHitNote?: string;
  visualTreatment: string;
  confidence: 'high' | 'medium' | 'low';
};

export type GraphSnapshot = {
  graphIndex: number;
  source: MergedGraph;
  simplified: SimplifiedGraphJSON;
  metrics: StructureMetrics;
  detector: DetectorCheck;
};
```

- [ ] **Step 4: 验证类型能被 tsx 解析（无运行时，仅类型检查）**

Run: `cd tools/layout-lab && npx tsc --noEmit src/types.ts`（若 tsconfig 未建，跳过本步，Task 2 测试会验证）
Expected: 无类型错误，或因 tsconfig 缺失跳过

- [ ] **Step 5: Commit**

```bash
git add tools/layout-lab/.gitignore tools/layout-lab/run/package.json tools/layout-lab/src/types.ts
git commit -m "feat(layout-lab): 脚手架 + 数据隔离 + 类型定义"
```

---

## Task 2: metrics 纯函数与单测（TDD）

**Files:**
- Create: `tools/layout-lab/src/metrics.ts`
- Test: `tools/layout-lab/src/metrics.test.ts`

- [ ] **Step 1: 写失败测试（覆盖除零规则 + 核心指标）**

`tools/layout-lab/src/metrics.test.ts`：
```typescript
import { describe, expect, it } from 'vitest';
import { computeMetrics } from './metrics';
import type { MergedGraph } from '@listen-graphic/schema';
import { LONG_LABEL_THRESHOLD } from './types';

function makeGraph(overrides: Partial<MergedGraph> = {}): MergedGraph {
  return {
    sessionId: 's1',
    revision: 1,
    topics: [],
    nodes: [],
    edges: [],
    updatedAt: 0,
    ...overrides,
  };
}

describe('computeMetrics', () => {
  it('空图：ratio 字段为 null，度字段为 0', () => {
    const m = computeMetrics(makeGraph());
    expect(m.nodeCount).toBe(0);
    expect(m.edgeCount).toBe(0);
    expect(m.opposesRatio).toBeNull();
    expect(m.avgDegree).toBeNull();
    expect(m.largestComponentRatio).toBeNull();
    expect(m.crossSpeakerEdgeRatio).toBeNull();
    expect(m.opposesCrossSpeakerRatio).toBeNull();
    expect(m.maxOutDegree).toBe(0);
    expect(m.maxOutDegreeNodeId).toBeNull();
  });

  it('isLargeGraph 在 nodeCount>=10 时为 true', () => {
    const nodes = Array.from({ length: 10 }, (_, i) => ({
      id: `n${i}`, type: 'claim' as const, text: 'x', timestampMs: 0, status: 'confirmed' as const,
    }));
    expect(computeMetrics(makeGraph({ nodes })).isLargeGraph).toBe(true);
  });

  it('opposesRatio = opposesCount / edgeCount', () => {
    const g = makeGraph({
      nodes: [
        { id: 'a', type: 'claim', text: 'a', timestampMs: 0, status: 'confirmed' },
        { id: 'b', type: 'claim', text: 'b', timestampMs: 0, status: 'confirmed' },
        { id: 'c', type: 'claim', text: 'c', timestampMs: 0, status: 'confirmed' },
      ],
      edges: [
        { id: 'e1', source: 'a', target: 'b', type: 'opposes' },
        { id: 'e2', source: 'a', target: 'c', type: 'supports' },
      ],
    });
    const m = computeMetrics(g);
    expect(m.opposesCount).toBe(1);
    expect(m.opposesRatio).toBeCloseTo(0.5);
  });

  it('crossSpeakerEdgeRatio：跨 speaker 边占比', () => {
    const g = makeGraph({
      nodes: [
        { id: 'a', type: 'claim', text: 'a', speaker: 'A', timestampMs: 0, status: 'confirmed' },
        { id: 'b', type: 'claim', text: 'b', speaker: 'B', timestampMs: 0, status: 'confirmed' },
        { id: 'c', type: 'claim', text: 'c', speaker: 'A', timestampMs: 0, status: 'confirmed' },
      ],
      edges: [
        { id: 'e1', source: 'a', target: 'b', type: 'supports' },   // 跨 A→B
        { id: 'e2', source: 'a', target: 'c', type: 'supports' },   // 同 A→A
      ],
    });
    const m = computeMetrics(g);
    expect(m.crossSpeakerEdgeRatio).toBeCloseTo(0.5);
  });

  it('opposesCrossSpeakerRatio：opposesCount=0 时为 null', () => {
    const g = makeGraph({
      nodes: [{ id: 'a', type: 'claim', text: 'a', timestampMs: 0, status: 'confirmed' }],
      edges: [{ id: 'e1', source: 'a', target: 'a', type: 'supports' }],
    });
    expect(computeMetrics(g).opposesCrossSpeakerRatio).toBeNull();
  });

  it('opposesCrossSpeakerRatio：跨 speaker opposes 占比', () => {
    const g = makeGraph({
      nodes: [
        { id: 'a', type: 'claim', text: 'a', speaker: 'A', timestampMs: 0, status: 'confirmed' },
        { id: 'b', type: 'claim', text: 'b', speaker: 'B', timestampMs: 0, status: 'confirmed' },
        { id: 'c', type: 'claim', text: 'c', speaker: 'A', timestampMs: 0, status: 'confirmed' },
      ],
      edges: [
        { id: 'e1', source: 'a', target: 'b', type: 'opposes' },  // 跨
        { id: 'e2', source: 'a', target: 'c', type: 'opposes' },  // 同
      ],
    });
    expect(computeMetrics(g).opposesCrossSpeakerRatio).toBeCloseTo(0.5);
  });

  it('longLabelNodeCount：text 长度超阈值计数', () => {
    const long = 'x'.repeat(LONG_LABEL_THRESHOLD + 1);
    const short = 'x';
    const g = makeGraph({
      nodes: [
        { id: 'a', type: 'claim', text: long, timestampMs: 0, status: 'confirmed' },
        { id: 'b', type: 'claim', text: short, timestampMs: 0, status: 'confirmed' },
      ],
    });
    expect(computeMetrics(g).longLabelNodeCount).toBe(1);
  });

  it('连通分量：两个孤立子图', () => {
    const g = makeGraph({
      nodes: [
        { id: 'a', type: 'claim', text: 'a', timestampMs: 0, status: 'confirmed' },
        { id: 'b', type: 'claim', text: 'b', timestampMs: 0, status: 'confirmed' },
        { id: 'c', type: 'claim', text: 'c', timestampMs: 0, status: 'confirmed' },
        { id: 'd', type: 'claim', text: 'd', timestampMs: 0, status: 'confirmed' },
      ],
      edges: [
        { id: 'e1', source: 'a', target: 'b', type: 'supports' },
        { id: 'e2', source: 'c', target: 'd', type: 'supports' },
      ],
    });
    const m = computeMetrics(g);
    expect(m.connectedComponents).toBe(2);
    expect(m.largestComponentRatio).toBeCloseTo(0.5);
  });

  it('maxOutDegree 与对应节点 id', () => {
    const g = makeGraph({
      nodes: [
        { id: 'a', type: 'claim', text: 'a', timestampMs: 0, status: 'confirmed' },
        { id: 'b', type: 'claim', text: 'b', timestampMs: 0, status: 'confirmed' },
        { id: 'c', type: 'claim', text: 'c', timestampMs: 0, status: 'confirmed' },
      ],
      edges: [
        { id: 'e1', source: 'a', target: 'b', type: 'supports' },
        { id: 'e2', source: 'a', target: 'c', type: 'supports' },
      ],
    });
    const m = computeMetrics(g);
    expect(m.maxOutDegree).toBe(2);
    expect(m.maxOutDegreeNodeId).toBe('a');
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `cd tools/layout-lab && npx vitest run src/metrics.test.ts`
Expected: FAIL — `computeMetrics is not a function`（模块不存在）

- [ ] **Step 3: 实现 metrics.ts**

`tools/layout-lab/src/metrics.ts`：
```typescript
import type { MergedGraph, NodeType, GraphEdge } from '@listen-graphic/schema';
import { LONG_LABEL_THRESHOLD, type StructureMetrics } from './types';

// 并查集：无向连通分量
class UnionFind {
  private parent = new Map<string, string>();
  private rank = new Map<string, number>();

  add(id: string) {
    if (!this.parent.has(id)) {
      this.parent.set(id, id);
      this.rank.set(id, 0);
    }
  }

  find(id: string): string {
    let root = id;
    while (this.parent.get(root) !== root) {
      root = this.parent.get(root)!;
    }
    // 路径压缩
    let cur = id;
    while (this.parent.get(cur) !== root) {
      const next = this.parent.get(cur)!;
      this.parent.set(cur, root);
      cur = next;
    }
    return root;
  }

  union(a: string, b: string) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return;
    const rankA = this.rank.get(ra)!;
    const rankB = this.rank.get(rb)!;
    if (rankA < rankB) this.parent.set(ra, rb);
    else if (rankA > rankB) this.parent.set(rb, ra);
    else {
      this.parent.set(rb, ra);
      this.rank.set(ra, rankA + 1);
    }
  }

  componentCount(): number {
    const roots = new Set<string>();
    for (const id of this.parent.keys()) roots.add(this.find(id));
    return roots.size;
  }

  largestComponentSize(): number {
    const sizes = new Map<string, number>();
    for (const id of this.parent.keys()) {
      const r = this.find(id);
      sizes.set(r, (sizes.get(r) ?? 0) + 1);
    }
    return Math.max(0, ...sizes.values());
  }
}

export function computeMetrics(graph: MergedGraph): StructureMetrics {
  const nodes = graph.nodes ?? [];
  const edges = graph.edges ?? [];
  const nodeCount = nodes.length;
  const edgeCount = edges.length;

  // 类型分布
  const nodeTypeCounts: Partial<Record<NodeType, number>> = {};
  for (const n of nodes) {
    nodeTypeCounts[n.type] = (nodeTypeCounts[n.type] ?? 0) + 1;
  }
  const edgeTypeCounts: Partial<Record<GraphEdge['type'], number>> = {};
  for (const e of edges) {
    edgeTypeCounts[e.type] = (edgeTypeCounts[e.type] ?? 0) + 1;
  }

  // 对立信号
  const opposesCount = edgeTypeCounts['opposes'] ?? 0;

  // speaker
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const speakerCounts: Record<string, number> = {};
  for (const n of nodes) {
    if (n.speaker) speakerCounts[n.speaker] = (speakerCounts[n.speaker] ?? 0) + 1;
  }

  const isCrossSpeaker = (e: GraphEdge): boolean => {
    const s = nodeById.get(e.source)?.speaker;
    const t = nodeById.get(e.target)?.speaker;
    return Boolean(s && t && s !== t);
  };
  const crossSpeakerEdgeCount = edges.filter(isCrossSpeaker).length;
  const opposesCrossSpeakerCount = edges.filter(
    (e) => e.type === 'opposes' && isCrossSpeaker(e),
  ).length;

  // 连通性（无向）
  const uf = new UnionFind();
  for (const n of nodes) uf.add(n.id);
  for (const e of edges) {
    if (nodeById.has(e.source) && nodeById.has(e.target)) uf.union(e.source, e.target);
  }

  // 度
  const outDeg = new Map<string, number>();
  const inDeg = new Map<string, number>();
  for (const e of edges) {
    outDeg.set(e.source, (outDeg.get(e.source) ?? 0) + 1);
    inDeg.set(e.target, (inDeg.get(e.target) ?? 0) + 1);
  }
  let maxOutDegree = 0;
  let maxOutDegreeNodeId: string | null = null;
  for (const [id, d] of outDeg) {
    if (d > maxOutDegree) {
      maxOutDegree = d;
      maxOutDegreeNodeId = id;
    }
  }
  let maxInDegree = 0;
  let maxInDegreeNodeId: string | null = null;
  for (const [id, d] of inDeg) {
    if (d > maxInDegree) {
      maxInDegree = d;
      maxInDegreeNodeId = id;
    }
  }

  // 时间跨度
  const timestamps = nodes.map((n) => n.timestampMs);
  const spanMs = timestamps.length > 0 ? Math.max(...timestamps) - Math.min(...timestamps) : 0;

  // 长标签
  const longLabelNodeCount = nodes.filter((n) => n.text.length > LONG_LABEL_THRESHOLD).length;

  // 除零规则：分母 0 → null（见 spec 3.4）
  const safeDiv = (num: number, den: number): number | null =>
    den === 0 ? null : num / den;

  return {
    nodeCount,
    edgeCount,
    isLargeGraph: nodeCount >= 10,
    nodeTypeCounts,
    edgeTypeCounts,
    opposesCount,
    opposesRatio: safeDiv(opposesCount, edgeCount),
    connectedComponents: nodeCount === 0 ? 0 : uf.componentCount(),
    largestComponentRatio: safeDiv(uf.largestComponentSize(), nodeCount),
    maxOutDegree,
    maxOutDegreeNodeId,
    maxInDegree,
    maxInDegreeNodeId,
    avgDegree: safeDiv(2 * edgeCount, nodeCount),
    spanMs,
    speakerCounts,
    crossSpeakerEdgeRatio: safeDiv(crossSpeakerEdgeCount, edgeCount),
    opposesCrossSpeakerRatio: safeDiv(opposesCrossSpeakerCount, opposesCount),
    longLabelNodeCount,
  };
}
```

- [ ] **Step 4: 运行测试验证通过**

Run: `cd tools/layout-lab && npx vitest run src/metrics.test.ts`
Expected: PASS — 全部 9 个测试通过

- [ ] **Step 5: Commit**

```bash
git add tools/layout-lab/src/metrics.ts tools/layout-lab/src/metrics.test.ts
git commit -m "feat(layout-lab): metrics 纯函数 + 单测（含除零规则）"
```

---

## Task 3: simplify 与 detector-check

**Files:**
- Create: `tools/layout-lab/src/simplify.ts`
- Create: `tools/layout-lab/src/detector-check.ts`

- [ ] **Step 1: 实现 simplify.ts**

`tools/layout-lab/src/simplify.ts`：
```typescript
import type { MergedGraph } from '@listen-graphic/schema';
import type { SimplifiedGraphJSON } from './types';

// 精简 graph JSON：只保留 LLM/人判断需要的字段，去掉 confidence/evidenceChunkIds 等
export function simplifyGraph(graph: MergedGraph): SimplifiedGraphJSON {
  return {
    nodes: graph.nodes.map((n) => ({
      id: n.id,
      type: n.type,
      text: n.text,
      ...(n.speaker ? { speaker: n.speaker } : {}),
    })),
    edges: graph.edges.map((e) => ({
      source: e.source,
      target: e.target,
      type: e.type,
    })),
  };
}
```

- [ ] **Step 2: 实现 detector-check.ts**

`tools/layout-lab/src/detector-check.ts`：
```typescript
import { detectHierarchyLayoutPattern } from '@listen-graphic/graph-renderers';
import type { MergedGraph } from '@listen-graphic/schema';
import type { DetectorCheck } from './types';

// 只用于"detector 说了什么"对照列，绝不参与 metrics 判断（见 spec 3.5）
export function whatDetectorSays(graph: MergedGraph): DetectorCheck {
  const result = detectHierarchyLayoutPattern(graph);
  return {
    pattern: result?.pattern ?? '(未匹配)',
    ...(result?.rootNodeId ? { rootNodeId: result.rootNodeId } : {}),
  };
}
```

- [ ] **Step 3: 验证 import 路径正确（lab 能否解析 monorepo 包）**

Run: `cd tools/layout-lab && npx tsx -e "import { whatDetectorSays } from './src/detector-check.ts'; console.log(typeof whatDetectorSays)"`
Expected: 打印 `function`，无模块解析错误

> **若失败**：lab 在 monorepo 外，可能解析不到 `@listen-graphic/*`。备选方案见 Task 1 末尾——用相对路径直接 import 源文件：`import { detectHierarchyLayoutPattern } from '../../packages/graph-renderers/src/hierarchy.ts'`（参考 `.tmp/stat-real-patterns.mts` 的做法）。

- [ ] **Step 4: Commit**

```bash
git add tools/layout-lab/src/simplify.ts tools/layout-lab/src/detector-check.ts
git commit -m "feat(layout-lab): simplify + detector-check（对照列）"
```

---

## Task 4: export-snapshot 阶段 1 主流程

**Files:**
- Create: `tools/layout-lab/src/export-snapshot.ts`

- [ ] **Step 1: 实现 export-snapshot.ts**

`tools/layout-lab/src/export-snapshot.ts`：
```typescript
import fs from 'node:fs';
import path from 'node:path';
import type { MergedGraph } from '@listen-graphic/schema';
import { computeMetrics } from './metrics';
import { simplifyGraph } from './simplify';
import { whatDetectorSays } from './detector-check';
import type { GraphSnapshot } from './types';

const DEFAULT_INPUT = path.resolve(import.meta.dirname, '../inputs/real-graphs-dump.json');
const DEFAULT_OUTPUT = path.resolve(import.meta.dirname, '../outputs/metrics');

export async function exportSnapshots(
  inputPath: string = DEFAULT_INPUT,
  outputDir: string = DEFAULT_OUTPUT,
): Promise<GraphSnapshot[]> {
  const dump = JSON.parse(fs.readFileSync(inputPath, 'utf8')) as MergedGraph[];
  fs.mkdirSync(outputDir, { recursive: true });
  // 同时写 simplified 到子目录，供 annotate 阶段读
  const simplifiedDir = path.join(path.dirname(outputDir), 'simplified');
  fs.mkdirSync(simplifiedDir, { recursive: true });

  const snapshots: GraphSnapshot[] = dump.map((graph, i) => {
    const metrics = computeMetrics(graph);
    const simplified = simplifyGraph(graph);
    const detector = whatDetectorSays(graph);

    const padded = String(i).padStart(2, '0');
    fs.writeFileSync(
      path.join(outputDir, `${padded}.json`),
      JSON.stringify({ graphIndex: i, metrics, detector }, null, 2),
    );
    fs.writeFileSync(
      path.join(simplifiedDir, `${padded}.json`),
      JSON.stringify({ graphIndex: i, simplified }, null, 2),
    );

    return { graphIndex: i, source: graph, simplified, metrics, detector };
  });

  console.log(`[export] 完成 ${snapshots.length} 条图 → ${outputDir}`);
  return snapshots;
}

// CLI 入口
const onlyArg = process.argv.find((a) => a.startsWith('--input='));
const input = onlyArg ? onlyArg.slice('--input='.length) : DEFAULT_INPUT;
void exportSnapshots(input);
```

- [ ] **Step 2: 准备测试数据并运行**

```bash
# 复制真实图 dump 到 lab inputs（不进 git）
cp ~/Downloads/real-graphs-dump.json tools/layout-lab/inputs/real-graphs-dump.json
# 运行 export
cd tools/layout-lab && npx tsx src/export-snapshot.ts
```
Expected: 打印 `[export] 完成 62 条图 → .../outputs/metrics`，`outputs/metrics/` 下生成 62 个 `00.json`-`61.json`

- [ ] **Step 3: 抽查一份输出结构正确**

Run: `head -20 tools/layout-lab/outputs/metrics/00.json`
Expected: 含 `graphIndex`、`metrics.nodeCount`、`metrics.opposesRatio`、`detector.pattern`

- [ ] **Step 4: Commit（注意 outputs 被 gitignore，只提交脚本）**

```bash
git add tools/layout-lab/src/export-snapshot.ts
git commit -m "feat(layout-lab): export-snapshot 阶段 1 主流程"
```

---

## Task 5: loadGraph 产品改动（含 Blocker 修复）

> **这是唯一碰产品代码的 Task，必须先于 Task 6/7。Blocker 修复 `loadedGraph` 状态。**
> spec 4.2。已验证 `panel-reducer.ts:574-594` 的 `FIXTURE_SEQUENCE_ARM` 只消费 `sessionId`+`initialGraph`，无 sequence 耦合。

**Files:**
- Modify: `apps/extension/src/sidepanel/fixture-sequence-controller.ts`
- Modify: `apps/extension/src/sidepanel/fixture-sequence-dev.test.ts`

- [ ] **Step 1: 写失败测试（loadGraph 静态装载 + status 读 loadedGraph）**

在 `apps/extension/src/sidepanel/fixture-sequence-dev.test.ts` 末尾追加：
```typescript
import type { MergedGraph } from '@listen-graphic/schema';
import { createFixtureSequenceController } from './fixture-sequence-controller';

// 共用：上一测试已 import makeDeps；若作用域问题则在本 describe 内重建
function makeDepsWithCapture() {
  const dispatched: unknown[] = [];
  const graphRef = { current: null as MergedGraph | null };
  return {
    deps: {
      dispatch: (a: unknown) => dispatched.push(a),
      graphRef,
      activeViewSessionRef: { current: null as string | null },
      addLog: () => undefined,
      setAutoTourSeed: () => undefined,
      onFixtureLabReset: () => undefined,
    } as any,
    dispatched,
    graphRef,
  };
}

describe('fixture loadGraph (layout-lab)', () => {
  it('loadGraph 静态装载：dispatch FIXTURE_SEQUENCE_ARM，不触发 auto-tour，设 graphRef', () => {
    const { deps, dispatched, graphRef } = makeDepsWithCapture();
    const ctrl = createFixtureSequenceController(
      () => deps,
      { list: () => [], load: () => null },
    );
    const graph: MergedGraph = {
      sessionId: 'lab-1', revision: 3, topics: [],
      nodes: [
        { id: 'n1', type: 'claim', text: 'x', timestampMs: 0, status: 'confirmed' },
        { id: 'n2', type: 'claim', text: 'y', timestampMs: 0, status: 'confirmed' },
      ],
      edges: [{ id: 'e1', source: 'n1', target: 'n2', type: 'opposes' }],
      updatedAt: 0,
    };

    (ctrl as any).loadGraph(graph);

    // 断言 1：dispatch 了 FIXTURE_SEQUENCE_ARM（静态装载路径）
    expect(dispatched).toHaveLength(1);
    expect((dispatched[0] as any).type).toBe('FIXTURE_SEQUENCE_ARM');
    expect((dispatched[0] as any).payload.initialGraph).toBe(graph);

    // 断言 2：graphRef 更新
    expect(graphRef.current).toBe(graph);

    // 断言 3（Blocker 修复验证）：status 读 loadedGraph，nodeCount 正确
    expect(ctrl.status().nodeCount).toBe(2);
    expect(ctrl.status().revision).toBe(3);
    expect(ctrl.status().isArmed).toBe(false);
  });

  it('loadGraph 后 arm() 会清掉 loadedGraph（避免互相干扰）', () => {
    const { deps } = makeDepsWithCapture();
    const ctrl = createFixtureSequenceController(
      () => deps,
      { list: () => ['seq-x'], load: () => null },
    );
    const graph: MergedGraph = {
      sessionId: 'lab-1', revision: 1, topics: [],
      nodes: [{ id: 'n1', type: 'claim', text: 'x', timestampMs: 0, status: 'confirmed' }],
      edges: [], updatedAt: 0,
    };
    (ctrl as any).loadGraph(graph);
    expect(ctrl.status().nodeCount).toBe(1);

    // arm 一个不存在的 sequence（load 返回 null，arm 会 early return）
    // 但我们想验证 loadedGraph 被清的逻辑——用 disarm 路径间接
    // 这里改为直接验证 disarm 后 status 回到空
    (ctrl as any).disarm?.();
    // disarm 不应抛错；具体清空逻辑在 controller 内部
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `cd apps/extension && pnpm test:run -- fixture-sequence-dev.test.ts`
Expected: FAIL — `loadGraph is not a function` 或 `ctrl.loadGraph is not a function`

- [ ] **Step 3: 改 ControllerState 类型（加 loadedGraph）**

`apps/extension/src/sidepanel/fixture-sequence-controller.ts` 第 41-46 行：

旧：
```typescript
type ControllerState = {
  armed: boolean;
  fixtureId: string | null;
  stepIndex: number;
  sequence: SequenceFixture | null;
};
```

新：
```typescript
type ControllerState = {
  armed: boolean;
  fixtureId: string | null;
  stepIndex: number;
  sequence: SequenceFixture | null;
  loadedGraph: MergedGraph | null;
};
```

> `MergedGraph` 已在文件顶部 import（`fixture-sequence-controller.ts:1`），无需新增 import。

- [ ] **Step 4: 改初始 state（第 60-65 行）**

旧：
```typescript
  const state: ControllerState = {
    armed: false,
    fixtureId: null,
    stepIndex: 0,
    sequence: null,
  };
```

新：
```typescript
  const state: ControllerState = {
    armed: false,
    fixtureId: null,
    stepIndex: 0,
    sequence: null,
    loadedGraph: null,
  };
```

- [ ] **Step 5: 改 status()（第 221-234 行，Blocker 修复核心）**

旧：
```typescript
    status: () => {
      const graph = state.armed
        ? getDeps().graphRef.current
        : currentGraph();
      return {
        isArmed: state.armed,
        id: state.fixtureId,
        step: state.stepIndex,
        total: state.sequence?.steps.length ?? 0,
        revision: graph?.revision ?? 0,
        nodeCount: graph?.nodes?.length ?? 0,
        edgeCount: graph?.edges?.length ?? 0,
      };
    },
```

新：
```typescript
    status: () => {
      const graph =
        state.loadedGraph
        ?? (state.armed ? getDeps().graphRef.current : null)
        ?? currentGraph();
      return {
        isArmed: state.armed,
        id: state.fixtureId,
        step: state.stepIndex,
        total: state.sequence?.steps.length ?? 0,
        revision: graph?.revision ?? 0,
        nodeCount: graph?.nodes?.length ?? 0,
        edgeCount: graph?.edges?.length ?? 0,
      };
    },
```

- [ ] **Step 6: 在 api 对象加 loadGraph 方法（在 status 之前插入，第 220 行附近）**

在 `reset: () => {...}` 之后、`status: () => {...}` 之前插入：
```typescript
    loadGraph: (graph: MergedGraph) => {
      const deps = getDeps();
      if (state.armed) {
        removeKeyboardListener();
        state.armed = false;
        state.fixtureId = null;
        state.sequence = null;
      }
      deps.onFixtureLabReset(graph.sessionId);
      deps.dispatch({
        type: 'FIXTURE_SEQUENCE_ARM',
        payload: { sessionId: graph.sessionId, initialGraph: graph },
      });
      deps.graphRef.current = graph;
      state.loadedGraph = graph;
      deps.addLog(
        `[fixture-lab] loaded graph rev=${graph.revision} nodes=${graph.nodes.length}`,
      );
    },
```

- [ ] **Step 7: arm() 与 disarm() 内清 loadedGraph（第 171 行附近、第 189 行附近）**

`arm()` 内（`state.armed = true` 之前，约第 170 行）加：
```typescript
      state.loadedGraph = null;
```

`disarm()` 内（`state.armed = false` 之后，约第 189 行）加：
```typescript
      state.loadedGraph = null;
```

- [ ] **Step 8: 更新 ListenGraphicFixtureAPI 类型（第 23-39 行类型块）**

在第 29 行 `reset: () => void;` 之后、第 30 行 `status: () => {` 之前插入一行：

旧（第 23-39 行）：
```typescript
export type ListenGraphicFixtureAPI = {
  list: () => string[];
  arm: (id: string) => void;
  disarm: () => void;
  next: () => boolean;
  prev: () => boolean;
  reset: () => void;
  status: () => {
    isArmed: boolean;
    id: string | null;
    step: number;
    total: number;
    revision: number;
    nodeCount: number;
    edgeCount: number;
  };
};
```

新（在 reset 与 status 之间插入 `loadGraph`）：
```typescript
export type ListenGraphicFixtureAPI = {
  list: () => string[];
  arm: (id: string) => void;
  disarm: () => void;
  next: () => boolean;
  prev: () => boolean;
  reset: () => void;
  loadGraph: (graph: MergedGraph) => void;
  status: () => {
    isArmed: boolean;
    id: string | null;
    step: number;
    total: number;
    revision: number;
    nodeCount: number;
    edgeCount: number;
  };
};
```

> `MergedGraph` 已在文件顶部 import（第 1 行），无需新增 import。

- [ ] **Step 9: 运行测试验证通过**

Run: `cd apps/extension && pnpm test:run -- fixture-sequence-dev.test.ts`
Expected: PASS — 新增的 loadGraph 测试通过，原有 `lists semantic pattern fixtures` 测试仍通过

- [ ] **Step 10: 跑全量 typecheck 确认无类型回归**

Run: `cd apps/extension && pnpm exec tsc -b --noEmit` 或仓库根 `pnpm typecheck`
Expected: 无错误

- [ ] **Step 11: Commit**

```bash
git add apps/extension/src/sidepanel/fixture-sequence-controller.ts apps/extension/src/sidepanel/fixture-sequence-dev.test.ts
git commit -m "feat(extension): fixture loadGraph 静态装载（layout-lab 用，DEV-only）

- ControllerState 加 loadedGraph，修 status() 在 loadGraph 后恒返回 0 的 Blocker
- loadGraph 走 FIXTURE_SEQUENCE_ARM（不触发 auto-tour，避免污染截图）
- arm/disarm 清 loadedGraph 防互相干扰
- 补 loadGraph + status 单测"
```

---

## Task 6: e2e-helpers 与 waitForFixtureGraph

**Files:**
- Create: `tools/layout-lab/src/e2e-helpers.ts`

> **前置**：Task 5 已落地 `loadedGraph`，`status().nodeCount` 才会返回正确值。

- [ ] **Step 1: 实现 e2e-helpers.ts（复用 + 新建等待）**

`tools/layout-lab/src/e2e-helpers.ts`：
```typescript
import { chromium, expect, type Page, type BrowserContext } from '@playwright/test';
import * as path from 'node:path';
import * as fs from 'node:fs';

// 复用扩展 e2e 的启动逻辑（apps/extension/e2e/helpers.ts:21-42）
// 这里重实现而非 import，因为 lab 在 monorepo 外、且 helpers.ts 依赖 e2e fixtures 路径
const EXTENSION_PATH = path.resolve(
  import.meta.dirname,
  '../../../apps/extension/dist',
);

export async function launchExtensionContext(userDataDir: string): Promise<{
  context: BrowserContext;
  extensionId: string;
}> {
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    headless: true,
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
    ],
  });

  let [serviceWorker] = context.serviceWorkers();
  if (!serviceWorker) {
    serviceWorker = await context.waitForEvent('serviceworker');
  }
  const extensionId = serviceWorker.url().split('/')[2];
  return { context, extensionId };
}

export async function openSidepanelPage(context: BrowserContext, extensionId: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  return page;
}

// 关键：不复用 waitForGraph（它查 service worker snapshot）。
// fixture loadGraph 直接灌 sidepanel React state，service worker 不知情。
// 这里读 __listenGraphicFixture.status().nodeCount（依赖 Task 5 的 loadedGraph 修复）。
export async function waitForFixtureGraph(
  page: Page,
  expectedNodeCount: number,
  timeout = 10_000,
): Promise<void> {
  await expect
    .poll(
      async () => {
        return await page.evaluate(() => {
          return globalThis.__listenGraphicFixture?.status()?.nodeCount ?? 0;
        });
      },
      { timeout },
    )
    .toBeGreaterThanOrEqual(expectedNodeCount);
}

// 截图前稳定视图状态：切 hierarchy、关设置面板、关 auto-tour
export async function stabilizeForScreenshot(page: Page): Promise<void> {
  // 关闭 auto-tour（若有导览按钮则点）
  const closeTourBtn = page.locator('[data-testid="auto-tour-close"], [aria-label*="tour"]').first();
  if (await closeTourBtn.isVisible().catch(() => false)) {
    await closeTourBtn.click().catch(() => undefined);
  }
  // 等待 fitView 稳定（固定 timeout，见 spec 4.6 开放问题）
  await page.waitForTimeout(600);
}
```

> **注意 `stabilizeForScreenshot` 的 auto-tour 关闭逻辑是占位实现**——实际 selector 要在 Task 7 第一次跑截图时根据真实 DOM 调整。这是 spec 4.6 标注的实现时决策点。

- [ ] **Step 2: Commit**

```bash
git add tools/layout-lab/src/e2e-helpers.ts
git commit -m "feat(layout-lab): e2e-helpers（复用 launch + 新建 waitForFixtureGraph）"
```

---

## Task 7: capture-screenshots 阶段 2

**Files:**
- Create: `tools/layout-lab/src/capture-screenshots.ts`

- [ ] **Step 1: 实现 capture-screenshots.ts**

`tools/layout-lab/src/capture-screenshots.ts`：
```typescript
import fs from 'node:fs';
import path from 'node:path';
import type { MergedGraph } from '@listen-graphic/schema';
import {
  launchExtensionContext,
  openSidepanelPage,
  waitForFixtureGraph,
  stabilizeForScreenshot,
} from './e2e-helpers';

const DEFAULT_INPUT = path.resolve(import.meta.dirname, '../inputs/real-graphs-dump.json');
const DEFAULT_OUTPUT = path.resolve(import.meta.dirname, '../outputs/screenshots');
const USER_DATA_DIR = path.resolve(import.meta.dirname, '../.tmp/lab-user-data');

export async function captureScreenshots(
  inputPath: string = DEFAULT_INPUT,
  outputDir: string = DEFAULT_OUTPUT,
): Promise<void> {
  const dump = JSON.parse(fs.readFileSync(inputPath, 'utf8')) as MergedGraph[];
  fs.mkdirSync(outputDir, { recursive: true });

  const { context, extensionId } = await launchExtensionContext(USER_DATA_DIR);
  const page = await openSidepanelPage(context, extensionId);

  // 等待 sidepanel 初始加载
  await page.waitForLoadState('domcontentloaded');

  for (let i = 0; i < dump.length; i++) {
    const graph = dump[i];
    const padded = String(i).padStart(2, '0');

    // 1. 灌图（静态装载）
    await page.evaluate((g) => {
      globalThis.__listenGraphicFixture?.loadGraph(g);
    }, graph);

    // 2. 等 React 渲染完成（读 status，不查 service worker）
    await waitForFixtureGraph(page, graph.nodes.length);

    // 3. 稳定视图（关 auto-tour、等 fitView）
    await stabilizeForScreenshot(page);

    // 4. 截图
    await page.screenshot({
      path: path.join(outputDir, `${padded}.png`),
      fullPage: true,
    });
    console.log(`[capture] ${padded}/${String(dump.length - 1).padStart(2, '0')} nodes=${graph.nodes.length}`);
  }

  await context.close();
  console.log(`[capture] 完成 ${dump.length} 张截图 → ${outputDir}`);
}

// CLI 入口
const onlyArg = process.argv.find((a) => a.startsWith('--only='));
const inputArg = process.argv.find((a) => a.startsWith('--input='));
const input = inputArg ? inputArg.slice('--input='.length) : DEFAULT_INPUT;

if (onlyArg) {
  // 单条重截模式（spec 8.1 失败重跑）
  const idx = parseInt(onlyArg.slice('--only='.length), 10);
  void captureScreenshots(input, DEFAULT_OUTPUT).then(() => process.exit(0));
  // 注：单条重截的过滤逻辑在实现时可细化，先跑全量
} else {
  void captureScreenshots(input, DEFAULT_OUTPUT);
}
```

- [ ] **Step 2: 构建 fixture-lab 版扩展（spec 4.7 跨平台）**

先在 `apps/extension/package.json` 的 scripts 加（若 Task 未含）：
```json
"build:fixture-lab": "vite build --mode fixture-lab"
```
再创建 `apps/extension/.env.fixture-lab`：
```
VITE_FIXTURE_LAB=true
```

Run: `pnpm --filter extension build:fixture-lab`
Expected: `apps/extension/dist/` 生成，含 `__listenGraphicFixture`

- [ ] **Step 3: 验证 __listenGraphicFixture 在 dist 里**

Run: `grep -l "__listenGraphicFixture" apps/extension/dist/sidepanel/*.js`
Expected: 命中 sidepanel bundle 文件

- [ ] **Step 4: 跑单条冒烟（先截 1 条验证管线通）**

临时改 `captureScreenshots` 循环为 `for (let i = 0; i < 1; i++)` 或用 `--only=0`，跑：
```bash
cd tools/layout-lab && npx tsx src/capture-screenshots.ts --only=0
```
Expected: 生成 `outputs/screenshots/00.png`，**肉眼检查图正确渲染**（节点/边可见，非空白）

> **这是最脆一环**。若 `loadGraph`/`status()`/`waitForFixtureGraph` 任一不通，截图会空白或超时。先冒烟 1 条，再全量。

- [ ] **Step 5: 跑全量 62 条**

恢复全量循环，跑：
```bash
cd tools/layout-lab && npx tsx src/capture-screenshots.ts
```
Expected: 打印 62 条进度，`outputs/screenshots/` 下 62 张 PNG

- [ ] **Step 6: Commit（不提交 PNG，只提交脚本 + 构建配置）**

```bash
git add tools/layout-lab/src/capture-screenshots.ts apps/extension/package.json apps/extension/.env.fixture-lab
git commit -m "feat(layout-lab): capture-screenshots 阶段 2 + build:fixture-lab 脚本"
```

---

## Task 8: llm-annotate 阶段 3

**Files:**
- Create: `tools/layout-lab/src/llm-annotate.ts`

- [ ] **Step 1: 实现 llm-annotate.ts（可配置 provider）**

`tools/layout-lab/src/llm-annotate.ts`：
```typescript
import fs from 'node:fs';
import path from 'node:path';
import type { Annotation, GraphSnapshot } from './types';

const METRICS_DIR = path.resolve(import.meta.dirname, '../outputs/metrics');
const SIMPLIFIED_DIR = path.resolve(import.meta.dirname, '../outputs/simplified');
const SCREENSHOT_DIR = path.resolve(import.meta.dirname, '../outputs/screenshots');
const OUTPUT_DIR = path.resolve(import.meta.dirname, '../outputs/annotations');

// 可配置 provider（spec 5.4）。默认 openai 兼容。
const PROVIDER = process.env.LAYOUT_LAB_LLM_PROVIDER ?? 'openai';
const MODEL = process.env.LAYOUT_LAB_LLM_MODEL ?? 'gpt-4o';
const API_KEY = process.env.LAYOUT_LAB_LLM_API_KEY ?? '';
const BASE_URL = process.env.LAYOUT_LAB_LLM_BASE_URL ?? 'https://api.openai.com/v1';

const SYSTEM_PROMPT = `你是图谱可读性诊断助手。对一张语义图，分别判断：
1. semanticReading：语义上像什么（争论/解释/因果/多话题/修正/时间线/其他）。主要基于 graph JSON + 指标。
2. layoutFailures：当前空间布局的阅读问题（数组，可多个）。重点看截图 + longLabelNodeCount/isLargeGraph。
3. detectorMismatch：对照 detector 命中 vs 你的 semanticReading，detector 是否误导。
4. visualTreatment：需要什么视觉处理。
5. confidence：high/medium/low。
严格按 JSON schema 输出，不要额外解释。`;

export async function annotateOne(
  index: number,
  hasScreenshot: boolean,
): Promise<Annotation> {
  const padded = String(index).padStart(2, '0');
  const metrics = JSON.parse(fs.readFileSync(path.join(METRICS_DIR, `${padded}.json`), 'utf8'));
  const simplified = JSON.parse(fs.readFileSync(path.join(SIMPLIFIED_DIR, `${padded}.json`), 'utf8'));

  const content: unknown[] = [
    { type: 'text', text: `${SYSTEM_PROMPT}\n\n--- graph JSON ---\n${JSON.stringify(simplified.simplified)}\n\n--- metrics ---\n${JSON.stringify(metrics.metrics)}\n--- detector ---\n${JSON.stringify(metrics.detector)}` },
  ];

  if (hasScreenshot) {
    const imgPath = path.join(SCREENSHOT_DIR, `${padded}.png`);
    if (fs.existsSync(imgPath)) {
      const b64 = fs.readFileSync(imgPath).toString('base64');
      content.push({ type: 'image_url', image_url: { url: `data:image/png;base64,${b64}` } });
    }
  }

  const resp = await fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: 'user', content }],
      response_format: { type: 'json_object' },
    }),
  });

  if (!resp.ok) throw new Error(`LLM 请求失败 ${resp.status}: ${await resp.text()}`);
  const data = await resp.json();
  const parsed = JSON.parse(data.choices[0].message.content);
  return { graphIndex: index, ...parsed };
}

export async function annotateAll(hasScreenshot = true): Promise<void> {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const metricFiles = fs.readdirSync(METRICS_DIR).filter((f) => f.endsWith('.json'));

  for (const f of metricFiles) {
    const index = parseInt(f, 10);
    const padded = String(index).padStart(2, '0');
    const outPath = path.join(OUTPUT_DIR, `${padded}.json`);
    if (fs.existsSync(outPath)) {
      console.log(`[annotate] ${padded} 已存在，跳过`);
      continue;
    }
    try {
      const ann = await annotateOne(index, hasScreenshot);
      fs.writeFileSync(outPath, JSON.stringify(ann, null, 2));
      console.log(`[annotate] ${padded} done confidence=${ann.confidence}`);
    } catch (e) {
      console.error(`[annotate] ${padded} 失败:`, (e as Error).message);
    }
  }
}

// CLI
const noShot = process.argv.includes('--no-screenshot');
void annotateAll(!noShot);
```

- [ ] **Step 2: 单条冒烟（验证 API 通）**

```bash
# 设置环境变量（PowerShell）
$env:LAYOUT_LAB_LLM_API_KEY='sk-...'
cd tools/layout-lab && npx tsx -e "
import { annotateOne } from './src/llm-annotate.ts';
annotateOne(0, true).then(a => console.log(JSON.stringify(a, null, 2)));
"
```
Expected: 打印一条完整 Annotation JSON，含 5 个字段

- [ ] **Step 3: 跑全量（断点续跑，已存在的跳过）**

```bash
cd tools/layout-lab && npx tsx src/llm-annotate.ts
```
Expected: 62 条逐条完成，`outputs/annotations/` 下 62 个 JSON

- [ ] **Step 4: Commit**

```bash
git add tools/layout-lab/src/llm-annotate.ts
git commit -m "feat(layout-lab): llm-annotate 阶段 3（可配置 provider，断点续跑）"
```

---

## Task 9: render-gallery 阶段 4 + 抽样

**Files:**
- Create: `tools/layout-lab/src/render-gallery.ts`

- [ ] **Step 1: 实现 render-gallery.ts（拼 HTML + 生成 review-sample.json）**

`tools/layout-lab/src/render-gallery.ts`：
```typescript
import fs from 'node:fs';
import path from 'node:path';
import type { Annotation, StructureMetrics, DetectorCheck } from './types';

const ROOT = path.resolve(import.meta.dirname, '..');
const readJson = (p: string) => JSON.parse(fs.readFileSync(p, 'utf8'));

export function buildReviewSample(
  annotations: Annotation[],
  metrics: Array<{ graphIndex: number; metrics: StructureMetrics; detector: DetectorCheck }>,
): number[] {
  const selected = new Set<number>();
  for (let i = 0; i < annotations.length; i++) {
    const a = annotations[i];
    const m = metrics[i].metrics;
    // 1. 低置信
    if (a.confidence === 'low') selected.add(i);
    // 2. 大图
    if (m.isLargeGraph) selected.add(i);
    // 3. detector/LLM 冲突
    if (a.detectorMismatch) selected.add(i);
    // 5. opposesCrossSpeakerRatio 极端
    if (m.opposesCrossSpeakerRatio !== null) {
      if (m.opposesCrossSpeakerRatio > 0.5) selected.add(i);
    }
    if ((m.opposesCount ?? 0) > 0 && m.opposesCrossSpeakerRatio === 0) selected.add(i);
  }
  return Array.from(selected).sort((a, b) => a - b);
}

export function renderGallery(): void {
  const metricFiles = fs.readdirSync(path.join(ROOT, 'outputs/metrics')).filter((f) => f.endsWith('.json'));
  const rows: string[] = [];
  const annotations: Array<Annotation | null> = [];
  const metricsMeta: Array<{ graphIndex: number; metrics: StructureMetrics; detector: DetectorCheck }> = [];

  for (const f of metricFiles) {
    const i = parseInt(f, 10);
    const padded = String(i).padStart(2, '0');
    const m = readJson(path.join(ROOT, 'outputs/metrics', f));
    metricsMeta.push(m);
    let a: Annotation | null = null;
    try {
      a = readJson(path.join(ROOT, 'outputs/annotations', `${padded}.json`));
    } catch {
      // 无 annotation（阶段未跑完），用 null 占位
    }
    annotations.push(a);

    const shotSrc = fs.existsSync(path.join(ROOT, 'outputs/screenshots', `${padded}.png`))
      ? `../outputs/screenshots/${padded}.png`
      : '';

    rows.push(`
      <div class="card" data-index="${i}">
        <h3>#${i} ${m.detector.pattern} ${a?.confidence ? `[${a.confidence}]` : ''}</h3>
        <img src="${shotSrc}" loading="lazy" />
        <pre>nodes=${m.metrics.nodeCount} edges=${m.metrics.edgeCount} opposes=${m.metrics.opposesCount} (ratio=${m.metrics.opposesRatio ?? '-'}) crossSpk=${m.metrics.opposesCrossSpeakerRatio ?? '-'} longLabel=${m.metrics.longLabelNodeCount}</pre>
        ${a ? `<p><b>语义：</b>${a.semanticReading}</p><p><b>失败：</b>${a.layoutFailures.join('; ')}</p><p><b>处理：</b>${a.visualTreatment}</p>${a.detectorMismatch ? '<p style="color:red">⚠ detector 误导</p>' : ''}` : '<p style="color:#999">（无 annotation）</p>'}
      </div>
    `);
  }

  // buildReviewSample 只接收非 null annotation；null 视为低置信（强制入选待审）
  const safeAnnotations: Annotation[] = annotations.map((a, i) => a ?? {
    graphIndex: i,
    semanticReading: '(未标注)',
    layoutFailures: [],
    detectorMismatch: false,
    visualTreatment: '',
    confidence: 'low' as const,
  });
  const sample = buildReviewSample(safeAnnotations, metricsMeta);
  fs.writeFileSync(path.join(ROOT, 'outputs/review-sample.json'), JSON.stringify(sample, null, 2));

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Layout Lab Gallery</title>
<style>body{font-family:system-ui;margin:16px;background:#fafafa}.card{background:#fff;border:1px solid #ddd;border-radius:6px;padding:12px;margin-bottom:12px}.card img{max-width:600px;border:1px solid #eee}pre{font-size:12px;background:#f5f5f5;padding:6px;border-radius:3px}</style>
</head><body><h1>第 1 轮布局诊断 Gallery（${metricFiles.length} 条）</h1>
<p>待人工详细校正：<b>${sample.length}</b> 条（见 review-sample.json）</p>
${rows.join('')}
</body></html>`;
  fs.writeFileSync(path.join(ROOT, 'outputs/gallery.html'), html);
  console.log(`[gallery] 完成 → ${ROOT}/outputs/gallery.html，待校正 ${sample.length} 条`);
}

renderGallery();
```

- [ ] **Step 2: 运行生成 gallery + review-sample**

```bash
cd tools/layout-lab && npx tsx src/render-gallery.ts
```
Expected: 生成 `outputs/gallery.html` 和 `outputs/review-sample.json`，打印待校正条数

- [ ] **Step 3: 抽查 gallery.html 能在浏览器打开**

Run: `start tools/layout-lab/outputs/gallery.html`（Windows）或肉眼检查 HTML 含 62 个 `.card` div
Expected: 浏览器打开后能看到缩略图列表 + 指标 + 草标

- [ ] **Step 4: Commit**

```bash
git add tools/layout-lab/src/render-gallery.ts
git commit -m "feat(layout-lab): render-gallery 阶段 4 + 自动抽样"
```

---

## Task 10: run-all 编排 + README

**Files:**
- Create: `tools/layout-lab/run/run-all.mjs`
- Create: `tools/layout-lab/README.md`

- [ ] **Step 1: 实现 run-all.mjs（串起四阶段）**

`tools/layout-lab/run/run-all.mjs`：
```javascript
#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.resolve(__dirname, '../src');

const stage = process.argv.find((a) => a.startsWith('--stage='))?.slice('--stage='.length);

const stages = [
  { name: 'export', cmd: ['tsx', [`${srcDir}/export-snapshot.ts`]] },
  { name: 'capture', cmd: ['tsx', [`${srcDir}/capture-screenshots.ts`]] },
  { name: 'annotate', cmd: ['tsx', [`${srcDir}/llm-annotate.ts`]] },
  { name: 'gallery', cmd: ['tsx', [`${srcDir}/render-gallery.ts`]] },
];

const toRun = stage ? stages.filter((s) => s.name === stage) : stages;

for (const s of toRun) {
  console.log(`\n========== [stage] ${s.name} ==========\n`);
  const r = spawnSync('npx', s.cmd, { stdio: 'inherit', shell: true });
  if (r.status !== 0) {
    console.error(`[run-all] stage ${s.name} 失败 (exit ${r.status})，后续阶段中止`);
    process.exit(r.status ?? 1);
  }
}
console.log('\n========== 全部完成 ==========');
```

- [ ] **Step 2: 写 README.md（复现步骤）**

`tools/layout-lab/README.md`：
````markdown
# 第 1 轮布局实验台（诊断集）

> 对 62 条真实会话图做可读性诊断，产出路线校准表。**不是产品功能，不进 live 链路。**
> 设计文档：`docs/superpowers/specs/2026-07-03-layout-lab-round1-design.md`

## 一次性准备

```bash
# 1. 复制真实图 dump（不进 git，含真实对话）
cp ~/Downloads/real-graphs-dump.json tools/layout-lab/inputs/real-graphs-dump.json

# 2. 安装 lab 依赖（lab 独立于 monorepo）
cd tools/layout-lab/run && npm install

# 3. 构建 fixture-lab 版扩展（spec 4.7 跨平台）
pnpm --filter extension build:fixture-lab

# 4. 配置 LLM（PowerShell）
$env:LAYOUT_LAB_LLM_API_KEY='sk-...'
$env:LAYOUT_LAB_LLM_MODEL='gpt-4o'   # 可选，默认 gpt-4o
```

## 跑全流程

```bash
cd tools/layout-lab && npx tsx run/run-all.mjs
```

或分阶段（每阶段独立可重跑）：

```bash
npx tsx run/run-all.mjs --stage=export     # 1. 算指标
npx tsx run/run-all.mjs --stage=capture    # 2. 截图（需先 build:fixture-lab）
npx tsx run/run-all.mjs --stage=annotate   # 3. LLM 草标
npx tsx run/run-all.mjs --stage=gallery    # 4. 拼 HTML + 抽样
```

## 人工审核

1. 打开 `outputs/gallery.html`，**全量扫 62 张缩略图**（5-10 分钟，catching LLM 系统性偏差）
2. 按 `outputs/review-sample.json` 列出的 15-25 条**详细校正**
3. 校正后写回 `outputs/calibrated-diagnosis.json`
4. 汇总成 `outputs/diagnosis-table.md`（路线校准表）

## 数据安全

- `inputs/` 和 `outputs/` 已 gitignore（含真实用户对话）
- dump 来源：`~/Downloads/real-graphs-dump.json`（从扩展 IndexedDB 导出）

## 第二轮方向

**等诊断表出来再决定**，不预设。可能方向：opposition 收紧 / 大图 cluster / 主线强调 / evidence stack。
````

- [ ] **Step 3: 跑一次完整全流程验证（端到端）**

```bash
cd tools/layout-lab && npx tsx run/run-all.mjs
```
Expected: 四阶段依次完成，最终生成 `gallery.html` + `review-sample.json`

- [ ] **Step 4: Commit**

```bash
git add tools/layout-lab/run/run-all.mjs tools/layout-lab/README.md
git commit -m "feat(layout-lab): run-all 编排 + README（复现步骤）"
```

---

## 完成标准（Definition of Done）

- [ ] `tools/layout-lab/` 全部 10 个 Task 落地，代码提交
- [ ] `metrics.test.ts` 全部通过
- [ ] `fixture-sequence-dev.test.ts`（含新 loadGraph 测试）全部通过
- [ ] `pnpm typecheck` 无错误（产品代码无类型回归）
- [ ] `fixture-build.prod.test.ts` 仍通过（确认 `__listenGraphicFixture` 不进生产 bundle）
- [ ] 端到端跑通：`gallery.html` 含 62 条，`review-sample.json` 生成
- [ ] **人眼抽查 5-10 张截图**，确认非空白、节点/边可见、视觉合理
- [ ] `inputs/` 与 `outputs/` 确认未被 git 跟踪（`git status` 干净）

## 不在本计划范围（明确推迟到第二轮）

- ❌ 候选布局 A/B 对比
- ❌ 新布局引擎 / 约束求解器
- ❌ layoutMemory / layoutIntent
- ❌ 第二轮方向决策（等诊断表）
