# Release Packaging

这份文档回答一个很具体的问题：

- 如果你要把 `SherpaOnnx Reference Bridge` 发给别人，应该打包哪些文件？

## 1. 推荐发布方式

当前最务实的方式不是做安装器，而是发一个 zip。

zip 内建议至少包含：

1. `run.example.ps1`
2. `requirements.txt`
3. `QUICKSTART.md`
4. `README.md`
5. `../../../sherpa-onnx-bridge.py`

如果你希望用户完全脱离仓库目录运行，再额外包含：

6. `LICENSE` 或你准备附带的说明文件
7. 你自己的模型下载说明

## 2. 为什么不要直接把整个仓库发出去

原因很简单：

- 用户真正需要的只有 bridge，不需要 extension 源码
- 整个仓库体积更大，理解成本更高
- 会让用户误以为必须先理解 ListenGraph 内部实现

这个 reference bridge 的目标应该是：

- 单独看这一小包，就知道怎么装依赖、怎么改路径、怎么启动、怎么做 health check

## 3. 推荐 zip 结构

推荐压缩包内呈现为：

```text
sherpa-onnx-reference-bridge/
  sherpa-onnx-bridge.py
  run.example.ps1
  requirements.txt
  QUICKSTART.md
  README.md
```

这样对外分发时最清晰。

## 4. 打包前要做的替换

在真正发给别人前，建议做这几个动作：

1. 保留 `run.example.ps1` 里的占位模型路径，不要写你自己的本机绝对路径
2. 确保 `QUICKSTART.md` 的命令与当前脚本一致
3. 确保 `requirements.txt` 版本没有写得过死
4. 确保文档里的默认地址仍是：
   - `ws://127.0.0.1:15377/ws`
   - `http://127.0.0.1:15377/healthz`

## 5. 你发给用户时建议附带的话

可以直接附一句：

> 这是 ListenGraph 的 `Local ASR Bridge` 参考实现。你只需要安装 Python 依赖、改模型路径、运行脚本，然后在 ListenGraph 里把 ASR 指到 `ws://127.0.0.1:15377/ws`。

这样用户不会把它理解成“另一个完整项目”。

## 6. 当前已知边界

这个 zip 方案适合：

- 内测用户
- 技术用户
- 你自己控制沟通的分发场景

暂时不适合：

- 完全面向非技术用户的一键安装
- 自动下载模型
- 自动创建桌面快捷方式

这些都应该是下一阶段的 companion/installer 工作，而不是这个 reference bridge 当前要承担的职责。
