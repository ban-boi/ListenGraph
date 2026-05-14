# Assembler Decision Log 独立导出

**日期**: 2026-05-14
**状态**: 待审批

---

## 背景

Assembler 的决策数据（每次 ASR 话语进来后 assembler 做了什么判断）目前嵌入在 `debug-full.json` 中，与 transcripts、segments、traces 等大量无关数据混在一起，文件体积大、查找困难。用户需要一个紧凑的、只包含 assembler 决策链的复盘文件。

## 目标

在 DebugPanel 新增一个按钮，点击后导出一个独立的紧凑 JSON 文件，只包含 assembler 决策记录和提交的 structure unit，用于会后复盘 assembler 的运行效果。

## 输出格式

### JSON 结构

```json
{
  "schemaVersion": 1,
  "meta": {
    "exportedAt": "2026-05-14T20:00:00.000Z",
    "sessionId": "session_xxx",
    "traceSource": "memory"
  },
  "summary": {
    "totalRuns": 30,
    "decisions": { "skip_current": 3, "wait": 12, "commit": 15 },
    "totalUnits": 22,
    "commitReasons": { "commit_rule": 8, "commit_score": 4, "commit_timeout": 2, "merge_with_prev": 1 }
  },
  "runs": [
    {
      "seq": 1,
      "triggerText": "今天我们请到了",
      "decision": "wait",
      "reason": "等待 30 秒上下文或足够长的稳定话语 (2条/45字)",
      "score": null
    },
    {
      "seq": 15,
      "triggerText": "所以我觉得AI的这个方向是对的。",
      "decision": "commit",
      "reason": "commit_rule",
      "score": 4
    }
  ],
  "units": [
    {
      "text": "因为自动驾驶这件事\n所以我觉得AI的这个方向是对的。",
      "reason": "commit_rule"
    }
  ]
}
```

### Run 字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `seq` | number | 决策序号（对应当前 transcriptSequence） |
| `triggerText` | string | 触发本次决策的转写文本 |
| `decision` | `'skip_current' \| 'wait' \| 'commit'` | 决策类型 |
| `reason` | string | 决策原因（硬规则名称或人类可读描述） |
| `score` | number \| null | 软评分得分（硬规则命中时为 null） |

### Unit 字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `text` | string | 合并后提交给 structurer 的文本 |
| `reason` | string | 提交原因 |

## 交互流程

1. 用户在 DebugPanel 点击「导出 Assembler 日志」按钮
2. SidePanel 发送 `EXPORT_ASSEMBLER_LOG` 消息给 Service Worker
3. Service Worker 从 `S.assemblerRuns[]` 和 `S.structureUnits[]` 读取内存数据；若内存为空，降级从 IndexedDB `assemblerTraces` store 读取（复用现有 `getAssemblerTraceForSession()` 链路）
4. Service Worker 将 `AssemblerRunDebug[]` 和 `StructureUnitDebug[]` 转换为精简格式，附加 summary 统计
5. 返回给 SidePanel
6. SidePanel 调用 `downloadTextFile()` 下载为 `assembler-log-{sessionId}.json`

## UI 变更

在 `DebugPanel.tsx` 现有的 Debug Slim / Debug Full 按钮下方新增一个按钮：

- 文本：「导出 Assembler 日志」
- 样式：与现有 debug 按钮一致
- 位置：Debug Full 按钮之后
- 禁用条件：`sessionState === 'idle'` 或无 assembler 数据时

## 消息契约

新增消息类型（`messages.ts`）：

```typescript
// SidePanel → SW
{ type: 'EXPORT_ASSEMBLER_LOG' }

// SW → SidePanel (response)
{
  type: 'EXPORT_ASSEMBLER_LOG_RESULT',
  payload: {
    success: boolean,
    data?: AssemblerDecisionLogExport,  // 精简格式的完整 JSON
    error?: string
  }
}
```

## 数据转换

### AssemblerRunDebug 扩展

当前 `AssemblerRunDebug` 存储了 `latestTranscriptId` 但**不包含转写文本**。为支持 `triggerText` 输出，需在 `recordAssemblerRunDebug()` 中新增字段：

```typescript
// messages.ts — AssemblerRunDebug 新增字段
latestTranscriptText: string;  // 触发本次决策的转写文本
```

此字段在 `assembler-machine.ts` 的 `recordAssemblerRunDebug()` 中从 `params.transcript.text` 直接填充。对 chrome.storage.session 和 IndexedDB 的序列化无影响（自动透传）。

### buildAssemblerLogPayload()

新增函数（位于 `debug-export-utils.ts` 或新文件），负责：

1. 接收 `AssemblerRunDebug[]` 和 `StructureUnitDebug[]`
2. 过滤当前 sessionId 的记录
3. 将 `AssemblerRunDebug` 转换为精简 run 格式：
   - `seq` ← `sequence`
   - `triggerText` ← `latestTranscriptText`
   - `decision` ← `decision`
   - `reason` ← `reason`
   - `score` ← `score`（硬规则命中时为 null）
4. 将 `StructureUnitDebug` 转换为精简 unit 格式：
   - `text` ← `text`
   - `reason` ← `reason`
5. 计算 summary 统计

## 不变更的部分

- **IndexedDB 持久化**：保留现有 `persistAssemblerTrace()` / `loadAssemblerTrace()` 和 `assemblerTraces` store，作为 SW 重启后的保底恢复机制
- **现有 debug export**：Debug Slim / Full 按钮的行为不变
- **assembler-machine.ts**：`recordAssemblerRunDebug()` / `recordStructureUnitDebug()` 不变
- **chrome.storage.session**：现有截断持久化不变

## 文件变更清单

| 文件 | 变更 |
|------|------|
| `shared/messages.ts` | 新增 `EXPORT_ASSEMBLER_LOG` / `EXPORT_ASSEMBLER_LOG_RESULT` 消息类型 + `AssemblerDecisionLogExport` 接口；`AssemblerRunDebug` 新增 `latestTranscriptText` 字段 |
| `service-worker/assembler-machine.ts` | `recordAssemblerRunDebug()` 填充 `latestTranscriptText` |
| `service-worker/session-handlers.ts` | 新增 `handleExportAssemblerLog()` 处理函数 |
| `sidepanel/debug-export-utils.ts` | 新增 `buildAssemblerLogPayload()` 转换函数 |
| `sidepanel/DebugPanel.tsx` | 新增「导出 Assembler 日志」按钮 |
| `sidepanel/App.tsx` | 新增 `handleExportAssemblerLog` 回调，连接按钮与消息发送 |
