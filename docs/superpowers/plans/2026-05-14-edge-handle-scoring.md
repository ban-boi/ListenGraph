# Edge Handle 评分选优算法 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 替换 `resolveEdgeHandles` 的分区逻辑为评分选优算法，只从 4 个可见 handle 组合中选最优，消除隐藏 handle 泄漏和对角线死区。

**Architecture:** 纯函数替换，不改函数签名、不改调用方、不改 GraphNodeCard 组件。评分算法遍历 4 个可见组合，用方向向量点积计算对齐分数，取最高分。

**Tech Stack:** TypeScript, Vitest

**Design spec:** `docs/superpowers/specs/2026-05-14-edge-handle-scoring-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `apps/extension/src/sidepanel/graph-utils.ts` | 修改 | 替换 `resolveEdgeHandles`，删除 `EDGE_AXIS_DOMINANCE_RATIO`，新增常量和辅助函数 |
| `apps/extension/src/sidepanel/graph-utils.test.ts` | 修改 | 替换旧测试，覆盖 8 个 spec 场景 |

---

### Task 1: 写新测试用例（RED）

**Files:**
- Modify: `apps/extension/src/sidepanel/graph-utils.test.ts`

- [ ] **Step 1: 替换整个测试文件为新的 8 个测试用例**

```ts
import { describe, it, expect } from 'vitest';
import { resolveEdgeHandles } from './graph-utils';

