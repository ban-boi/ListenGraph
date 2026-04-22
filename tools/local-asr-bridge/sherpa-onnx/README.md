# SherpaOnnx Reference Bridge

这个目录是 `Local ASR Bridge` 的首个 reference implementation 入口。

定位：

- 面向 ListenGraph 用户和开发者
- 作为 `lg-asr-ws-v1` 的参考后端
- 用 `sherpa-onnx streaming paraformer` 跑本地实时 ASR

不是：

- ListenGraph 内置唯一 ASR
- 安装器
- 跨平台一键分发包

## 目录说明

- [run.example.ps1](C:/Users/finni/Desktop/ListenGraph/tools/local-asr-bridge/sherpa-onnx/run.example.ps1)
  - Windows 启动模板
  - 把模型路径改成你自己的即可
- [requirements.txt](C:/Users/finni/Desktop/ListenGraph/tools/local-asr-bridge/sherpa-onnx/requirements.txt)
  - 这个 reference bridge 的最小 Python 依赖
- [QUICKSTART.md](C:/Users/finni/Desktop/ListenGraph/tools/local-asr-bridge/sherpa-onnx/QUICKSTART.md)
  - 第一次启动时最短路径
- [RELEASE.md](C:/Users/finni/Desktop/ListenGraph/tools/local-asr-bridge/sherpa-onnx/RELEASE.md)
  - 如果你要打 zip 发给别人，该怎么组织
- [RELEASE-CHECKLIST.md](C:/Users/finni/Desktop/ListenGraph/tools/local-asr-bridge/sherpa-onnx/RELEASE-CHECKLIST.md)
  - 发出去之前最后核对什么
- [../../../sherpa-onnx-bridge.py](C:/Users/finni/Desktop/ListenGraph/tools/sherpa-onnx-bridge.py)
  - 实际 bridge server
  - 负责把 sherpa 原生行为映射成 `lg-asr-ws-v1`

## 最短启动

1. 安装 Python
2. 安装依赖：

```powershell
python -m pip install -r .\tools\local-asr-bridge\sherpa-onnx\requirements.txt
```

3. 下载 streaming paraformer 模型
4. 修改 `run.example.ps1` 中的模型路径
5. 运行：

```powershell
pwsh -File .\tools\local-asr-bridge\sherpa-onnx\run.example.ps1
```

或者在仓库根目录直接运行：

```powershell
pnpm dev:sherpa-asr-bridge -- --encoder <encoder.onnx> --decoder <decoder.onnx> --tokens <tokens.txt>
```

## ListenGraph 侧配置

sidepanel 里填：

- `ASR Provider Type`: `Local ASR Bridge`
- `ASR Endpoint`: `ws://127.0.0.1:15377/ws`
- `Local Bridge Transport`: `ws`
- `Local Bridge Protocol`: `lg-asr-ws-v1`

如果 bridge 启动时设置了 `--auth-token`，再额外填写：

- `Local Bridge Auth Token`

## 成功标志

bridge 终端里应出现：

```text
[sherpa-onnx-bridge] listening on ws://127.0.0.1:15377/ws
[sherpa-onnx-bridge] health check: http://127.0.0.1:15377/healthz
```

可额外检查：

```powershell
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:15377/healthz
```

## 常见问题

- `Local ASR Bridge WebSocket 连接失败`
  - 通常是 bridge 没启动，或者终端已经关了
- `找不到模型文件`
  - 说明 `encoder/decoder/tokens` 路径填错了
- `无法导入 sherpa_onnx`
  - 说明当前 `python` 不是装了 `requirements.txt` 里依赖的那套环境
- 能连上但没结果
  - 优先确认用的是 streaming paraformer，不是离线模型

## 产品关系

正确的产品关系是：

- `Local ASR Bridge` 是产品能力
- `SherpaOnnx Reference Bridge` 是参考实现

后面如果换成 `whisper.cpp / faster-whisper / FunASR`，ListenGraph 主入口不应该改名，只需要再多一个新的 bridge 实现。
