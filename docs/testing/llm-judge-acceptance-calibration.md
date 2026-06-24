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

## Judge 模型选型（本地小模型实测）

2026-06 实测 `google/gemma-4-12b-qat`（LM Studio，4-bit QAT，OpenAI-compatible `localhost:1234/v1`）能否替代 `gpt-4o` 做 judge。结论：**分档可用，但核心用途扛不住**。

### 测试方法
3 个判官考点 × 每个 3 次重复（temperature 0.3，`json_schema` 强制输出），全部走本地 LM Studio：
- **Case A**：好图 vs 极差图（对照基线）
- **Case B**：仅 `supports` vs `causes` 一处关系类型差别（微妙分辨）
- **Case C**：两个语义等价图、仅措辞不同（tie 判断）

### 结果

| Case | preferred 序列 | 判定 |
|------|---------------|------|
| A 好 vs 极差 | `[g1,g1,g1]` | ✅ 3/3 正确，分数极差=0 |
| B supports vs causes | `[g2,g2,g1]` | ⚠️ 不稳，2/3 把 causes 判满分 |
| C 等价 tie | `[g2,g2,tie]` | ⚠️ 不稳，系统性偏袒 graph2 |

### 分档结论
- **粗筛可用**：明显差异（有实质内容 vs 纯噪声）分得准且稳，理由具体。可做 `shouldPromoteToFixture` 这类粗分类。
- **细判不可用**：assembler on/off 这类微妙差异，preferred 乱跳、带位置偏差（等价图也系统性偏袒一侧），**扛不住**。pipeline 的核心用途（比较 with/without assembler）必须用 `gpt-4o`。

### 硬约束
- 必须 `response_format: json_schema` 强制输出。OpenAI 标准 `json_object` LM Studio 直接拒（400）。
- 单段 ~60-90s，30+ 段批量要 30+ 分钟（本地 CPU 吞吐瓶颈）。
- Case B 证明 gemma **分不清 supports vs causes**——这同时威胁它做 structurer（边类型是 structurer 的核心产出），见下文实测。

### 选型建议
- Judge 默认 `gpt-4o`（细判场景必需）。
- `gemma-4-12b-qat` 仅限粗筛层 / 离线 draft，不用于 with-vs-without assembler 对比。

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
| `LISTEN_GRAPHIC_JUDGE_PROVIDER` | 后端类型：`openai`（默认）或 `opencode-serve` | `openai` |
| `LISTEN_GRAPHIC_JUDGE_API_KEY` | Judge API key（`openai` 必填，`opencode-serve` 不需要） | 必填 |
| `LISTEN_GRAPHIC_JUDGE_BASE_URL` | API base URL（仅 `openai`） | `https://api.openai.com/v1` |
| `LISTEN_GRAPHIC_JUDGE_MODEL` | 模型名（`opencode-serve` 用 `opencode/<模型>`） | `gpt-4o` |
| `OPENCODE_SERVE_URL` | opencode serve 地址（仅 `opencode-serve`） | `http://127.0.0.1:4199` |
| `LISTEN_GRAPHIC_JUDGE_MAX_RETRIES` | `opencode-serve` 失败重试次数 | `2` |

用 `opencode-serve` 免费模型做粗筛：

```powershell
# 1. 先启动常驻服务
opencode serve --port 4199

# 2. 跑 judge（本机若设了 http_proxy，需清空 NO_PROXY='*' 让 localhost 直连）
$env:LISTEN_GRAPHIC_JUDGE_PROVIDER = "opencode-serve"
$env:OPENCODE_SERVE_URL = "http://127.0.0.1:4199"
$env:LISTEN_GRAPHIC_JUDGE_MODEL = "opencode/nemotron-3-ultra-free"
pnpm judge:acceptance
```

注意：`opencode-serve` 后端的细判稳定性（Case C 位置偏差、偶发 JSON 损坏）弱于 `openai`，生产环境仍推荐 `openai` + `gpt-4o`；`opencode-serve` 适合免费额度下的粗筛层。详见本文档「opencode 探测」段。

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

---

## 本地小模型做 Structurer 实测（gemma-4-12b-qat）

与 judge 实测同一模型，用**生产 `openai-structurer.ts` 的真实 system prompt**（~13 条硬规则）+ 真实中文辩论文本（黄执中 seg05），bootstrap 模式 × 3 次，`json_schema` 强制输出。

### 测试方法
- 输入：4 句真实辩论 utterance（含专有词：周伯通/桃花岛/左右互搏/老顽童）
- 审计：7 项（JSON 合法性、节点类型、悬空边、专有词保留、幻觉检测、核心论点抓取、噪声过滤、边类型合理性）
- 每项对比 gemma 翻车的已知弱点（Case B: supports vs causes）

### 结果
- **run 1**：7 节点 5 边，topic 准（"辩论活动的现状与自我对弈的现象"），专有词全保留，噪声过滤，边类型用了 supports×3 + example_of + causes，7/7 审计通过
- **run 2**：**16 节点** 5 边，同样输入过度拆分 7→16
- **run 3**：**JSON 截断**（position 1570 解析失败），`max_tokens=1200` 不够

