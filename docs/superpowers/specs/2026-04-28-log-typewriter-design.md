# 日志框逐句打字机式显示

**日期**: 2026-04-28
**状态**: 已确认

---

## 背景

当前日志框中 ASR 中间结果的显示机制：所有 partial 更新共享一个 `transientKey: 'tencent-realtime-partial'`，导致永远只有一行在替换刷新。用户期望改为**逐句打字机式**——每句话一行，实时逐字出现，说完固定。

## 当前行为

1. slice_type=0（新句子）→ 一条 transient 行 `⏳ 腾讯实时 ASR 开始:`
2. slice_type=1（中间结果）→ 同一行被替换为 `⏳ 腾讯实时 ASR 中间结果: 今天...`
3. slice_type=2（句子结束）→ transient 行被**删除**，新增永久行 `✅ 转写: 完整文本`

**问题**：所有句子共享同一个 transient 行，无法同时看到多句历史。

## 目标行为

```
[ASR] ⏳ 腾讯实时 ASR: 今天的天气好_        ← 第1句正在打字

（第1句结束后）
[ASR] ✅ 转写: 今天的天气很好 | 10:30-10:35
[ASR] ⏳ 腾讯实时 ASR: 接下来讨论_         ← 第2句开始打字
```

- 每句话独占一行，有独立的 transientKey
- 打字中显示 `⏳`，结束后转为 `✅`
- 保留 ASR stage badge 和前缀

## 改动范围

**只改 `apps/extension/src/sidepanel/App.tsx`**，不涉及 service-worker、messages.ts 或 content-script。

### 1. 新增 utterance 追踪

```typescript
const asrUtteranceIndexRef = useRef(0);
```

### 2. 修改 PROVIDER_PROGRESS 处理逻辑

当收到 ASR 进度消息时：

- 检测到 "开始"（slice_type=0 触发的消息）→ `asrUtteranceIndexRef.current++`
- 检测到 "中间结果"（slice_type=1）→ 不递增，沿用当前 index
- 使用 `transientKey: 'asr-utterance-${index}'` 创建/更新 timeline event

```typescript
// 伪代码
if (/^腾讯实时 ASR 开始(:|$)/.test(progressMessage)) {
  asrUtteranceIndexRef.current++;
}
const key = `asr-utterance-${asrUtteranceIndexRef.current}`;
```

### 3. 修改 TRANSCRIPT_READY 处理逻辑

收到最终结果时，将当前 utterance 的 transient 行**就地转换**为永久行：

```typescript
function finalizeTransient(
  events: TimelineEvent[],
  transientKey: string,
  updates: Partial<TimelineEvent>,
): TimelineEvent[] {
  return events.map(e =>
    e.transientKey === transientKey
      ? { ...e, ...updates, transientKey: undefined }
      : e,
  );
}
```

- 不再 `clearTimelineTransient` + 新增行
- 改为 `finalizeTransient` 原地更新：去掉 transientKey，改 message 为 `转写: 完整文本`，tone 改为 `success`

### 4. 清理旧的正则匹配

当前匹配逻辑返回固定 key `'tencent-realtime-partial'`，改为根据 utterance index 返回不同 key。旧的 `clearTimelineTransient('tencent-realtime-partial')` 调用替换为 `finalizeTransient`。

## 不改动的部分

| 文件 | 原因 |
|------|------|
| `service-worker/index.ts` | `handleAsrStreamPartial` 已区分 "开始"/"中间结果"，无需改动 |
| `messages.ts` | 消息类型不变 |
| `content-script` | ASR 消息解析逻辑不变 |
| 日志区 UI 组件 | 渲染逻辑不变，仅数据源变化 |

## 边界情况

- **TRANSCRIPT_READY 无对应 transient**：直接新增永久行（兜底，与当前行为一致）
- **连续多个 slice_type=0**：每次都递增 index，各自独立追踪
- **会话重置**：`asrUtteranceIndexRef` 随组件重新创建，自动归零
