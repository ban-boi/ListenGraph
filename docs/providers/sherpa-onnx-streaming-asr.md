# SherpaOnnx 流式 Paraformer ASR — 开发笔记

> 最后更新：2026-04-20
> 状态：已验证可用

## 概述

本文档记录了使用 [SherpaOnnx](https://github.com/k2-fsa/sherpa-onnx) 的流式 Paraformer 模型实现本地实时语音识别（ASR）的完整过程，包括环境搭建、模型选择、踩坑记录和最终可工作的代码示例。

### 为什么选 SherpaOnnx + Streaming Paraformer？

| 考量 | 说明 |
|---|---|
| **流式能力** | Streaming Paraformer 支持真正的边说边出字，适合实时场景 |
| **中英混合** | bilingual-zh-en 模型同时支持中文和英文 |
| **完全离线** | 模型下载到本地后无需联网，适合隐私敏感场景 |
| **资源占用低** | int8 模型 encoder+decoder 仅 ~226MB，CPU 即可流畅运行 |
| **NPU 可选** | 理论上可通过 OpenVINO 后端利用 Intel NPU（Meteor Lake），但 Windows 上尚未成熟 |

### 与 SenseVoice / 离线 Paraformer 的对比

| 模型 | 类型 | 精度 | 速度 | 适用场景 |
|---|---|---|---|---|
| **Streaming Paraformer (bilingual)** | 流式 | 中 | 快（1x 实时） | 边说边出字、实时转录 |
| Paraformer-zh-small | 离线 | 中高 | 快 | 整段音频精转 |
| SenseVoice int8 | 离线 | 高 | 快 | 多语言精转、后处理 |

**关键结论：SenseVoice 和离线 Paraformer 不支持流式。** 流式场景必须使用 Streaming Paraformer。

---

## 环境搭建

### 硬件环境（参考）

- CPU: Intel Core Ultra 7 155H（Meteor Lake，22 线程）
- GPU: Intel Arc 核显（2GB）
- NPU: Intel AI Boost（已识别）
- 内存: 32GB
- OS: Windows 10

### 1. 安装 sherpa-onnx

```bash
pip install sherpa-onnx
```

验证安装：

```python
import sherpa_onnx
print(sherpa_onnx.__version__)  # 1.12.39
```

**注意事项：**
- 需要 Python 3.9+，Windows 预编译 wheel 支持 cp312/cp313
- 如果下载超时，设置代理：`HTTPS_PROXY=http://127.0.0.1:10809 pip install sherpa-onnx`
- `sherpa-onnx` 包含了 `sherpa-onnx-core` 依赖（ONNX Runtime），不需要额外安装 `onnxruntime`

### 2. 下载流式 Paraformer 模型

中英双语流式模型（推荐）：

```bash
curl -L -o sherpa-onnx-streaming-paraformer-bilingual-zh-en.tar.bz2 \
  https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-streaming-paraformer-bilingual-zh-en.tar.bz2

tar xvf sherpa-onnx-streaming-paraformer-bilingual-zh-en.tar.bz2
```

解压后目录结构：

```
sherpa-onnx-streaming-paraformer-bilingual-zh-en/
├── encoder.int8.onnx    (158MB) ← 流式编码器，推荐使用
├── decoder.int8.onnx    (68MB)  ← 流式解码器
├── encoder.onnx         (607MB) ← fp32 版本，更准但更慢、更占内存
├── decoder.onnx         (218MB) ← fp32 版本
├── tokens.txt                  ← 词表
└── test_wavs/                  ← 测试音频
    ├── 0.wav             (10.1s, 中英混合)
    ├── 1.wav             (5.1s)
    ├── 2.wav             (4.7s)
    ├── 3.wav             (8.8s)
    └── 8k.wav            (17.6s, 8kHz)
```

**推荐使用 int8 版本**，精度损失极小，速度快、内存占用低。

如果需要粤语支持，可以额外下载三语版本：

```bash
curl -L -o sherpa-onnx-streaming-paraformer-trilingual-zh-cantonese-en.tar.bz2 \
  https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-streaming-paraformer-trilingual-zh-cantonese-en.tar.bz2
```

---

## 核心用法

### 最小可用代码

```python
import sherpa_onnx

# 1. 创建流式识别器（关键：必须开启 endpoint detection！）
recognizer = sherpa_onnx.OnlineRecognizer.from_paraformer(
    encoder="sherpa-onnx-streaming-paraformer-bilingual-zh-en/encoder.int8.onnx",
    decoder="sherpa-onnx-streaming-paraformer-bilingual-zh-en/decoder.int8.onnx",
    tokens="sherpa-onnx-streaming-paraformer-bilingual-zh-en/tokens.txt",
    num_threads=4,
    provider="cpu",
    enable_endpoint_detection=True,    # ⚠️ 默认 False！必须显式开启
    rule1_min_trailing_silence=1.5,    # 纯静音 1.5s → 断句
    rule2_min_trailing_silence=0.8,    # 有语音后 0.8s 静音 → 断句
    rule3_min_utterance_length=20.0,   # 超过 20s → 强制断句
)

# 2. 创建音频流
stream = recognizer.create_stream()

# 3. 逐块送入音频
audio_chunk = [...]  # float32 列表，16kHz 单声道
stream.accept_waveform(16000, audio_chunk)

# 4. 解码
while recognizer.is_ready(stream):
    recognizer.decode_stream(stream)

# 5. 获取结果
result = recognizer.get_result(stream)
# result.json() 返回: {"text": "识别文字", "segment": 0, "is_final": false, ...}

# 6. 检测是否应该断句
if recognizer.is_endpoint(stream):
    text = result.json()["text"]  # 这是这一段的最终结果
    recognizer.reset(stream)      # 清空 buffer，开始新一段

# 7. 音频结束时
stream.input_finished()
while recognizer.is_ready(stream):
    recognizer.decode_stream(stream)
final_result = recognizer.get_result(stream)
```

### Endpoint Detection 参数详解

| 参数 | 默认值 | 说明 |
|---|---|---|
| `enable_endpoint_detection` | **False** | 是否启用断句检测。**必须显式设为 True** |
| `rule1_min_trailing_silence` | 2.4 | 连续静音多少秒后触发断句（不管前面有没有语音） |
| `rule2_min_trailing_silence` | 1.2 | 有语音后静音多少秒触发断句 |
| `rule3_min_utterance_length` | 20.0 | 超过多少秒强制断句（防止超长段落） |

**调参建议：**
- 播客/对话场景：`rule1=1.5, rule2=0.8`（更敏感，短句也能切分）
- 演讲/报告场景：`rule1=2.4, rule2=1.2`（更宽松，避免长句被切断）
- 测试默认值即可，大多数场景表现合理

### 结果格式

`get_result(stream).json()` 返回：

```json
{
  "text": "我和阿鹏阿詹我们仨有一个群",
  "tokens": ["我", "和", "阿", "鹏", ...],
  "timestamps": [],
  "segment": 0,
  "start_time": 0.0,
  "is_final": false
}
```

**注意：** Streaming Paraformer **不支持字级时间戳**（`timestamps` 始终为空数组）。如果需要时间戳，需要在应用层根据音频 chunk 的送入时间自行推算。

---

## 踩坑记录

### 🔴 坑 1：enable_endpoint_detection 默认为 False

**现象：** 识别结果在某个时间点后不再更新，文本卡住不变，`is_endpoint` 始终返回 False，产生 0 个 segment。

**原因：** `OnlineRecognizer.from_paraformer()` 的 `enable_endpoint_detection` 参数默认值是 `False`。这意味着 endpoint detection 完全关闭，`is_endpoint()` 永远不会触发，`reset()` 永远不会被调用，流式识别器的内部 buffer 会累积到某个上限后停止产生新结果。

**修复：**

```python
recognizer = sherpa_onnx.OnlineRecognizer.from_paraformer(
    ...,
    enable_endpoint_detection=True,  # ⚠️ 必须加这一行！
)
```

**影响范围：** 这个坑在两个不同音频文件（课堂录音 + 播客）上均复现，应该是所有长音频都会遇到。

### 🟡 坑 2：不用 reset 会导致结果卡住

**现象：** 即使开启了 endpoint detection，如果检测到 endpoint 后不调用 `reset()`，流式识别器会继续在同一个 stream 上累积，最终还是会卡住。

**修复：** 每次 `is_endpoint()` 返回 True 时，必须调用 `reset()`：

```python
if recognizer.is_endpoint(stream):
    # 保存当前段落的最终文本
    final_text = get_text(result)
    # 清空 buffer，开始新段落
    recognizer.reset(stream)
```

### 🟡 坑 3：模型名称中的 "sherpa-onnx-" 前缀

**现象：** 模型目录名带 `sherpa-onnx-` 前缀，容易误以为必须安装 sherpa-onnx 才能用。

**事实：** `.onnx` 文件是通用的 ONNX 格式，理论上可以用任何支持 ONNX 的推理引擎加载（如 `onnxruntime`）。但 sherpa-onnx 封装了流式 API、VAD、endpoint detection 等高级功能，自己用裸 onnxruntime 重新实现会非常麻烦。**推荐直接用 sherpa-onnx。**

### 🟢 关于 NPU 加速

**当前状态：** Intel Meteor Lake 的 NPU（Intel AI Boost）在 Windows 上通过 sherpa-onnx 的 OpenVINO 后端使用，目前不够成熟。需要额外安装 `openvino` 包，且并非所有算子都能跑在 NPU 上（部分会 fallback 到 CPU）。

**实测结论：** CPU 推理在 Ultra 7 155H 上已经达到 1.0x 实时速率，完全够用。NPU 加速收益不大，暂时不需要折腾。

---

## 实测效果

### 测试环境

- 硬件：Intel Core Ultra 7 155H, 32GB RAM
- Python：3.13
- sherpa-onnx：1.12.39
- 模型：streaming-paraformer-bilingual-zh-en (int8)

### 测试 1：自带测试音频（中英混合）

文件：`test_wavs/0.wav`（10.1s）
内容：「昨天是 monday today day is 零八二 the day after tomorrow 是星期三」

- 模型加载：1.94s
- 识别结果：`昨天是 monday today day is 礼拜二 the day after tomorrow 是星期三`
- 小偏差：「零八二」被识别为「礼拜二」（int8 量化精度损失，可接受）
- 实时倍率：1.00x

### 测试 2：鲁豫对话播客（中文对话）

文件：`鲁豫对话庞颖詹青云.mp3`（截取前 60s）

- 模型加载：1.33s
- 识别出 **6 个 segments**，自动断句
- 识别精度：**非常高**，播客清晰人声几乎零错字
- 实时倍率：1.01x

识别结果：

```
[  6.0s] 我和阿鹏阿詹我们仨有一个群阿鹏给这个群起名叫鲁豫老师的粉丝
[  8.8s] 我觉得这个名字非常可爱
[ 12.4s] 我也接受但同时我也是他们俩的粉
[ 22.0s] 我曾经在我的音频节目当中分别采访过他们俩我们也在辩论场上彼此见面完成了我人生第一次辩论
[ 42.4s] 我能够看到我们身上各自的特长也能够看到彼此身上的闪光其实我们是相个很不相同的人我是七零后阿庞出生于八八年是八零后阿詹九零年九零后三个不同的年代三个人有着不同的性格不同的成长背景原本是三条平行线
[ 54.0s] 但可能是命运吧让我们在这个时刻发生交汇我们在各自领域始终在努力的表达也始终对世界保持着最大的热忱和好奇
```

### 测试 3：罗翔讲座（课堂录音，远场麦克风）

文件：`罗翔十一学校讲座.mp3`（截取前 30s）

- 识别效果较差，大量错字
- 原因：远场麦克风 + 环境混响 + 非正式语速（调试设备阶段）
- 结论：流式模型在嘈杂环境下精度明显下降，这类场景建议用离线模型（SenseVoice）做后处理精转

---

## 在 ListenGraph 中集成的方向

### 架构思路

ListenGraph 不内置也不分发 ASR 模型，而是定义一个标准化的 WebSocket 协议。用户用任何 ASR 引擎启动一个 ws 服务，ListenGraph 连上去就行。

### 需要实现的内容

1. **ws-bridge ASR Provider** — 在 `packages/providers` 中新增一个 provider，实现 `AsrProvider` 接口的流式扩展
2. **标准化 ws 协议** — 定义 LG ↔ ASR Bridge 的通信格式
3. **参考 bridge 实现** — 提供基于 sherpa-onnx streaming paraformer 的 Python 参考实现

### 关键 API 参考

```python
# OnlineRecognizer 完整参数签名
sherpa_onnx.OnlineRecognizer.from_paraformer(
    tokens: str,                          # 词表路径
    encoder: str,                         # encoder.onnx 路径
    decoder: str,                         # decoder.onnx 路径
    num_threads: int = 2,                 # 推理线程数
    sample_rate: float = 16000,           # 采样率
    feature_dim: int = 80,                # 特征维度
    enable_endpoint_detection: bool = False,  # ⚠️ 断句检测（默认关闭！）
    rule1_min_trailing_silence: float = 2.4,
    rule2_min_trailing_silence: float = 1.2,
    rule3_min_utterance_length: float = 20.0,
    decoding_method: str = "greedy_search",
    provider: str = "cpu",                # "cpu" | "cuda" | "coreml" | "openvino"
    debug: bool = False,
)

# Stream 方法
stream.accept_waveform(sample_rate, samples)  # 送入音频（float32 list）
stream.input_finished()                         # 标记音频结束
recognizer.is_ready(stream)                     # 是否可以继续 decode
recognizer.decode_stream(stream)                # 执行一次解码
recognizer.get_result(stream)                   # 获取当前识别结果
recognizer.is_endpoint(stream)                  # 是否检测到断句点
recognizer.reset(stream)                        # 重置 stream，开始新段落
```

### 参考资源

- [SherpaOnnx GitHub](https://github.com/k2-fsa/sherpa-onnx)
- [Streaming Paraformer 模型文档](https://k2-fsa.github.io/sherpa/onnx/pretrained_models/online-paraformer/paraformer-models.html)
- [Streaming WebSocket Server 文档](https://k2-fsa.github.io/sherpa/onnx/python/streaming-websocket-server.html)
- [SherpaOnnx Python API 文档](https://k2-fsa.github.io/sherpa/onnx/python/index.html)
