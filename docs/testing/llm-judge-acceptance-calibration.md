# LLM-as-Judge Acceptance 校准 Pipeline

## 背景

### 问题

现有 structure fixture 验收集面临两个瓶颈：

1. **弱 acceptance 无法自动校准**：482 条 utterance 的 scaffold 用公式 `ceil(N*0.5)=241` 估算节点数，完全不合理（实际 structurer 合并后可能只有 20-50 个节点）
2. **人工逐条校准不现实**：4 个全长音频 × 数百条 utterance，逐条手写 acceptance 成本过高

### 解决方案

用 **LLM-as-Judge** 做批量语义评审，生成 acceptance 草稿，人工只做最终审核。

核心原则：
- **AI 不是最终验收者**——它是批量评审员 + fixture 草稿生成器
- **Judge 必须同时看原始 ASR + structurer 输出**，不能只看图不看原文
- **Blind paired comparison**——不告诉 Judge 哪个是 with/without assembler
- **两层沉淀**：批量 explore → 精选 regression fixture

---

## 设计决策与权衡

### 1. 为什么分段而不是整条处理？

482 条 utterance 不能一股脑喂给 LLM：
- 超出 LLM 有效上下文，输出质量下降
- 每段 30-120s 的内容更聚焦，acceptance 更准确
- 分段可独立审核、独立重跑

**算法选择：** 确定性时间间隔分段（间隔 > 5s 切一刀），不用 AI 分段。
- 优点：可复现、无需 API 调用、便于调试
- 缺点：5s 间隔不一定对齐语义边界 → 通过 manifest 人工 override 解决

### 2. 为什么用真实 assembler 而非简化版？

`report-structure-unit-ws-kpis.mjs` 已有完整 assembler 逻辑的独立 JS 重实现。对比必须走生产路径，否则结论只能证明"简化策略好不好"，不能证明"Assembler 好不好"。

### 3. 为什么批处理用脚本而非 Vitest？

`run-structure-replay-strict.mjs` 的逐-fixture-spawn-Vitest 模式已验证可行：
- 单个 fixture 卡住不影响其他
- 支持 resume（跳过已完成的）
- 支持限速和单 fixture 重跑

### 4. 为什么 judge 输入要 compact graph 而非完整 MergedGraph？

完整 MergedGraph 含 id、timestamp、topic、viewHints、revision 等噪声。Judge 只需要：
```json
{
  "nodes": [{ "id": "...", "type": "claim", "text": "..." }],
  "edges": [{ "sourceText": "...", "targetText": "...", "type": "supports" }]
}
```
Edge 用 sourceText/targetText 而非 id，避免 Judge 回查浪费 token。

### 5. 为什么 suggestedAcceptance 不含 requiredEdgeTypes？

Semantic fixture 集合中 supports/opposes/causes 有合理浮动。自动断言边类型容易把正常变化判定为失败。除非原文关系极明确且模型多次稳定输出，否则不自动添加。

---

## 数据流

```
真实音频 (.wav)
    ↓  本地 ASR (sherpa-onnx / mock bridge)
    ↓  LG-ASR-WS v1 协议
raw utterance artifact (artifacts/local_full_*.utterances.json)
    ↓  segment-local-artifacts.mjs（确定性分段）
segment 文件 (~30-50 个，30-120s) + manifest（人工可调）
    ↓  prepare-local-replay-fixtures.mjs --segments
replay-local-segNN-*.json fixture（弱 scaffold acceptance）
    ↓  compare-structure-segments.mjs（with/without assembler 双 pass）
compact graph artifacts（每段两个图）
    ↓  judge-acceptance.mjs（LLM blind comparison + rubric）
calibration JSON + summary.md（draft acceptance + promote 推荐）
    ↓  人工从 shouldPromoteToFixture=true 中选 10-20 条
最终可回归的 replay fixture
```

### 两层数据分离

| 层 | 路径 | 格式 | 说明 |
|---|---|---|---|
| ASR 原始输出 | `artifacts/local_*.utterances.json` | `source: "local-asr"` | **不手改** |
| ASR 分段 | `artifacts/segments/local_*_seg*.json` | 确定性分段输出 | **不手改**（但 manifest 可调） |
| Segment manifest | `artifacts/segments/local_*_manifest.json` | keep/mergeWithNext/note | **人工可编辑** |
| Segment fixture | `structure/replay-local-segNN-*.json` | StructureFixture 格式 | acceptance **人工维护** |
| Graph artifacts | `artifacts/segments/graphs/*.graphs.json` | compact 格式 | **不手改**（structurer 输出） |
| Judge 结果 | `artifacts/segments/judgments/*.judgment.json` | rubric 评分 + draft | **参考用**（不进入测试） |
| 校准总结 | `artifacts/segments/calibration-summary.md` | markdown | **参考用** |

