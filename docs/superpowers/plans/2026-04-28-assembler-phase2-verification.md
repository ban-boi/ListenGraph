# Assembler Phase 2 验证计划：全量 Replay Baseline + 边界 Fixture

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 验证 assembler Phase 1/2 对所有现有 replay fixtures 无明显回归，并通过边界反例 fixture 确认 merge_with_prev 规则不会过度激进。

**Architecture:** 两层验证——第一层跑全量 replay baseline（纯脚本，不改代码），对比三项硬 KPI；第二层补充 2-3 条合成 fixture 覆盖 merge_with_prev 的误合并/误延迟风险场景。

**Tech Stack:** Vitest replay fixtures、`report-structure-unit-ws-kpis.mjs`（离线 KPI 模拟）、`run-structure-replay-strict.mjs`（真实 structurer 回归）、JSON fixture 文件。

---

## 前置知识

### 当前 replay-realtime fixtures（5 条）

| Fixture | 来源 | 特点 |
|---------|------|------|
| `replay-realtime-debate-response-world` | 黄执中/周玄毅辩论 | 3 chunks |
| `replay-realtime-ruyu-pang-zhan-opening` | 鲁豫/庞颖/詹青云对话开场 | 3+ chunks |
| `replay-realtime-law-constraint` | 罗翔讲座 | 2 chunks |
| `replay-realtime-roundtable-opening` | 圆桌开场 | multi-chunk |
| `replay-realtime-merge-with-prev-boundary` | 合成 | 5 chunks，含 merge_with_prev 正样本 |

### 三项硬 KPI

1. **首图延迟** (`firstGraphLatencyMs`) — p50/p95 不应明显变差
2. **structurer 调用频率** (`structurerCallsPerMinute`) — 不应失控升高
3. **空输出比率** (`emptyOutputRatio`) — 不应升高

### 关键脚本

| 脚本 | 作用 | 命令 |
|------|------|------|
| `report-structure-unit-ws-kpis.mjs` | 离线模拟 assembler 决策，输出 KPI | `pnpm test:structure:ws:kpi` |
| `run-structure-replay-strict.mjs` | 对每条 replay fixture 调用真实 structurer | `pnpm test:structure:real:replay:strict` |

---

## 第一层：全量 Replay Baseline

### Task 1: 运行离线 KPI 模拟（不含真实 API 调用）

**目的：** 快速获取 assembler 对全部 5 条 replay fixtures 的决策模拟结果，作为 baseline 数字。这一步纯本地运行，不需要 API key。

**Files:**
- Read: `apps/extension/scripts/report-structure-unit-ws-kpis.mjs`
- Read: `apps/extension/src/service-worker/fixtures/structure/replay-realtime-*.json`

- [ ] **Step 1: 运行 KPI 模拟脚本**

```bash
cd apps/extension && pnpm test:structure:ws:kpi
```

预期输出包含：
- Summary 区：`firstGraphLatencyMs p50/p95/max`、`averageStructurerCallsPerMinute`、`mergeWithPrevCommits`、`emptyOutputRatio`
- Fixtures 区：每条 fixture 的 `firstGraphLatencyMs`、`callsPerMinute`、`commits`、`mergeWithPrev` 次数、`lowInfoSkips`、`avgUtterancesPerCommit`

- [ ] **Step 2: 记录 baseline 数字**

将输出复制到本会话或文档中，作为对照基准。重点关注：
- 每条 fixture 的 `commits` 数量
- `mergeWithPrev` 出现在哪些 fixture 中（当前只有 `merge-with-prev-boundary` 应出现）
- `firstGraphLatencyMs` 是否有异常高值
- `emptyOutputRatio` — 此项来自历史 diagnostic artifacts，若无历史数据则显示 `n/a`

- [ ] **Step 3: 检查是否有 fixture 的 assembler 决策明显异常**

审查每条 fixture 的 `assemblerRuns` 细节（如需详细输出可加 `--json` 参数）：
- 是否有 fixture 在不该 commit 的时候 commit 了？
- 是否有 fixture 在该 commit 的时候一直 wait（导致 `commitCount=0`）？
- `lowInfoSkips` 是否合理？

---

### Task 2: 运行全量真实 structurer replay strict