### 分档结论
- **单次语义质量可用**：run 1 产出准确、关系类型合理、专有词保留、噪声过滤——中文理解过关
- **生产 structurer 不可用**：稳定性崩（nodeCount 7↔16，极差 9）+ JSON 截断。增量合并（`mergeSegmentGraph` + `stabilizeGraph`）要求拓扑稳定，7↔16 波动会让 merge 去重冲垮、用户看到的图不断重组
- **可用场景**：离线 draft / 开发调试 / mock structurer 升级（比纯规则 mock 强）、给旗舰模型做对照基线

### 核心规律
与 judge 结论一致：**gemma-4-12b-qat 理解力够、稳定性不够**。单次能惊艳，但同输入复现性差、长输出易截断。12B QAT 的通病——judge 和 structurer 两个角色都卡在同一个病根。

---

## cursor-agent 探测（`cursor-agent -p` 非交互模式）

### 测试方法
spawn `cursor-agent -p "..." --model auto --mode ask --output-format json`，分别在项目目录（ListenGraph，含大 node_modules）和空目录运行。

### 关键发现
1. **json 结构清晰**：`{type:"result", is_error:false, result:"...", usage:{inputTokens:N, outputTokens:N}}`，适配层读 `.result` 即可
2. **`--trust` 必需**：非交互 `-p` 模式首次在某目录跑需 `--trust`（workspace trust），否则 exit 1
3. **每次固定烧 ~28000 input tokens**：`--workspace` 指向空目录后 inputTokens 从 30496 降到 27714（几乎没变）——这 ~28000 是**agent 框架系统提示的固定开销**，`--workspace` 关不掉
4. **耗时 16-25s/次**

### 成本对比（同一 judge 任务，30 段）

| 方式 | input tokens/次 | 30 段 total input |
|------|----------------|-------------------|
| cursor-agent | ~28000（框架开销） | ~84 万 |
| 直接官方 API | ~1000-1500 | ~3-4 万 |

**cursor-agent 反而费 ~20 倍 input tokens**，全部烧在 agent 框架上，对 judge 任务零贡献。

### 分档结论
- **技术可行**：json 结构清晰、result 可取、--trust 绕过
- **按 token 计费不划算**：84 万框架 token 快速烧额度，比直接调 API 更贵
- **包月订阅可用**：如果 Cursor 是包月/无限订阅（不按 token 单独计费），token 多少无所谓，可省单独 API key 费用

---

## opencode 探测（`opencode run` CLI + `opencode serve` HTTP）

### 测试方法
1. **CLI 路径**：`opencode run -m opencode/nemotron-3-ultra-free "..." --format json`，分别在 bash 直接调用、Node spawn（含 winpty / `bash -c` 包装）、项目目录与 home 目录运行
2. **serve 路径**：`opencode serve --port 4199` 常驻，再走 `POST /session` → `POST /session/<id>/message` HTTP API
3. **judge 稳定性**：复用 gemma judge suite 的同一套 Case A/B/C（同一真实辩论文本、同一 rubric），3 case × 3 repeat，仅替换后端为 opencode 免费模型

### 关键发现

#### 1. CLI「卡死」的真正根因不是 TTY，是 Node spawn 死锁
早期探测脚本（`test-opencode-probe.mjs`）在 Node spawn 下观察到「0 输出、90s 超时被 kill」，曾误判为 opencode「需要 TTY」。实测推翻：
- **bash 直接调用（含管道、文件重定向）100% 稳定**：EXIT=0，秒回，`step_start` → `text:"2"` → `step_finish` 三事件齐全。手动多次调用零失败
- **Node spawn（无论 `shell:false`、`shell:true`、winpty 包装、`bash -c` 包装）全部死锁**：子进程挂起，stdout 0 字节

因此根因是 **`opencode run` 子命令在 Node 衍生子进程的 stdout 管道下死锁**（疑似对 ConPTY/console buffer 的探测与 Node pipe fd 不兼容），**不是 TTY 检测**——bash 直接调用同样没有交互 TTY 却能用。winpty 伪终端也绕不过去。

#### 2. `--format json` 是 NDJSON 事件流，不是单 JSON 对象
旧 probe 脚本用 `JSON.parse(整段 stdout)` 取值，面对多行 NDJSON 必然抛错，于是把「事件流」误判成「无输出/卡死」。正确取值：按行 parse，累积所有 `type:"text"` 的 `part.text`，从 `type:"step_finish"` 的 `part.tokens` 取 token。（已修正 probe 脚本。）

#### 3. serve HTTP 是唯一可靠的自动化路径
`opencode serve --port N` 常驻进程自身持有 console，HTTP 接口对调用方零 TTY 要求，Node `fetch` 可直接调用：
- `POST /session`（body `{}`）→ 返回 `{id}`
- `POST /session/<id>/message`（body `{parts:[{type:"text",text}]}`）→ 返回完整 assistant message（含 `type:text` 文本、`type:reasoning` 思维链、`info.tokens` 用量）

9 次 judge 请求全部经此路径完成。