---

## 文件清单

### 新增文件

| 文件 | 职责 | 行数 |
|------|------|------|
| `scripts/segment-local-artifacts.mjs` | 确定性分段：间隔 > 5s 切段，> 120s 再切，< 30s 合并。输出 segment JSON + manifest | ~200 |
| `scripts/compare-structure-segments.mjs` | 逐 fixture spawn Vitest，with/without assembler 双 pass，合并 compact graph artifacts | ~350 |
| `scripts/judge-acceptance.mjs` | 读 segments + graphs → LLM blind comparison → rubric 评分 → draft acceptance | ~500 |

### 修改文件

| 文件 | 改动 |
|------|------|
| `scripts/prepare-local-replay-fixtures.mjs` | 公式 `ceil(N*0.5)` → `floor(sqrt(N))`；新增 `--segments` 模式读 segment 文件生成 `replay-local-segNN-*.json`；新增 `_quality: "weak_scaffold"` 标签 |
| `src/service-worker/structure-focused-helpers.ts` | 新增 `writeCompactGraphArtifact()` 函数：MergedGraph → compact JSON（nodes: {id,type,text}, edges: {sourceText,targetText,type,confidence}） |
| `src/service-worker/structure-focused.real.test.ts` | 新增条件写入：`LISTEN_GRAPHIC_COMPARISON_WRITE_GRAPHS=1` 时调用 `writeCompactGraphArtifact()` |
| `apps/extension/package.json` | 新增 `segment:asr:local`、`compare:structure:segments`、`judge:acceptance` |
| `package.json` | 新增对应根级命令 |
| `docs/testing/local-asr-artifact-pipeline.md` | 更新数据流图 + 新增分段/对比/judge 操作步骤 |

---

## 操作步骤

### 前置条件

- sherpa-onnx 模型已下载（或 mock bridge 可用）
- 真实 structurer API key（用于 compare 步骤）
- Judge LLM API key（用于 judge 步骤）

### Step 1: 收集 ASR artifact

```powershell
# 启动 sherpa-onnx bridge
pwsh -File .\tools\local-asr-bridge\sherpa-onnx\run.example.ps1

# 跑全长 ASR 并写 artifact
$env:LISTEN_GRAPHIC_LOCAL_BRIDGE_REAL_ASR = "1"
$env:LISTEN_GRAPHIC_E2E_ASR_TIMEOUT_MS = "2400000"
$env:LISTEN_GRAPHIC_E2E_ASR_FIXTURE = "full:3_冲突争论型_黄执中周玄毅哲理辩"
$env:LISTEN_GRAPHIC_E2E_ASR_WRITE_ARTIFACTS = "1"
pnpm prepare:asr:local
```

### Step 2: 分段

```powershell
# 默认处理所有 local_full_*.utterances.json
pnpm segment:asr:local

# 自定义参数
node apps/extension/scripts/segment-local-artifacts.mjs --gap 3000 --max-duration 90000

# （可选）编辑 manifest，标记 skip/merge
# artifacts/segments/local_*_manifest.json
```

### Step 3: 生成 segment fixture

```powershell
pnpm prepare:structure:local-replay -- --segments
```

### Step 4: 跑 structurer 对比

```powershell
$env:LISTEN_GRAPHIC_E2E_STRUCTURER_TYPE = "openai"
$env:LISTEN_GRAPHIC_E2E_STRUCTURER_API_KEY = "sk-..."
pnpm compare:structure:segments

# 重跑单个 segment
node apps/extension/scripts/compare-structure-segments.mjs --filter "seg05"
```

### Step 5: LLM Judge

```powershell
$env:LISTEN_GRAPHIC_JUDGE_API_KEY = "sk-..."
pnpm judge:acceptance

# 查看总结
cat apps/extension/src/service-worker/fixtures/asr-realtime/artifacts/segments/calibration-summary.md
```

### Step 6: 人工校准

