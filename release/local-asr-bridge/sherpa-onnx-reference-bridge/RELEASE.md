# Release Packaging

这个目录就是推荐直接打 zip 发给别人的最小发布包。

## 推荐做法

直接压缩整个目录：

```text
release/local-asr-bridge/sherpa-onnx-reference-bridge/
```

## 适用对象

- 内测用户
- 技术用户
- 愿意自己安装 Python 依赖和下载模型的人

## 当前不要承诺

- 一键安装
- 自动下载模型
- 面向完全非技术用户零配置可用

这个包的目标是：

- 让别人用最少步骤接上 ListenGraph 的 `Local ASR Bridge`
