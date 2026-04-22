# Quickstart

这份 quickstart 面向第一次在自己电脑上跑 `SherpaOnnx Reference Bridge` 的用户。

## 1. 安装依赖

确认 `python` 可用：

```powershell
python --version
```

安装 Python 依赖：

```powershell
python -m pip install -r .\tools\local-asr-bridge\sherpa-onnx\requirements.txt
```

## 2. 准备模型

你需要一套 streaming paraformer 模型文件：

- `encoder.int8.onnx` 或 `encoder.onnx`
- `decoder.int8.onnx` 或 `decoder.onnx`
- `tokens.txt`

推荐模型：

- `sherpa-onnx-streaming-paraformer-bilingual-zh-en`

## 3. 改启动脚本

打开：

- [run.example.ps1](C:/Users/finni/Desktop/ListenGraph/tools/local-asr-bridge/sherpa-onnx/run.example.ps1)

只改这三行：

```powershell
$encoder = 'D:\models\...\encoder.int8.onnx'
$decoder = 'D:\models\...\decoder.int8.onnx'
$tokens = 'D:\models\...\tokens.txt'
```

## 4. 启动 bridge

```powershell
pwsh -File .\tools\local-asr-bridge\sherpa-onnx\run.example.ps1
```

成功时你会看到：

```text
[sherpa-onnx-bridge] listening on ws://127.0.0.1:15377/ws
[sherpa-onnx-bridge] health check: http://127.0.0.1:15377/healthz
```

## 5. 验证本地服务

```powershell
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:15377/healthz
```

应该返回 JSON，而不是连接失败。

## 6. ListenGraph 里怎么填

sidepanel 里填：

- `ASR Provider Type`: `Local ASR Bridge`
- `ASR Endpoint`: `ws://127.0.0.1:15377/ws`
- `Local Bridge Transport`: `ws`
- `Local Bridge Protocol`: `lg-asr-ws-v1`

## 7. 第一次联调时看什么

如果配置正确，sidepanel 里通常会看到：

- `Local ASR Bridge 连接中`
- `Local ASR Bridge 已连接`
- `Local ASR Bridge 握手成功`

## 8. 最常见错误

- `Local ASR Bridge WebSocket 连接失败`
  - 一般是 bridge 没启动，或终端被关掉了
- `找不到模型文件`
  - 三个模型路径至少有一个填错
- `无法导入 sherpa_onnx`
  - 你运行脚本用的 `python` 不是安装依赖时那套 Python
