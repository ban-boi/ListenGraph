# 腾讯 ASR 联调 Checklist

本文档面向 ListenGraph 当前的腾讯云 ASR 直连联调。

适用范围：
- Chrome extension 本地开发
- `ASR=tencent/direct`
- `Structurer=mock`
- 录音文件识别轮询链路

## 联调前提

开始前先确认：

1. 已执行 `pnpm --filter extension build`
2. Chrome 里加载的是 `apps/extension/dist`
3. sidepanel 中腾讯配置已保存：
   - `Secret ID`
   - `Secret Key`
   - `Region`
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
   - `Region = ap-shanghai`
6. 点击“开始”
7. 在浏览器弹窗里选择当前标签页，并勾选标签页音频
8. 等待第一段音频分片送出

## 正常日志序列

一次成功的最小日志，通常应接近下面这个顺序：

1. `状态: capturing`
2. `状态: transcribing`
3. `ASR: 腾讯 ASR 正在创建识别任务，第 1 次请求`
4. `ASR: 腾讯 ASR 任务已创建，TaskId=...`
5. `ASR: 腾讯 ASR 轮询中，TaskId=...，第 1 次，状态=waiting` 或 `doing`
6. `ASR: 腾讯 ASR 完成，TaskId=...，耗时约 ... 秒`
7. `转写: ...`
8. `状态: structuring`
9. `图更新: ... 个节点`
10. `状态: capturing`

说明：
- 当前音频分片为 `10s`
- 当前腾讯链路是“创建任务 + 轮询”，不是 WebSocket 实时流式
- 日志已做去噪，相同轮询状态不会持续刷屏

## 停止行为预期

点击“停止”后，当前版本的预期是：

1. sidepanel 先显示 `停止中...`
2. content script 停止继续采集
3. service worker 中断当前腾讯轮询
4. 当前 session 被清理
5. 按钮恢复为“开始”

如果停止后长时间不回到“开始”，优先怀疑扩展没有 reload 到最新构建。

## 常见故障对照表

| 现象 | 典型原因 | 优先检查 | 处理方式 |
|------|----------|----------|----------|
| `Unable to load a worklet's module.` | worklet 资源未被扩展正确加载 | 是否 reload 到最新 `dist` | 重新 build 并 reload 扩展 |
| `Could not establish connection. Receiving end does not exist.` | 页面里没有可用 content script | 标签页是否在扩展 reload 前打开 | 刷新页面，再次开始 |
| 只有 `transcribing`，没有 `转写:` | 腾讯任务没成功收口 | 是否有 `ASR 完成` 日志 | 看后续 `TaskId`、状态和错误 |
| `TIMEOUT_ERROR` | 轮询窗口内未拿到终态 | 日志里是否持续 `waiting/doing` | 看腾讯侧任务状态、音频长度和配额 |
| 日志里多次出现 `status=success` 却还报超时 | 客户端状态字段读取错误 | 扩展是否为最新构建 | reload 最新版本，本问题已修复 |
| 点击停止后一直卡在 `停止中...` | 当前 ASR 请求没被中断 | 扩展是否为最新构建 | reload 最新版本，本问题已修复 |
| `转写:` 出来了但没有图 | structurer 链路失败或仍在处理中 | 是否有 `状态: structuring`、`图更新` | 先用 `Structurer=mock` 收敛问题 |
| 提示无音轨或捕获失败 | 分享时未勾选标签页音频 | 分享目标是否是当前标签页 | 重新开始并勾选音频 |
| 腾讯有用量，但扩展没出字 | 任务已提交，但客户端未正确结束轮询或处理结果 | 看 `TaskId`、状态日志 | 先确认已 reload 最新扩展 |

## 快速判读规则

看到下面这些日志时，可以直接这样判断：

- 有 `任务已创建，TaskId=...`
  - 腾讯鉴权和创建任务阶段已通过
- 有 `状态=waiting` / `doing`
  - 说明已经进入腾讯异步轮询阶段
- 有 `ASR 完成`
  - ASR 已成功返回，后续应很快看到 `转写:`
- 有 `转写:`
  - ASR 已打通，后续问题不在 ASR
- 有 `图更新`
  - 整条主链路已走通

## 当前链路边界

当前 ListenGraph 的腾讯实现仍然是：

- 录音文件识别
- 文件/分片异步轮询
- 非实时 WebSocket

这意味着它适合验证：
- 采集是否成功
- 任务是否提交成功
- 转写是否能回到扩展

但不适合验证：
- 低延迟实时字幕体验
- 真正流式的边录边出字体验
