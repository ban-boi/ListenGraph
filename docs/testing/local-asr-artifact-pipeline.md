# 本地 ASR Artifact Pipeline

## 目的

从真实音频出发，通过本地 ASR（sherpa-onnx）收集原始 utterance 分割数据，转为 structure replay fixture，补充结构化质量验收集。

这套 pipeline 解决的核心问题：**现有 21 条 semantic fixture 是人工构造的短文本，不含真实 ASR 的分割分布特征**（碎片化、噪声、截断、多人混声）。本 pipeline 产出的是从真实语音识别出的 utterance，保留了 ASR 实际的切句边界、时间戳和置信度。

---

## 数据流

```
真实音频 (.wav)
    ↓  本地 ASR (sherpa-onnx / mock bridge)
    ↓  LG-ASR-WS v1 协议
raw utterance artifact
    ↓  prepare-local-replay-fixtures.mjs
structure replay fixture scaffold (弱 acceptance)
    ↓  人工校准 acceptance
可回归的 replay fixture
```

---

## 两层数据分离

| 层 | 路径 | 格式 | 说明 |
|---|---|---|---|
| ASR 原始输出 | `fixtures/asr-realtime/artifacts/local_*.utterances.json` | `source: "local-asr"` | **不手改**。保留 ASR 实际切分结果。 |
| Structure replay | `fixtures/structure/replay-local-*.json` | `source: "local-asr-replay"` | acceptance **人工维护**。从 scaffold 开始校准。 |

### Artifact 格式

```json
{
  "fixtureName": "generated:1_信息密集型_罗翔十一学校讲座",
  "audioFile": "audio/generated/1_信息密集型_罗翔十一学校讲座.wav",
  "audioClipDurationMs": null,
  "source": "local-asr",
  "bridgeEndpoint": "ws://127.0.0.1:15377/ws",
  "recordedAt": "2026-06-01T...",
  "utterances": [
    {
      "text": "识别出的文本",
      "utteranceId": "utt-2",
      "startMs": 1840,
      "endMs": 4240,
      "finalReason": "endpoint",
      "confidence": 0.95,
      "language": "zh"
    }
  ]
}
```

### Replay Fixture 格式

```json
{
  "name": "replay-local-1-信息密集型-罗翔十一学校讲座",
  "transcripts": [
    {
      "chunkId": "replay-local-1-信息密集型-罗翔十一学校讲座_01",
      "text": "识别出的文本",
      "startMs": 1840,
      "endMs": 4240,
      "raw": {
        "source": "local-asr-replay",
        "artifactFixtureName": "generated:1_...",
        "utteranceId": "utt-2",
        "confidence": 0.95,
        "finalReason": "endpoint"
      }
    }
  ],
  "acceptance": { ... }
}
```

`raw.source` 取值：
- `"local-asr-replay"` — 本地 ASR 回放（本 pipeline）
- `"tencent-realtime-replay"` — 腾讯实时 ASR 回放（已有 pipeline）

---

## 操作步骤

### 前置条件

- sherpa-onnx 模型已下载到 `.tmp/sherpa-model/sherpa-onnx-streaming-paraformer-bilingual-zh-en/`
- Python 已安装 `sherpa-onnx` 包
- 音频文件已在 `raw_audio&text/` 中，且已通过 `pnpm prepare:asr:real` 生成 WAV + fixture

### 1. 启动 sherpa-onnx bridge

**必须用 PowerShell**（Git Bash 会把 `/ws` 转成 Windows 路径导致 WS 端点错误）：

```powershell
pwsh -File .\tools\local-asr-bridge\sherpa-onnx\run.example.ps1
```

或直接：

```powershell
python tools/sherpa-onnx-bridge.py --host 127.0.0.1 --port 15377 --path /ws `
  --encoder .tmp/sherpa-model/sherpa-onnx-streaming-paraformer-bilingual-zh-en/encoder.int8.onnx `
  --decoder .tmp/sherpa-model/sherpa-onnx-streaming-paraformer-bilingual-zh-en/decoder.int8.onnx `
  --tokens .tmp/sherpa-model/sherpa-onnx-streaming-paraformer-bilingual-zh-en/tokens.txt `
  --model-name sherpa-onnx-streaming-paraformer-bilingual-zh-en --provider cpu --num-threads 4
```

验证 bridge 就绪：
```powershell
curl http://127.0.0.1:15377/healthz
# 应返回 {"ok": true, "protocol": "lg-asr-ws-v1", ...}
```

### 2. 跑本地 ASR 并写 artifacts

```powershell
# 裁剪版（每条只取前 2 分钟，快速验证）
$env:LISTEN_GRAPHIC_LOCAL_BRIDGE_REAL_ASR = "1"
pnpm prepare:asr:local

# 全长版（需要加大超时，音频以 ~2.5x 速度处理）
$env:LISTEN_GRAPHIC_LOCAL_BRIDGE_REAL_ASR = "1"
$env:LISTEN_GRAPHIC_E2E_ASR_TIMEOUT_MS = "2400000"  # 40 分钟
$env:LISTEN_GRAPHIC_E2E_ASR_FIXTURE = "full:3_冲突争论型_黄执中周玄毅哲理辩"  # 指定单条
pnpm prepare:asr:local
```

输出：
```
artifacts/local_generated_*.utterances.json   # 裁剪版（2 分钟）
artifacts/local_full_*.utterances.json        # 全长版
```

> **超时说明**：默认 `effectiveTimeoutMs` 为 90 秒。全长音频需要按 `音频时长 / 2.5` 估算处理时间，然后通过 `LISTEN_GRAPHIC_E2E_ASR_TIMEOUT_MS` 设置足够大的超时。