**目的：** 用真实 structurer API 跑全部 replay fixtures，验证 assembler 引入后每条 fixture 仍能通过 acceptance 断言。这一步需要 API credentials。

**前置条件：** 环境变量 `LISTEN_GRAPHIC_E2E_STRUCTURER_TYPE` 和 `LISTEN_GRAPHIC_E2E_STRUCTURER_API_KEY` 已设置。

**Files:**
- Read: `apps/extension/scripts/run-structure-replay-strict.mjs`

- [ ] **Step 1: Dry-run 确认 fixture 列表和配置**

```bash
cd apps/extension && node ./scripts/run-structure-replay-strict.mjs --dry-run
```

预期：输出 JSON 包含 5 条 fixture 名称和 env 配置。

- [ ] **Step 2: 运行全量 strict replay**

```bash
cd apps/extension && pnpm test:structure:real:replay:strict
```

此命令会依次跑 5 条 fixture，每条之间间隔 60s（默认 `DELAY_MS=60000`）。每条 fixture 超时 180s。总耗时约 15-20 分钟。

预期：全部 fixture 通过（exit code 0），或只有已知的 provider 不稳定导致的偶发失败。

- [ ] **Step 3: 检查 strict summary artifacts**

```bash
ls -t src/service-worker/fixtures/structure/artifacts/provider-instability/strict-summary-*.json | head -1
```

读取最新 summary，确认：
- `strict: true`（表示不允许 external skip）
- 每条 fixture 的 `exitCode` 为 0
- 如果有失败，检查 `outputTail` 中的错误信息

- [ ] **Step 4: 重新运行 KPI 脚本获取含真实 emptyOutputRatio 的 baseline**

```bash
cd apps/extension && pnpm test:structure:ws:kpi
```

此时 `emptyOutputRatio` 应不再显示 `n/a`（因为上一步产生了 diagnostic artifacts），记录下真实的空输出比率。

- [ ] **Step 5: 对比结论**

如果全量 strict 通过 + KPI 无明显回归，可以得出结论：**Phase 1/2 对现有样本集无明显回归**。

如果某条 fixture 失败或 KPI 异常，记录具体 fixture 名称和异常指标，作为后续调查的输入。

---

## 第二层：补充边界 Fixture

### Task 3: 编写 fixture — "完整句但句中包含 setup-tail 词"

**目的：** 测试反例——一句话本身语义完整且以句号收束，但句中包含 `核心是`、`问题在于` 等词。`hasWeakSetupTailPattern` 只做 `$` 后缀匹配，所以句中出现的 `核心是` 不应触发"未完成"判定。assembler 不应将其误判为"未完成"而延迟提交。

**Files:**
- Create: `apps/extension/src/service-worker/fixtures/structure/replay-realtime-complete-sentence-with-setup-tail.json`

**assembler 期望行为：** 第 2 条 utterance 以句号结尾且长度足够 → `hasTerminalPunctuation` 返回 true → `hasWeakSetupTailPattern` 内部先检查 `hasTerminalPunctuation` 并短路返回 false → 应通过 `commit_rule`（句末强收束）正常提交。

- [ ] **Step 1: 创建 fixture JSON**

```json
{
  "name": "replay-realtime-complete-sentence-with-setup-tail",
  "transcripts": [
    {
      "chunkId": "replay-realtime-complete-sentence-with-setup-tail_01",
      "text": "我们先回顾一下上次的讨论结果。",
      "startMs": 0,
      "endMs": 8000,
      "raw": {
        "source": "synthetic-realtime-replay",
        "artifactFixtureName": "manual:complete_sentence_with_setup_tail",
        "messageId": "complete-sentence-setup-tail-01",
        "voiceId": "manual"
      }
    },
    {
      "chunkId": "replay-realtime-complete-sentence-with-setup-tail_02",
      "text": "这个方案现在最核心是确保每个模块都能独立测试。",
      "startMs": 8000,
      "endMs": 22000,
      "raw": {
        "source": "synthetic-realtime-replay",
        "artifactFixtureName": "manual:complete_sentence_with_setup_tail",
        "messageId": "complete-sentence-setup-tail-02",
        "voiceId": "manual"
      }
    },
    {
      "chunkId": "replay-realtime-complete-sentence-with-setup-tail_03",
      "text": "如果只做集成测试而不做单元测试，一旦出问题就很难定位到底层哪里出了错。",
      "startMs": 22000,
      "endMs": 40000,
      "raw": {
        "source": "synthetic-realtime-replay",
        "artifactFixtureName": "manual:complete_sentence_with_setup_tail",
        "messageId": "complete-sentence-setup-tail-03",
        "voiceId": "manual"
      }
    }
  ],
  "acceptance": {
    "minSegments": 1,
    "minMergedNodes": 2,
    "minMergedEdges": 0,
    "allowFallback": false,
    "mustContainOneOfTexts": [
      ["模块", "测试"],
      ["集成", "单元"],
      ["定位", "问题"]
    ]
  }
}
```