1. 看 `calibration-summary.md`，关注 `shouldPromoteToFixture=true` 的 segment
2. 对每个选中的 segment，编辑 `structure/replay-local-segNN-*.json`：
   - 将 `suggestedAcceptanceDraft` 中的值复制到 `acceptance`
   - 调整 `mustContainOneOfTexts`（每组放同义表达）
   - 添加 `forbiddenTexts`（幻觉防护）
   - 移除 `manualReviewTags` 中的 `"needs-acceptance-calibration"`
   - 移除 `_quality: "weak_scaffold"`
   - 设 `allowFallback: false`（如果不应 fallback）
3. 运行 `pnpm test:structure:stable` 验证

---

## LLM Judge Rubric

Judge 按 4 个维度评分（1-5 分），每个维度同时评 graph1 和 graph2：

| 维度 | 评判标准 | 扣分信号 |
|------|---------|---------|
| **coverage** | 图是否覆盖原始 utterances 的主要语义点 | 遗漏核心论点 |
| **faithfulness** | 节点文本是否忠实于原始文本 | 出现原文没说的内容 |
| **relationQuality** | 边类型是否准确反映语义关系 | 反驳标为 supports |
| **noiseHandling** | 口头禅/停顿/碎片是否被过滤 | 语气词变成节点 |

**Blind comparison：** graphA/graphB 随机映射为 Graph1/Graph2，Judge 不知道哪个是 with assembler。

---

## 环境变量

### ASR artifact 收集

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `LISTEN_GRAPHIC_LOCAL_BRIDGE_REAL_ASR` | `"1"` = 真实 ASR | mock 模式 |
| `LISTEN_GRAPHIC_E2E_ASR_WRITE_ARTIFACTS` | `"1"` = 写 artifact | 不写 |
| `LISTEN_GRAPHIC_E2E_ASR_TIMEOUT_MS` | ASR 超时 | `90000` |
| `LISTEN_GRAPHIC_E2E_ASR_FIXTURE` | 指定 fixture | 全部 |

### Structurer 对比

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `LISTEN_GRAPHIC_E2E_STRUCTURER_TYPE` | Provider 类型 | 必填 |
| `LISTEN_GRAPHIC_E2E_STRUCTURER_API_KEY` | API key | 必填 |
| `LISTEN_GRAPHIC_COMPARISON_WRITE_GRAPHS` | `"1"` = 写 compact graph | 不写 |
| `LISTEN_GRAPHIC_STRUCTURE_UNIT_ASSEMBLER_ENABLED` | `"false"` = 关 assembler | 开启 |

### LLM Judge

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `LISTEN_GRAPHIC_JUDGE_API_KEY` | Judge API key | 必填 |
| `LISTEN_GRAPHIC_JUDGE_BASE_URL` | API base URL | `https://api.openai.com/v1` |
| `LISTEN_GRAPHIC_JUDGE_MODEL` | 模型 | `gpt-4o` |

---

## 当前实施状态

| 组件 | 状态 | 说明 |
|------|------|------|
| ASR artifact 收集 | ✅ 已完成 | 前一 session 实现 |
| 分段脚本 | ✅ 已实现 | 482 条 → 51 segments + manifest |
| 弱 acceptance 公式 | ✅ 已修复 | `floor(sqrt(N))` |
| Segment → fixture 转换 | ✅ 已实现 | `--segments` 模式 |
| Compact graph writer | ✅ 已实现 | helper + 测试条件写入 |
| Structurer 对比脚本 | ✅ 已实现 | with/without assembler 双 pass |
| LLM Judge 脚本 | ✅ 已实现 | blind comparison + rubric |
| npm scripts 注册 | ✅ 已完成 | 3 个新命令 |
| 端到端验证 | ⬜ 待做 | 需要 structurer + judge API key |

---

## 与已有 pipeline 的关系

| | 腾讯 ASR → replay | 本地 ASR → scaffold | 本地 ASR → LLM Judge |
|---|---|---|---|
| ASR 来源 | Tencent WebSocket | sherpa-onnx 本地 | sherpa-onnx 本地 |
| Acceptance 来源 | fixture 预定义 | 公式估算（弱） | LLM 生成草稿 + 人工审核 |
| 比较维度 | 无 | 无 | with/without assembler |
| 人工投入 | 写 acceptance | 校准 acceptance | 选 10-20 条 + 微调 |
| 产出 | `replay-realtime-*` | `replay-local-*` | `replay-local-segNN-*` |
