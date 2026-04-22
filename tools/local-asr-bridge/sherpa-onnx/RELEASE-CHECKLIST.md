# Release Checklist

这份 checklist 面向你自己在“准备发给别人之前”的最后检查。

## 1. 文件完整性

- `sherpa-onnx-bridge.py` 在包里
- `run.example.ps1` 在包里
- `requirements.txt` 在包里
- `QUICKSTART.md` 在包里
- `README.md` 在包里
- 文档里没有引用一个根本不存在的文件

## 2. 启动脚本检查

- `run.example.ps1` 里的三条模型路径还是占位示例，不是你自己的私人路径
- 默认端口是 `15377`
- 默认路径是 `/ws`
- 默认 host 是 `127.0.0.1`
- 如果用户不需要鉴权，脚本里没有强制要求 `auth token`

## 3. 依赖检查

- `requirements.txt` 至少包含 `sherpa-onnx`
- `python -m pip install -r requirements.txt` 可以成功
- 当前脚本兼容你实际验证过的 `sherpa-onnx` 版本

## 4. 文档检查

- `QUICKSTART.md` 只保留最短路径
- `README.md` 讲清楚“产品能力”和“参考实现”的关系
- `RELEASE.md` 讲清楚 zip 应该包含哪些文件
- 文档里明确写了：
  - `ASR Provider Type = Local ASR Bridge`
  - `ASR Endpoint = ws://127.0.0.1:15377/ws`
  - `Local Bridge Protocol = lg-asr-ws-v1`

## 5. 运行检查

- 启动 bridge 后终端能看到：
  - `listening on ws://127.0.0.1:15377/ws`
  - `health check: http://127.0.0.1:15377/healthz`
- `Invoke-WebRequest -UseBasicParsing http://127.0.0.1:15377/healthz` 有返回
- ListenGraph sidepanel 至少能看到：
  - `Local ASR Bridge 连接中`
  - `Local ASR Bridge 已连接`
  - `Local ASR Bridge 握手成功`

## 6. 沟通检查

- 你对外描述的是 `Local ASR Bridge`
- 你没有把产品能力直接命名成 `SherpaOnnx`
- 你明确告诉用户：
  - sherpa 只是 reference backend
  - 后面可以换别的本地 ASR 实现

## 7. 当前不要承诺的事

- 不要承诺一键安装
- 不要承诺自动下载模型
- 不要承诺对所有 Windows 环境零配置可用
- 不要承诺所有本地 ASR 都已经现成接好

## 8. 发出前最后一句自检

你应该能用一句话说明它是什么：

> 这是一个让 ListenGraph 通过 `lg-asr-ws-v1` 接入本地 sherpa-onnx 流式 ASR 的 reference bridge，不是唯一实现，也不是最终安装器。
