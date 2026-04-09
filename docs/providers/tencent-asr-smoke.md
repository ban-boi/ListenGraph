# 腾讯 ASR 联调 Checklist

本文档面向 ListenGraph 当前的腾讯云 ASR 直连联调。

适用范围：
- Chrome extension 本地开发
- `ASR=tencent/direct`
- `Structurer=mock`
- 优先覆盖 `transport=ws` 的 realtime WebSocket 链路

说明：
- 当前运行时主推荐是 `tencent/ws`
- `tencent/batch` 仍然保留，但更适合做对照实验或回退排查

## 联调前提

开始前先确认：

1. 已执行 `pnpm --filter extension build`
2. Chrome 里加载的是 `apps/extension/dist`
3. sidepanel 中腾讯配置已保存：
   - `Secret ID`
   - `Secret Key`
   - `App ID`
   - `Transport = ws`
   - `Engine Model = 16k_zh`
4. 测试页面是真正有音频输出的浏览器标签页
5. 分享时选择的是“当前标签页”，并勾选“分享标签页音频”

## 最小联调步骤

1. 打开 `chrome://extensions`
2. 对当前 ListenGraph 扩展点击 `Reload`
3. 刷新正在播放音频的标签页
4. 打开 sidepanel
5. 确认配置：
   - `ASR = tencent`
   - `Structurer = mock`
   - `Transport = ws`
   - `Need VAD = on`
6. 点击“开始”
7. 在浏览器弹窗里选择当前标签页，并勾选标签页音频
8. 等待 realtime 连接成功并送出第一批音频帧

## 正常日志序列

一次成功的最小日志，通常应接近下面这个顺序：

1. `状态: capturing`
2. `ASR_STREAM_STATUS: connecting`
3. `ASR_STREAM_STATUS: connected`
4. `ASR_STREAM_PARTIAL_UPDATED`（可有可无，只用于调试）
5. `ASR_STREAM_UTTERANCE_READY`
6. `转写: ...`
7. `状态: structuring`
8. `图更新: ... 个节点`
9. `状态: capturing`

说明：
- realtime 音频帧按约 `40ms` 推送
- 当前只消费腾讯返回里的 `slice_type=2` 稳定句段驱动 structurer
- `slice_type=0/1` 中间结果可出现，但不应直接落库为最终 transcript

## 停止行为预期

点击“停止”后，当前版本的预期是：

1. sidepanel 先显示 `停止中...`
2. content script 停止继续采集
3. content script 发送 realtime 结束标记并关闭 WebSocket
4. 当前 session 被清理
5. 按钮恢复为“开始”

如果停止后长时间不回到“开始”，优先怀疑扩展没有 reload 到最新构建。

## 常见故障对照表

| 现象 | 典型原因 | 优先检查 | 处理方式 |
|------|----------|----------|----------|
| `Unable to load a worklet's module.` | worklet 资源未被扩展正确加载 | 是否 reload 到最新 `dist` | 重新 build 并 reload 扩展 |
| `Could not establish connection. Receiving end does not exist.` | 页面里没有可用 content script | 标签页是否在扩展 reload 前打开 | 刷新页面，再次开始 |
| `ASR_STREAM_ERROR` | realtime 握手/鉴权/连接失败 | 是否配置了 `App ID / Secret ID / Secret Key` | 先检查签名参数与密钥 |
| 长时间没有 `ASR_STREAM_UTTERANCE_READY` | 腾讯只返回了中间结果，稳定句段未收口 | 是否开启 `Need VAD`、音频是否过短或无停顿 | 先让音频说满一个自然句子 |
| `TIMEOUT_ERROR` | 更常见于 structurer，而不是 realtime ASR 本身 | 看是否已经有 `转写:` | 如果已有转写，问题不在 ASR |
| 点击停止后一直卡在 `停止中...` | 当前 ASR 请求没被中断 | 扩展是否为最新构建 | reload 最新版本，本问题已修复 |
| `转写:` 出来了但没有图 | structurer 链路失败或仍在处理中 | 是否有 `状态: structuring`、`图更新` | 先用 `Structurer=mock` 收敛问题 |
| 提示无音轨或捕获失败 | 分享时未勾选标签页音频 | 分享目标是否是当前标签页 | 重新开始并勾选音频 |
| 腾讯有用量，但扩展没出字 | WS 已连上，但稳定句段没回到 service worker | 看 `ASR_STREAM_STATUS / UTTERANCE_READY / ERROR` | 先确认 content script 和 worker 都是最新构建 |

## 快速判读规则

看到下面这些日志时，可以直接这样判断：

- 有 `ASR_STREAM_STATUS: connected`
  - 腾讯 realtime 握手已通过
- 有 `ASR_STREAM_PARTIAL_UPDATED`
  - realtime 中间结果已经回来
- 有 `ASR_STREAM_UTTERANCE_READY`
  - 稳定句段已经回到扩展主链路
- 有 `转写:`
  - ASR 已打通，后续问题不在 ASR
- 有 `图更新`
  - 整条主链路已走通

## 当前链路边界

当前 ListenGraph 的腾讯实现已同时支持：

- `transport=ws`：实时 WebSocket 主链路
- `transport=batch`：保留的批处理对照链路

当前联调文档默认面向：
- realtime WS 是否能连接成功
- 稳定句段是否能回到扩展
- structurer 是否能消费稳定句段

若需要对比旧链路，请单独切换 `transport=batch`，不要把本页与 batch 轮询日志混用。
