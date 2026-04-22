# Local ASR Bridge 自检清单

> 状态：draft
> 最后更新：2026-04-22
> 用途：在把某个本地 bridge 交给别人或接入 ListenGraph 之前，快速判断它是不是“产品上可用”

推荐搭配阅读：

- [Local ASR Bridge 最小接入规范](C:/Users/finni/Desktop/ListenGraph/docs/providers/local-asr-bridge-min-spec.md)
- [LG-ASR-WS v1 协议草案](C:/Users/finni/Desktop/ListenGraph/docs/providers/lg-asr-ws-v1.md)

## 1. 进程与地址

开始之前先确认：

- bridge 进程确实已经启动
- WebSocket 地址明确
- 健康检查地址明确

最低要求：

- WebSocket: `ws://127.0.0.1:15377/ws`
- Health: `http://127.0.0.1:15377/healthz`

如果你用的不是这组默认地址，后面所有步骤都要同步改成你的地址。

## 2. 健康检查

先跑：

```powershell
curl http://127.0.0.1:15377/healthz
```

通过标准：

- 返回 HTTP 200
- 返回内容是 JSON
- JSON 至少能看出 bridge 是活的

最好还包含：

- `protocol`
- `model`
- `engine`

不通过就不要继续测 ListenGraph 侧。

## 3. 握手检查

你的 bridge 至少要接受：

- `session.start`
- `audio.frame`
- `audio.flush`

最低通过标准：

- 建立 ws 后不会立刻断开
- 收到 `session.start` 后不会报协议错误
- 可以回 `session.started` 或 `status=connected/listening`

如果握手阶段就失败，ListenGraph 侧只会表现成“桥接连接失败”。

## 4. 结果语义检查

至少确认这 4 件事：

- 能输出 `transcript.final`
- `final` 文本不是空字符串
- 同一 `utteranceId` 的 final 发出后不再改写
- `endMs >= startMs`

如果这几条不满足，图谱链路就不可靠。

## 5. flush 检查

这是最容易漏的一条。

你必须确认：

- 输入结束时，如果最后一段还没主动 endpoint，也能在 `audio.flush` 后吐出 final

因为 ListenGraph 的 fixture 和很多短输入场景，最后都依赖这个收尾能力。

如果没有这条，会出现：

- 连接正常
- partial 正常
- 最后不出 final
- graph 永远不出来

## 6. 时间戳检查

检查这几条：

- `startMs` 和 `endMs` 都是数字
- 同一 session 内时间不倒退
- `endMs >= startMs`
- 明显长音频时，时间跨度和真实音频长度大致一致

不要求一开始就特别精确，但不能乱跳。

## 7. 错误可见性检查

故意制造一个错误，至少验证一项：

- 模型路径错误
- 端口冲突
- 鉴权 token 不匹配
- 不支持的协议版本

通过标准：

- bridge 会返回 `error.code`
- bridge 会返回人能看懂的 `error.message`

如果这里做不到，别人接入时基本无法排错。

## 8. ListenGraph 侧 smoke

bridge 自检通过后，再跑 ListenGraph 真正的 headless 闭环：

```powershell
pnpm run test:ext:e2e:real:local-bridge
```

通过标准：

- test 通过
- `extension.real.spec.ts` 不超时
- 最终能产 graph

这一步通过，才算“不是只有 bridge 自己觉得自己可用”，而是 ListenGraph 真能消费。

## 9. sherpa 专用补充

如果你的 bridge 底层是 sherpa-onnx，再额外确认：

- 使用的是 streaming 模型，不是离线模型
- 输入音频真的是 16k mono PCM 流
- endpoint 参数不会过于保守，导致一直不出 final

对当前仓库里的 sherpa reference bridge，可以直接用：

```powershell
pnpm run test:ext:e2e:real:sherpa
```

## 10. 面向分发的最终判断

如果你准备把 bridge 发给别人，最后问自己这 5 个问题：

1. 别人知道该连哪个 ws 地址吗
2. 别人知道怎么判断 bridge 活着吗
3. 出错时 message 是人能看懂的吗
4. `audio.flush` 后一定会尽量产出最后 final 吗
5. `pnpm run test:ext:e2e:real:local-bridge` 在一台真实机器上过了吗

这 5 个问题都能回答“是”，这个 bridge 才算进入“可分发”阶段。