#### 4. 代理拦截坑（部署层）
本机 `http_proxy=127.0.0.1:10809` 会拦截 localhost 请求返回 503（serve 端口 `curl` 直接调全部空响应即此因）。调用 serve API 必须 `--noproxy '*'`（curl）或让 Node fetch 不走代理。CI/容器环境需注意同理。

#### 5. token 经济性：比 cursor 省 ~45%
serve 返回的真实 token（同输入「1加1等于几」，多次平均）：

| 后端 | input tokens/次 | 30 段 total input |
|------|----------------|-------------------|
| opencode serve | ~15500 | ~46 万 |
| cursor-agent CLI | ~28000 | ~84 万 |
| 直接官方 API | ~1000-1500 | ~3-4 万 |

opencode 比 cursor 省约 45% input，但仍远高于直连 API（agent 框架固定开销）。

### judge 稳定性实测（nemotron-3-ultra-free，via serve HTTP，3 case × 3 repeat）

| Case | 预期 | preferred 序列 | 判定 |
|------|------|---------------|------|
| A 好 vs 极差 | graph1 明显优 | `[g1,g1,g1]` | ✅ 3/3 正确，relationQuality 极差 5→1 |
| B supports vs causes | relationQuality g1 略优 | `[g1,g1,g1]` | ✅ **3/3 正确且稳**（rela g1=4/g2=2 三次完全一致）|
| C 等价 tie | 应判 tie | `[g1,g1,失败]` | ⚠️ 偏袒 graph1 + 1 次 JSON 残缺解析失败 |

对照 gemma（本文档 gemma 段实测）：gemma 在 Case B「分不清 supports vs causes、2/3 把 causes 判满分」，**opencode 在微妙差异判断上反而比 gemma 稳定**。但 opencode 在 Case C 等价判断有位置偏差（系统性偏 graph1），与 gemma 的 Case C 位置偏差（偏 graph2）同病。

免费模型稳定性短板客观存在：9 次请求 1 次 JSON 输出残缺、1 次单请求超时（>120s）。生产 judge 脚本接入 opencode 必须带**重试 + 宽松 JSON 解析兜底**。

### 分档结论
- **CLI 不可用于自动化**：Node spawn 必死锁，仅限 bash/交互终端手动调用
- **serve HTTP 可用于自动化**：粗筛层（`shouldPromoteToFixture` 分类）可用；细判（with/without assembler）因 Case C 位置偏差 + 偶发 JSON 损坏，仍建议 gpt-4o
- **比 cursor 经济**：input 省 ~45%，且免 API key（免费模型路由）
- **比 gemma 强**：Case B 微妙差异判得更准更稳

---

## 最终选型建议

### Judge 模型

| 模型 | 可用？ | 说明 |
|------|--------|------|
| `gpt-4o`（默认） | ✅ 推荐 | 细分辨能力远超 gemma/opencode，无稳定性/截断/位置偏差问题 |
| `claude-sonnet-4` | ✅ 推荐 | 同上，可通过 Anthropic API |
| opencode（免费，via serve） | ⚠️ 粗筛可用 | Case B 微妙差异判得比 gemma 准且稳；Case C 等价判断有位置偏差 + 偶发 JSON 损坏；**必须走 serve HTTP**，CLI spawn 在 Node 下死锁；input ~15500，比 cursor 省 ~45%、免 API key |
| `gemma-4-12b-qat`（本地） | ⚠️ 仅粗筛 | 理解力够但稳定性不够，supports vs causes 分不清 |
| cursor-agent（auto） | ⚠️ 包月可用 | 每次 2.8 万框架 token，按 token 计费不划算 |

**推荐方案：直接配官方 API key**，现有脚本零改动：

```powershell
$env:LISTEN_GRAPHIC_JUDGE_API_KEY = "sk-..."
$env:LISTEN_GRAPHIC_JUDGE_MODEL = "gpt-4o"  # 或 claude-sonnet-4
pnpm judge:acceptance
```

### Structurer 模型

生产 structurer 不可用本地小模型（稳定性崩）。继续使用现有 provider 体系（OpenAI/Zhipu/Baidu/Aliyun），通过 `LISTEN_GRAPHIC_E2E_STRUCTURER_TYPE` + `LISTEN_GRAPHIC_E2E_STRUCTURER_API_KEY` 配置。

### 测试脚本清单（已创建，可复用）

| 脚本 | 用途 |
|------|------|
| `scripts/test-gemma-judge.mjs` | gemma judge 单次测试（Case A 对照） |
| `scripts/test-gemma-judge-suite.mjs` | gemma judge 3 case × 3 repeat 稳定性套件 |
| `scripts/test-gemma-structurer.mjs` | gemma structurer 真实 prompt 测试 |
| `scripts/test-cursor-probe.mjs` | cursor-agent json 结构 + token 探针 |
| `scripts/test-opencode-probe.mjs` | opencode 探针：按 NDJSON 事件流取值（修正旧版整段 parse 误判）；同时验证 CLI spawn 死锁、serve HTTP 可用 |
| `scripts/test-opencode-judge-suite.mjs` | opencode judge 3 case × 3 repeat 稳定性套件（via serve HTTP，与 gemma suite 同 case 定义） |
