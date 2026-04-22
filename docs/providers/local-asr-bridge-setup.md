# Local ASR Bridge 使用说明

> 状态：draft
> 最后更新：2026-04-22

> **本仓库不自带 ASR 模型**  
> `sherpa-onnx` 所需的 `encoder` / `decoder` ONNX 与 `tokens.txt` 需自行从 [k2-fsa/sherpa-onnx 发布物](https://github.com/k2-fsa/sherpa-onnx/releases)（如 `sherpa-onnx-streaming-paraformer-bilingual-zh-en`）下载并解压到本机。  
> 若使用 `pnpm run test:ext:e2e:real:sherpa`，默认会在仓库根下查找 **未纳入 git 的** 目录：`.tmp/sherpa-model/sherpa-onnx-streaming-paraformer-bilingual-zh-en/`（可用环境变量 `LISTEN_GRAPHIC_SHERPA_MODEL_DIR` 改路径）。准备步骤与排错与 [sherpa-onnx-streaming-asr.md](sherpa-onnx-streaming-asr.md)、下方「前提」一致。

本文档说明如何用本机已经装好的 `sherpa-onnx` 启动一个可被 ListenGraph 连接的 reference bridge。

推荐优先看这个 reference 目录：

- [tools/local-asr-bridge/sherpa-onnx/README.md](C:/Users/finni/Desktop/ListenGraph/tools/local-asr-bridge/sherpa-onnx/README.md)
- [tools/local-asr-bridge/sherpa-onnx/QUICKSTART.md](C:/Users/finni/Desktop/ListenGraph/tools/local-asr-bridge/sherpa-onnx/QUICKSTART.md)
- [tools/local-asr-bridge/sherpa-onnx/run.example.ps1](C:/Users/finni/Desktop/ListenGraph/tools/local-asr-bridge/sherpa-onnx/run.example.ps1)
- [tools/local-asr-bridge/sherpa-onnx/RELEASE.md](C:/Users/finni/Desktop/ListenGraph/tools/local-asr-bridge/sherpa-onnx/RELEASE.md)
- [tools/local-asr-bridge/sherpa-onnx/RELEASE-CHECKLIST.md](C:/Users/finni/Desktop/ListenGraph/tools/local-asr-bridge/sherpa-onnx/RELEASE-CHECKLIST.md)

如果你要实现自己的 bridge，而不是直接使用 sherpa reference bridge，请优先读：

- [Local ASR Bridge 最小接入规范](C:/Users/finni/Desktop/ListenGraph/docs/providers/local-asr-bridge-min-spec.md)
- [Local ASR Bridge 自检清单](C:/Users/finni/Desktop/ListenGraph/docs/providers/local-asr-bridge-self-checklist.md)

## 1. 前提

- 已安装 Python
- 已安装 `sherpa-onnx`（`pip install sherpa-onnx`，版本要求见 [sherpa-onnx-streaming-asr.md](sherpa-onnx-streaming-asr.md)）
- 已**在本机某路径**下载并解压好 streaming paraformer 模型（**非**仓库内子模块；路径由你自选或在跑 Sherpa 真实 E2E 时与 `LISTEN_GRAPHIC_SHERPA_MODEL_DIR` 对齐）
- ListenGraph extension 已切到 `Local ASR Bridge`（或跑 E2E 时由环境变量注入，见 [Extension 测试入口](../testing/README.md) 中 Sherpa 相关说明）

推荐模型：

- `sherpa-onnx-streaming-paraformer-bilingual-zh-en`

## 2. 启动命令

在仓库根目录运行：

```bash
pnpm dev:sherpa-asr-bridge -- --encoder <encoder.onnx> --decoder <decoder.onnx> --tokens <tokens.txt> --model-name sherpa-onnx-streaming-paraformer-bilingual-zh-en
```

如果你是 Windows 用户，更推荐直接改模板脚本后运行：

```powershell
pwsh -File .\tools\local-asr-bridge\sherpa-onnx\run.example.ps1
```

int8 示例：

```bash
pnpm dev:sherpa-asr-bridge -- ^
  --encoder D:\models\sherpa-onnx-streaming-paraformer-bilingual-zh-en\encoder.int8.onnx ^
  --decoder D:\models\sherpa-onnx-streaming-paraformer-bilingual-zh-en\decoder.int8.onnx ^
  --tokens D:\models\sherpa-onnx-streaming-paraformer-bilingual-zh-en\tokens.txt ^
  --model-name sherpa-onnx-streaming-paraformer-bilingual-zh-en
```

如果你希望加一个简单鉴权：

```bash
pnpm dev:sherpa-asr-bridge -- --encoder <...> --decoder <...> --tokens <...> --auth-token my-local-token
```

默认监听地址：

- WebSocket: `ws://127.0.0.1:15377/ws`
- Health: `http://127.0.0.1:15377/healthz`

## 3. Extension 侧配置

在 ListenGraph sidepanel 中填写：

- `ASR Provider Type`: `Local ASR Bridge`
- `ASR Endpoint`: `ws://127.0.0.1:15377/ws`
- `Local Bridge Transport`: `ws`
- `Local Bridge Protocol`: `lg-asr-ws-v1`
- `Local Bridge Auth Token`: 只有你启动 bridge 时设置了 `--auth-token` 才需要填

`ASR Model` 建议填你自己的模型名，方便运行时状态展示，例如：

- `sherpa-onnx-streaming-paraformer-bilingual-zh-en`

## 4. 行为说明

这个 reference bridge 会：

- 接收 ListenGraph 发来的 `session.start`
- 接收 `audio.frame`
- 把 `pcm_s16le` 转成 float32
- 调用 `recognizer.decode_stream()`
- 文本变化时发送 `transcript.partial`
- `recognizer.is_endpoint(stream)` 时发送 `transcript.final`
- `audio.flush` 时尽量把残留文本作为最终句发出

其中 sherpa 的这些细节都被收敛在 bridge 内部：

- `enable_endpoint_detection=True`
- `rule1/rule2/rule3`
- `reset(stream)`
- `input_finished()`

ListenGraph 本身不需要知道这些 vendor 细节。

## 5. 可调参数

常用启动参数：

- `--host`
- `--port`
- `--path`
- `--provider`
- `--num-threads`
- `--rule1-silence`
- `--rule2-silence`
- `--rule3-max-utterance`
- `--frame-duration-ms`

对播客/对话场景，当前默认值偏积极断句：

- `rule1=1.5`
- `rule2=0.8`
- `rule3=20.0`

## 6. 健康检查与排错

先检查服务是否起来：

```bash
curl http://127.0.0.1:15377/healthz
```

预期返回：

```json
{
  "ok": true,
  "provider": "sherpa-onnx-bridge",
  "protocol": "lg-asr-ws-v1",
  "model": "streaming-paraformer"
}
```

常见问题：

- `无法导入 sherpa_onnx`
  - 说明当前 `python` 不是你安装 `sherpa-onnx` 的那个环境
- `找不到模型文件`
  - 检查 `--encoder --decoder --tokens` 路径
- sidepanel 一直显示未连接
  - 先确认 `ASR Endpoint` 是否为 `ws://127.0.0.1:15377/ws`
  - 再确认 bridge 进程是否仍在运行
- 能连上但没字
  - 检查模型是否是 streaming paraformer，而不是离线模型
  - 检查输入是否是单声道 16k PCM 流

## 7. Thin E2E 入口

如果你只是想验证 ListenGraph 是否能吃到某个本地 bridge，而不关心底层实现，可以直接运行：

```bash
pnpm run test:ext:e2e:real:local-bridge
```

它默认要求：

- WebSocket: `ws://127.0.0.1:15377/ws`
- Health: `http://127.0.0.1:15377/healthz`
- Protocol: `lg-asr-ws-v1`

如果你用的是 sherpa reference bridge，也可以直接运行：

```bash
pnpm run test:ext:e2e:real:sherpa
```

这个入口会优先复用一个已经在运行的健康 sherpa bridge；如果没有，就按本机默认可覆盖的 Python 与**已存在的**模型目录自动启动一个（**模型不随仓库提供**，路径见文首与 [Extension 测试入口](../testing/README.md)「本仓库与本地 ASR 模型」）。

## 8. 定位

这个 bridge 的定位是：

- `Local ASR Bridge` 的首个 reference implementation

不是：

- ListenGraph 内置的唯一 ASR 方案

后续如果换成 whisper.cpp / faster-whisper / FunASR，只要继续说 `lg-asr-ws-v1`，ListenGraph 侧不需要再改一套产品语义。