describe('resolveEdgeHandles', () => {
  it('正上→正下：bottom→top', () => {
    expect(
      resolveEdgeHandles({ x: 60, y: 0 }, { x: 60, y: 200 }),
    ).toEqual({
      sourceHandle: 'source-bottom',
      targetHandle: 'target-top',
    });
  });

  it('正下→正上：bottom→top（可见组合中最优向上路径）', () => {
    expect(
      resolveEdgeHandles({ x: 60, y: 240 }, { x: 60, y: 0 }),
    ).toEqual({
      sourceHandle: 'source-bottom',
      targetHandle: 'target-top',
    });
  });

  it('正左→正右：right→left', () => {
    expect(
      resolveEdgeHandles({ x: 60, y: 0 }, { x: 420, y: 10 }),
    ).toEqual({
      sourceHandle: 'source-right',
      targetHandle: 'target-left',
    });
  });

  it('正右→正左：right→left', () => {
    expect(
      resolveEdgeHandles({ x: 420, y: 0 }, { x: 60, y: 10 }),
    ).toEqual({
      sourceHandle: 'source-right',
      targetHandle: 'target-left',
    });
  });

  it('右下→左上（反向 edge）：bottom→top', () => {
    expect(
      resolveEdgeHandles({ x: 340, y: 0 }, { x: 60, y: 200 }),
    ).toEqual({
      sourceHandle: 'source-bottom',
      targetHandle: 'target-top',
    });
  });

  it('左下→右上（反向 edge）：right→left', () => {
    expect(
      resolveEdgeHandles({ x: 60, y: 200 }, { x: 340, y: 0 }),
    ).toEqual({
      sourceHandle: 'source-right',
      targetHandle: 'target-left',
    });
  });

  it('分支→主节点：bottom→top', () => {
    expect(
      resolveEdgeHandles({ x: 340, y: 100 }, { x: 60, y: 300 }),
    ).toEqual({
      sourceHandle: 'source-bottom',
      targetHandle: 'target-top',
    });
  });

  it('对角线死区：选择最顺的组合，不使用隐藏 handle', () => {
    const result = resolveEdgeHandles({ x: 60, y: 0 }, { x: 240, y: 180 });
    expect(
      result.sourceHandle === 'source-bottom' || result.sourceHandle === 'source-right',
    ).toBe(true);
    expect(
      result.targetHandle === 'target-top' || result.targetHandle === 'target-left',
    ).toBe(true);
    expect(result.sourceHandle).not.toBe('source-top');
    expect(result.sourceHandle).not.toBe('source-left');
    expect(result.targetHandle).not.toBe('target-bottom');
    expect(result.targetHandle).not.toBe('target-right');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
cd apps/extension && pnpm test:run -- --reporter=verbose graph-utils.test.ts
```

预期：至少"正下→正上"和"正右→正左"测试失败（旧算法返回隐藏 handle），"对角线死区"也失败。

---

### Task 2: 实现评分选优算法（GREEN）

**Files:**
- Modify: `apps/extension/src/sidepanel/graph-utils.ts`

- [ ] **Step 1: 删除 `EDGE_AXIS_DOMINANCE_RATIO` 常量**

删除 `graph-utils.ts` 第 43 行：

```ts
const EDGE_AXIS_DOMINANCE_RATIO = 1.25;
```

- [ ] **Step 2: 在 `getRectCenter` 函数之后、`resolveEdgeHandles` 之前，新增常量和辅助函数**

```ts
const VISIBLE_HANDLE_COMBINATIONS = [
  { sourceHandle: 'source-bottom', targetHandle: 'target-top' },
  { sourceHandle: 'source-bottom', targetHandle: 'target-left' },
  { sourceHandle: 'source-right', targetHandle: 'target-top' },
  { sourceHandle: 'source-right', targetHandle: 'target-left' },
] as const;

const EXIT_DIRECTIONS: Record<string, [number, number]> = {
  'source-bottom': [0, 1],
  'source-right': [1, 0],
};

const ENTRY_DIRECTIONS: Record<string, [number, number]> = {
  'target-top': [0, 1],
  'target-left': [1, 0],
};

function getHandlePosition(
  rect: { left: number; right: number; top: number; bottom: number },
  handleId: string,
): { x: number; y: number } {
  const cx = (rect.left + rect.right) / 2;
  const cy = (rect.top + rect.bottom) / 2;
  if (handleId === 'source-bottom' || handleId === 'target-bottom') return { x: cx, y: rect.bottom };
  if (handleId === 'source-top' || handleId === 'target-top') return { x: cx, y: rect.top };
  if (handleId === 'source-right' || handleId === 'target-right') return { x: rect.right, y: cy };
  return { x: rect.left, y: cy };
}
```

- [ ] **Step 3: 替换 `resolveEdgeHandles` 函数体**

```ts
export function resolveEdgeHandles(
  sourcePosition: StableNodePosition,
  targetPosition: StableNodePosition,
): {
  sourceHandle: SourceHandleId;
  targetHandle: TargetHandleId;
} {
  const sourceRect = getNodeRect(sourcePosition);
  const targetRect = getNodeRect(targetPosition);

  let bestScore = -Infinity;
  let bestCombo = VISIBLE_HANDLE_COMBINATIONS[0];
  let bestDist = Infinity;

  for (const combo of VISIBLE_HANDLE_COMBINATIONS) {
    const hs = getHandlePosition(sourceRect, combo.sourceHandle);
    const ht = getHandlePosition(targetRect, combo.targetHandle);

    const dx = ht.x - hs.x;
    const dy = ht.y - hs.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist === 0) continue;

    const nx = dx / dist;
    const ny = dy / dist;

    const [ex, ey] = EXIT_DIRECTIONS[combo.sourceHandle];
    const [tx, ty] = ENTRY_DIRECTIONS[combo.targetHandle];

    const score = (nx * ex + ny * ey) + (nx * tx + ny * ty);

    if (score > bestScore || (score === bestScore && dist < bestDist)) {
      bestScore = score;
      bestCombo = combo;
      bestDist = dist;
    }
  }

  return {
    sourceHandle: bestCombo.sourceHandle as SourceHandleId,
    targetHandle: bestCombo.targetHandle as TargetHandleId,
  };
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
cd apps/extension && pnpm test:run -- --reporter=verbose graph-utils.test.ts
```

预期：全部 8 个测试 PASS。

---

### Task 3: 回归测试 + 提交

- [ ] **Step 1: 运行完整扩展测试套件**

```bash
cd apps/extension && pnpm test:run
```

预期：全部通过，无回归。

- [ ] **Step 2: 运行 TypeScript 类型检查**

```bash
cd apps/extension && pnpm exec tsc --noEmit
```

预期：无类型错误。

- [ ] **Step 3: 提交**

```bash
git add apps/extension/src/sidepanel/graph-utils.ts apps/extension/src/sidepanel/graph-utils.test.ts
git commit -m "feat(graph): resolveEdgeHandles 改用评分选优算法，只选可见 handle 组合"
```

---

### Task 4: 视觉验证

- [ ] **Step 1: 启动扩展开发服务器**

```bash
pnpm dev:ext
```

- [ ] **Step 2: 在 Chrome 中加载扩展，打开侧边栏**

- [ ] **Step 3: 启动一次会话，确认边的连线走向自然**

重点观察：
- 分支节点→主节点的边不再绕弯
- 对角线关系的边选择合理的 handle
- 所有连接点的小圆点都可见（无隐藏 handle 泄漏）