**说明：** 第 2 条 `这个方案现在最核心是确保每个模块都能独立测试。` 结尾有句号，`核心是` 出现在句中而非句末。`hasWeakSetupTailPattern` 内部先检查 `hasTerminalPunctuation`，发现句号后直接返回 false，不会误判为未完成。这验证了"句末强收束优先于弱尾部模式"的设计约束。

- [ ] **Step 2: 用 KPI 脚本验证这条 fixture 的决策**

```bash
cd apps/extension && LISTEN_GRAPHIC_E2E_STRUCTURE_FIXTURE=replay-realtime-complete-sentence-with-setup-tail pnpm test:structure:ws:kpi
```

预期：`commits` 至少为 1（bootstrap 阶段的 commit），没有 `merge_with_prev`（因为没有跨 utterance 的半截+补完模式）。

- [ ] **Step 3: 如有 API credentials，跑真实 structurer 验证**

```bash
cd apps/extension && LISTEN_GRAPHIC_E2E_STRUCTURE_FIXTURE=replay-realtime-complete-sentence-with-setup-tail pnpm test:structure:real:replay:strict
```

预期：fixture 通过 acceptance 断言。

---

### Task 4: 编写 fixture — "多个半句连续输入"

**目的：** 测试边界——连续 3 条都像半句（无句末标点，长度偏短），assembler 应该在达到硬超时或 buffer 上限时提交，而不是无限等待。

**Files:**
- Create: `apps/extension/src/service-worker/fixtures/structure/replay-realtime-consecutive-incomplete.json`

**assembler 期望行为：** `但是`（2 字）、`我觉得`（3 字）、`这个问题`（4 字）的有效字符均 < 6，不满足 `looksLikeIncompleteUtterance` 的最低门槛（`effectiveChars >= 6`），因此 **不会** 触发 `merge_with_prev`。由于 bootstrap 阶段 `commit_force_flush`（buffer 满 3 条）仅在 `mergedGraph` 已存在时生效，这几条短句在 bootstrap 阶段会持续 `wait`。最终靠第 4 条完整句（或 `commit_timeout` / session 结束的 `input_finished`）触发首次提交。

- [ ] **Step 1: 创建 fixture JSON**

```json
{
  "name": "replay-realtime-consecutive-incomplete",
  "transcripts": [
    {
      "chunkId": "replay-realtime-consecutive-incomplete_01",
      "text": "但是",
      "startMs": 0,
      "endMs": 1500,
      "raw": {
        "source": "synthetic-realtime-replay",
        "artifactFixtureName": "manual:consecutive_incomplete",
        "messageId": "consecutive-incomplete-01",
        "voiceId": "manual"
      }
    },
    {
      "chunkId": "replay-realtime-consecutive-incomplete_02",
      "text": "我觉得",
      "startMs": 1500,
      "endMs": 3000,
      "raw": {
        "source": "synthetic-realtime-replay",
        "artifactFixtureName": "manual:consecutive_incomplete",
        "messageId": "consecutive-incomplete-02",
        "voiceId": "manual"
      }
    },
    {
      "chunkId": "replay-realtime-consecutive-incomplete_03",
      "text": "这个问题",
      "startMs": 3000,
      "endMs": 4500,
      "raw": {
        "source": "synthetic-realtime-replay",
        "artifactFixtureName": "manual:consecutive_incomplete",
        "messageId": "consecutive-incomplete-03",
        "voiceId": "manual"
      }
    },
    {
      "chunkId": "replay-realtime-consecutive-incomplete_04",
      "text": "其实根源在于我们没有把边界条件考虑清楚，所以每次遇到类似情况都会出现同样的错误。",
      "startMs": 4500,
      "endMs": 18000,
      "raw": {
        "source": "synthetic-realtime-replay",
        "artifactFixtureName": "manual:consecutive_incomplete",
        "messageId": "consecutive-incomplete-04",
        "voiceId": "manual"
      }
    }
  ],
  "acceptance": {
    "minSegments": 1,
    "minMergedNodes": 2,
    "minMergedEdges": 0,
    "allowFallback": true,
    "mustContainOneOfTexts": [
      ["边界", "条件"],
      ["错误", "问题"],
      ["根源", "考虑"]
    ]
  }
}
```

