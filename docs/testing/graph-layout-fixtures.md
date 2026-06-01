# Graph layout fixtures（排版实验）

共享数据包 `@listen-graphic/graph-fixtures` 提供 revision 序列，用于 Extension 侧栏的 **DEV 图状态投递器** 与 web-demo 的拓扑预览。设计说明见 `docs/superpowers/specs/2026-05-27-graph-layout-fixtures-design.md`。

---

## 前置条件（Extension 肉眼实验）

1. 在 `apps/extension` 下构建并监听开发包：`pnpm dev:chrome`（或根目录 `pnpm --filter extension dev:chrome`）
2. Chrome 加载解压目录：`apps/extension/dist`（不是 localhost:5173）
2. 在 Chrome 中打开扩展 **侧栏**（不是 content script 页、不是普通网页）
3. 打开侧栏 DevTools → **Console**（API 挂在侧栏 `globalThis`）

---

## 控制台 API（`__listenGraphicFixture`）

仅 **DEV** 构建存在；生产 `dist/sidepanel/*.js` 不得包含该符号（见 `fixture-build.prod.test.ts`）。

| 方法 | 说明 |
|------|------|
| `list()` | 返回已注册的 sequence id 列表 |
| `arm(id)` | 加载 sequence；执行 Lab Reset；投递 step 0；注册键盘监听 |
| `disarm()` | 卸载键盘；`isArmed = false` |
| `next()` | 投递下一步 `MERGED_GRAPH_UPDATED`；成功返回 `true`，无下一步返回 `false` |
| `prev()` | 回退一步并投递对应图 |
| `reset()` | 对当前 id 重新 `arm` |
| `status()` | `{ isArmed, id, step, total, revision, nodeCount, edgeCount }` — 用 **`isArmed`** 确认 arm 是否生效 |

速查：

```js
__listenGraphicFixture.list();
__listenGraphicFixture.arm('seq-incremental-growth');
__listenGraphicFixture.status();
__listenGraphicFixture.next();
__listenGraphicFixture.disarm();
```

每步会在 **LogPanel** 出现形如 `[fixture] seq-incremental-growth 3/8 | rev=3 | nodes=12` 的行。

---

## 键盘（侧栏 focus）

在 `arm()` 之后，监听挂在 **侧栏 `window`**：

| 键 | 行为 |
|----|------|
| `]` | `next()` |
| `[` | `prev()` |
| `Esc` | `reset()`（回到 step 0 并 Lab Reset） |

焦点在 `input` / `textarea` / `contentEditable` 时不触发。

---

## 推荐实验脚本（autofit / 缩放）

专测 Extension **readable autofit** 与手动缩放冲突（非 web-demo）：

1. `arm('seq-incremental-growth')`
2. 等待首屏 **autofit**（有节点后应 fit 一次）
3. 手动 **缩小** 画布（滚轮或 Controls）
4. `next()` 连续 3 次
5. **观察**：视图不应被再次强制 fit；LogPanel 步进正常；新节点不应抢用户缩放

可选：`seq-late-burst`（突增节点 + auto-tour）、`seq-view-switch-mid`（中段 `viewHints` 变化）。

语义图形模式抽检：

```js
__listenGraphicFixture.arm('seq-pattern-question-three-points');
__listenGraphicFixture.next();
__listenGraphicFixture.arm('seq-pattern-claim-reason-example');
__listenGraphicFixture.next();
__listenGraphicFixture.arm('seq-pattern-opposition');
__listenGraphicFixture.next();
__listenGraphicFixture.arm('seq-pattern-causal-chain');
__listenGraphicFixture.next();
__listenGraphicFixture.arm('seq-pattern-timeline-note');
__listenGraphicFixture.next();
```

这些 fixture 不经过 ASR / structurer；它们直接投递固定 graph，用来观察一眼是否能读出“问题分三点”“观点-理由-例子”“A 反对 B”“因果链”“时间线补充说明”。

---

## web-demo 能力边界

> web-demo sequence **只验证**：节点/边数量变化、视图类型切换、`graph-renderers` 过滤结果。  
> **不验证**：stable layout、readable autofit、`layoutCache`、auto-tour、用户缩放冲突。  
> **autofit 与排版结论以 Extension 为准。**

预览方式：

```text
pnpm dev:web
# http://localhost:5173/?sequence=seq-incremental-growth
```

`ArrowRight` / `ArrowLeft` 切换步；页眉显示 `sequence step i/n`。

---

## Playwright：侧栏 `evaluate` 示例

必须在 **extension sidepanel page** 上调用，不要在 content script 或 fixture HTML 页。

```ts
import { test } from '@playwright/test';

test('fixture sequence step on sidepanel', async ({ page: sidepanelPage }) => {
  // sidepanelPage = 已打开的扩展侧栏页
  await sidepanelPage.evaluate(() => {
    globalThis.__listenGraphicFixture?.arm('seq-incremental-growth');
    globalThis.__listenGraphicFixture?.next();
    return globalThis.__listenGraphicFixture?.status();
  });
});
```

本地抽检排版时可配合截图；**CI 不以 Playwright 为主**（Vitest `playSequenceAndAssert` 覆盖 autofit 契约）。

---

## 与其它测试入口的分工

| 入口 | 数据 | 驱动 | 主要验证 |
|------|------|------|----------|
| **Fixture sequence（DEV）** | `packages/graph-fixtures` 预置 `steps[].graph` | 控制台 / `]` `[` → `MERGED_GRAPH_UPDATED` | stable layout、autofit、layoutCache、auto-tour、缩放冲突 |
| **`pnpm test:ext:replay`** | 真实/录制的 transcript、utterance | structurer + merge 管线 | 结构化质量、ASR、normalize/merge 回归 |
| **Mock E2E**（`pnpm test:ext:e2e` / `extension.local.spec.ts`） | E2E fixture 音频 + mock provider | 完整 UI 闭环（开始/停止/导出等） | 少量高价值用户路径，非排版细节 |
| **Vitest `App.fixture-sequence.test.tsx`** | 同包 sequence | `playSequenceAndAssert` 直投 reducer | `fitView` 次数等自动化断言 |
| **web-demo `?sequence=`** | 同包 JSON（bundled） | `ArrowRight` / `Left` → `setGraph` | 拓扑 + graph-renderers；**不** 代表 Extension 排版 |

原则：**排版 / autofit 结论以 Extension DEV + Vitest 为准**；replay 与 E2E 不替代 fixture 实验室。

---

## 包内 fixture 列表

| id | 用途 |
|----|------|
| `seq-incremental-growth` | ~8 步，节点渐增，autofit 仅首屏 |
| `seq-late-burst` | 前少后多，突增 ~15 节点 |
| `seq-view-switch-mid` | 中段切换 `viewHints.defaultView` |
| `seq-pattern-question-three-points` | 问题节点 fanout 到三个 claim 分点 |
| `seq-pattern-claim-reason-example` | 观点 -> 理由 -> 例子 |
| `seq-pattern-opposition` | 一个 claim 反对另一个 claim，并附支撑理由 |
| `seq-pattern-causal-chain` | 因果链 |
| `seq-pattern-timeline-note` | 时间线主链 + 补充说明 |

校验：`pnpm --filter @listen-graphic/graph-fixtures test:run`