> **环境变量**：`LISTEN_GRAPHIC_LOCAL_BRIDGE_REAL_ASR=1` 让脚本跳过启动 mock bridge，直接连已运行的 sherpa bridge。

### 3. 生成 replay fixture scaffold

```powershell
pnpm prepare:structure:local-replay

# 覆盖已有文件（重新从 artifact 生成）
pnpm prepare:structure:local-replay -- --force
```

生成的 scaffold 带**弱 acceptance**（`allowFallback: true`、低 `minMergedNodes`、`manualReviewTags: ["needs-acceptance-calibration"]`），不能直接作为回归门槛。

### 4. 人工校准 acceptance

编辑每条 `replay-local-*.json`：

```jsonc
// 校准前（scaffold 自动生成）
{
  "acceptance": {
    "minSegments": 1,
    "minMergedNodes": 11,
    "minMergedEdges": 0,
    "allowFallback": true,
    "manualReviewTags": ["needs-acceptance-calibration", "local-asr-source"]
  }
}

// 校准后（人工维护）
{
  "acceptance": {
    "minSegments": 1,
    "minMergedNodes": 5,
    "maxMergedNodes": 15,
    "minMergedEdges": 2,
    "allowFallback": false,
    "maxFallbackRuns": 0,
    "mustContainOneOfTexts": [
      ["辩论", "辩题"],
      ["脱口秀", "传统辩论"],
      ["叙事", "恢弘"]
    ],
    "mustHaveNodeTypes": ["claim"],
    "requiredEdgeTypes": ["opposes"],
    "forbiddenTexts": ["股票", "天气"],
    "manualReviewTags": ["local-asr-source", "calibrated"]
  }
}
```

校准要点：
- **核心语义锚点**：`mustContainOneOfTexts` 每组放同义表达
- **节点范围**：`minMergedNodes` / `maxMergedNodes` 防止过度拆分或合并
- **关系要求**：`requiredEdgeTypes` 标注必须出现的大类关系（别过度锁死）
- **幻觉防护**：`forbiddenTexts` 列出不应出现在该主题的词
- **移除** `"needs-acceptance-calibration"` tag
- **设置** `allowFallback: false`（如果该场景不应 fallback）

---

## 相关文件

| 文件 | 职责 |
|------|------|
| `asr-local-bridge-helpers.ts` | `writeLocalBridgeUtteranceArtifact()` — 写入 local artifact |
| `asr-realtime.local-bridge.test.ts` | 测试主体，`LISTEN_GRAPHIC_E2E_ASR_WRITE_ARTIFACTS=1` 时写 artifact |
| `scripts/run-local-asr-for-artifacts.mjs` | 编排脚本：检测 bridge → 跑 ASR → 写 artifact |
| `scripts/prepare-local-replay-fixtures.mjs` | 从 artifact 生成 replay scaffold + 弱 acceptance |
| `scripts/prepare-structure-replay-fixtures.mjs` | 腾讯 ASR 版 scaffold 生成（已有，本 pipeline 并行） |

---

## 与已有 pipeline 的关系

| | 腾讯实时 ASR | 本地 ASR（本 pipeline） |
|---|---|---|
| ASR 来源 | Tencent WebSocket API | sherpa-onnx 本地 bridge |
| Artifact 前缀 | `generated_*.utterances.json` | `local_*.utterances.json` |
| Replay 前缀 | `replay-realtime-*` | `replay-local-*` |
| `raw.source` | `"tencent-realtime-replay"` | `"local-asr-replay"` |
| Scaffold 脚本 | `prepare-structure-replay-fixtures.mjs` | `prepare-local-replay-fixtures.mjs` |
| 成本 | 消耗腾讯 API 额度 | 免费（本地 CPU） |
| 分割特征 | 云端模型分割，较稳定 | 本地模型分割，可能有碎片化 |
| 适用场景 | 验证腾讯 ASR 兼容性 | 批量收集分割分布、回归门槛 |

---

## 全长 fixture

现有 ASR fixture 默认 `audioClipDurationMs: 120000`（2 分钟裁剪）。要处理完整音频，使用 `full-*.json` fixture：

```
fixtures/asr-realtime/full-1_信息密集型_罗翔十一学校讲座.json   # audioClipDurationMs: null
```

这些 fixture 引用相同的 WAV 文件，但不裁剪时长。注意：
- 全长处理时间 = 音频时长 / ~2.5（脚本 targetSpeed）
- 必须设置 `LISTEN_GRAPHIC_E2E_ASR_TIMEOUT_MS` 为足够大的值
- 可用 `LISTEN_GRAPHIC_E2E_ASR_FIXTURE` 指定单条 fixture

---

## 环境变量速查

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `LISTEN_GRAPHIC_LOCAL_BRIDGE_REAL_ASR` | `"1"` = 使用真实 ASR，跳过 mock bridge | 未设置（mock 模式） |
| `LISTEN_GRAPHIC_LOCAL_BRIDGE_ENDPOINT` | WS 端点 | `ws://127.0.0.1:15377/ws` |
| `LISTEN_GRAPHIC_LOCAL_BRIDGE_HEALTH_URL` | Health 检查 URL | `http://127.0.0.1:15377/healthz` |
| `LISTEN_GRAPHIC_E2E_ASR_WRITE_ARTIFACTS` | `"1"` = 测试完成后写 artifact | 未设置（不写） |
| `LISTEN_GRAPHIC_E2E_ASR_TIMEOUT_MS` | 单条 fixture ASR 超时 | `90000`（90 秒） |
| `LISTEN_GRAPHIC_E2E_ASR_FIXTURE` | 按名称过滤 fixture | 未设置（跑全部） |
