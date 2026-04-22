# SherpaOnnx Reference Bridge

这是 ListenGraph `Local ASR Bridge` 的参考实现。

它的作用是：

- 在你本机启动一个 WebSocket ASR bridge
- 用 `sherpa-onnx streaming paraformer` 做本地实时识别
- 通过 `lg-asr-ws-v1` 把结果喂给 ListenGraph

它不是：

- ListenGraph 唯一支持的本地 ASR
- 一键安装器
- 自动下载模型的 companion app

## 包内文件

- `sherpa-onnx-bridge.py`
  - 实际 bridge server
- `run.example.ps1`
  - Windows 启动模板
- `requirements.txt`
  - 最小 Python 依赖
- `QUICKSTART.md`
  - 第一次上手最短路径
- `RELEASE.md`
  - 这个包应该如何理解和分发
- `RELEASE-CHECKLIST.md`
  - 发给别人之前最后核对什么

## ListenGraph 里怎么填

- `ASR Provider Type`: `Local ASR Bridge`
- `ASR Endpoint`: `ws://127.0.0.1:15377/ws`
- `Local Bridge Transport`: `ws`
- `Local Bridge Protocol`: `lg-asr-ws-v1`

## 成功标志

bridge 启动后应看到：

```text
[sherpa-onnx-bridge] listening on ws://127.0.0.1:15377/ws
[sherpa-onnx-bridge] health check: http://127.0.0.1:15377/healthz
```
