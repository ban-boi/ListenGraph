# Quickstart

## 1. 安装依赖

```powershell
python --version
python -m pip install -r .\requirements.txt
```

## 2. 准备模型

你需要这三个文件：

- `encoder.int8.onnx` 或 `encoder.onnx`
- `decoder.int8.onnx` 或 `decoder.onnx`
- `tokens.txt`

推荐模型：

- `sherpa-onnx-streaming-paraformer-bilingual-zh-en`

## 3. 修改启动脚本

打开 `run.example.ps1`，只改这三行：

```powershell
$encoder = 'D:\models\...\encoder.int8.onnx'
$decoder = 'D:\models\...\decoder.int8.onnx'
$tokens = 'D:\models\...\tokens.txt'
```

## 4. 启动 bridge

```powershell
pwsh -File .\run.example.ps1
```

## 5. 验证服务

```powershell
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:15377/healthz
```

如果能返回 JSON，说明 bridge 已经在本机正常监听。

## 6. ListenGraph 里填写

- `ASR Provider Type`: `Local ASR Bridge`
- `ASR Endpoint`: `ws://127.0.0.1:15377/ws`
- `Local Bridge Transport`: `ws`
- `Local Bridge Protocol`: `lg-asr-ws-v1`

## 7. 常见问题

- `Local ASR Bridge WebSocket 连接失败`
  - 通常是 bridge 没启动，或者终端已经关掉
- `找不到模型文件`
  - 模型路径填错了
- `无法导入 sherpa_onnx`
  - 说明你当前 `python` 不是装依赖时的那套 Python