**说明：** 前 3 条都是极短 utterance（`但是`、`我觉得`、`这个问题`），有效字符均 < 6。它们**不会被 `isLowInformationTranscript` skip**（因为该函数只匹配 `掌声/谢谢/嗯/啊` 等特定词），但也不满足 `looksLikeIncompleteUtterance` 的 `>= 6 effective chars` 门槛。它们会进入 buffer 但不会触发 `merge_with_prev`。由于 bootstrap 阶段 `maxBufferedUtterances` force flush 需要 `mergedGraph` 已存在才会触发，前 3 条会持续 wait。第 4 条完整句到达后，buffer 内容满足 bootstrap 条件（累计 char 足够、有句末标点），触发首次 commit。

- [ ] **Step 2: 用 KPI 脚本验证**

```bash
cd apps/extension && LISTEN_GRAPHIC_E2E_STRUCTURE_FIXTURE=replay-realtime-consecutive-incomplete pnpm test:structure:ws:kpi
```

预期：至少 1 次 commit（第 4 条的内容足够触发 commit_rule 或 commit_score），`merge_with_prev` 次数应为 0（因为前 3 条太短，不满足 `looksLikeIncompleteUtterance` 的 `>= 6 effective chars` 条件）。

- [ ] **Step 3: 如有 API credentials，跑真实 structurer 验证**

```bash
cd apps/extension && LISTEN_GRAPHIC_E2E_STRUCTURE_FIXTURE=replay-realtime-consecutive-incomplete pnpm test:structure:real:replay:strict
```

预期：通过 acceptance（`allowFallback: true`）。

---

### Task 5: 编写 fixture — "低信息 utterance 插在中间"

**目的：** 测试边界——两段有意义的话语中间插入一条低信息 utterance（如"嗯"、"好的"），assembler 应该 skip 低信息 utterance，不影响前后正常 commit 节奏。

**Files:**
- Create: `apps/extension/src/service-worker/fixtures/structure/replay-realtime-low-info-interruption.json`

**assembler 期望行为：** `嗯` 被 `isLowInformationTranscript` 识别并 skip，不进入 buffer。前后两段正常 commit。

- [ ] **Step 1: 创建 fixture JSON**

```json
{
  "name": "replay-realtime-low-info-interruption",
  "transcripts": [
    {
      "chunkId": "replay-realtime-low-info-interruption_01",
      "text": "今天的议题是讨论产品路线图接下来两个季度的规划方向。",
      "startMs": 0,
      "endMs": 12000,
      "raw": {
        "source": "synthetic-realtime-replay",
        "artifactFixtureName": "manual:low_info_interruption",
        "messageId": "low-info-interruption-01",
        "voiceId": "manual"
      }
    },
    {
      "chunkId": "replay-realtime-low-info-interruption_02",
      "text": "嗯",
      "startMs": 12000,
      "endMs": 13000,
      "raw": {
        "source": "synthetic-realtime-replay",
        "artifactFixtureName": "manual:low_info_interruption",
        "messageId": "low-info-interruption-02",
        "voiceId": "manual"
      }
    },
    {
      "chunkId": "replay-realtime-low-info-interruption_03",
      "text": "第一个方向是深化现有核心功能的稳定性，第二个方向是探索新的应用场景。",
      "startMs": 13000,
      "endMs": 30000,
      "raw": {
        "source": "synthetic-realtime-replay",
        "artifactFixtureName": "manual:low_info_interruption",
        "messageId": "low-info-interruption-03",
        "voiceId": "manual"
      }
    },
    {
      "chunkId": "replay-realtime-low-info-interruption_04",
      "text": "掌声",
      "startMs": 30000,
      "endMs": 31000,
      "raw": {
        "source": "synthetic-realtime-replay",
        "artifactFixtureName": "manual:low_info_interruption",
        "messageId": "low-info-interruption-04",
        "voiceId": "manual"
      }
    },
    {
      "chunkId": "replay-realtime-low-info-interruption_05",
      "text": "稳定性方面，我们需要把实时转写的断句逻辑做得更精确，减少半句和碎片化输入对后续结构化处理的影响。",
      "startMs": 31000,
      "endMs": 52000,
      "raw": {
        "source": "synthetic-realtime-replay",
        "artifactFixtureName": "manual:low_info_interruption",
        "messageId": "low-info-interruption-05",
        "voiceId": "manual"
      }
    }
  ],
  "acceptance": {
    "minSegments": 1,
    "minMergedNodes": 3,
    "minMergedEdges": 0,
    "allowFallback": false,
    "mustContainOneOfTexts": [
      ["产品", "路线图"],
      ["稳定性", "场景"],
      ["断句", "结构化"]
    ]
  }
}
```

**说明：** 第 2 条 `嗯` 和第 4 条 `掌声` 都是低信息 utterance，应被 `isLowInformationTranscript` skip。第 1、3、5 条是有意义的完整话语，应正常进入 buffer 并在适当时机 commit。

- [ ] **Step 2: 用 KPI 脚本验证**

```bash
cd apps/extension && LISTEN_GRAPHIC_E2E_STRUCTURE_FIXTURE=replay-realtime-low-info-interruption pnpm test:structure:ws:kpi
```

预期：`lowInfoSkips >= 2`（`嗯` 和 `掌声`），`merge_with_prev = 0`，至少 1-2 次 commit。

- [ ] **Step 3: 如有 API credentials，跑真实 structurer 验证**

```bash
cd apps/extension && LISTEN_GRAPHIC_E2E_STRUCTURE_FIXTURE=replay-realtime-low-info-interruption pnpm test:structure:real:replay:strict
```

预期：通过 acceptance。

---

### Task 6: 全量回归验证（新增 fixture 后）

**目的：** 新增 3 条 fixture 后，重新跑全部 replay fixtures 的 KPI 模拟和（可选）真实 structurer 验证，确认整体状态。

**Files:**
- Read: `apps/extension/src/service-worker/fixtures/structure/replay-realtime-*.json`（现在应有 8 条）

- [ ] **Step 1: 离线 KPI 全量回归**

```bash
cd apps/extension && pnpm test:structure:ws:kpi
```

确认 8 条 fixture 全部输出 KPI，没有新增异常。

- [ ] **Step 2: 真实 structurer 全量回归（可选，需要 API credentials）**

```bash
cd apps/extension && pnpm test:structure:real:replay:strict
```

确认所有 fixture 通过（或已知失败原因与 assembler 无关）。

- [ ] **Step 3: 总结验证结论**

产出一份简要结论，包含：
- 原有 5 条 fixture 的 KPI 是否稳定
- 3 条新增 fixture 的决策是否符合预期
- `merge_with_prev` 规则是否在所有 fixture 上表现合理（只在真正的半截+补完场景触发）
- 整体评估：assembler 是否已达到"可以放心默认打开"的状态，或仍需进一步调整

---

## 自审 Checklist

### 1. Spec 覆盖

| 需求 | 对应 Task |
|------|-----------|
| 跑全量 replay baseline | Task 1 + Task 2 |
| 看首图延迟 | Task 1 Step 2、Task 2 Step 4 |
| 看 structurer 调用频率 | Task 1 Step 2 |
| 看 empty output ratio | Task 1 Step 2、Task 2 Step 4 |
| 补"完整句但句中含 setup-tail 词"反例 | Task 3 |
| 补"多个半句连续输入"反例 | Task 4 |
| 补"低信息 utterance 插中间"反例 | Task 5 |
| 新增 fixture 后全量回归 | Task 6 |

### 2. Placeholder 扫描

无 TBD、TODO、implement later 等占位符。所有步骤包含具体命令和预期输出。

### 3. 类型一致性

所有 fixture JSON 结构一致：`name`、`transcripts[]`（每条含 `chunkId`、`text`、`startMs`、`endMs`、`raw`）、`acceptance`（含 `minSegments`、`minMergedNodes`、`minMergedEdges`、`allowFallback`、`mustContainOneOfTexts`）。
