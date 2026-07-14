# Codex ListenGraph Session 筛选（≥ 2026-06-01）

仅 **Codex / Open Design**，不含 Cursor。已排除 5 月及更早记录；Codex CLI rollout 已剔除 AutoTSN 为主、仅顺带提及 ListenGraph 的会话。

> **5 月总规划（不在本表 cutoff 内）：** [01 项目总规划（5/30）](01-2026-05-30-project-roadmap-three-layers-planning.md)、[02 四层路线图跟进（5/31）](02-2026-05-31-semantic-graph-fixture-followup.md)

---

## 汇总

| 类别 | 数量 | 说明 |
|------|------|------|
| **6 月有实质内容** | **22** | 筛选基准（含已删 export 的条目） |
| **当前 export** | **11** | **01–11 按时间序**（见 [README.md](README.md)） |
| 已从 export 删除 | 19 | 旧编号 03–28 中已裁剪部分；05 为精简版 |
| OD design runs | 13 | pipeline 日志，非完整聊天 |

---

## 按三条工作线

### UI / 设计系统

| 日期 | ID / 文件 | 来源 | 状态 | 摘要 |
|------|-----------|------|------|------|
| 06-01 | `13eedefd` | OD SQLite | export 已删 | 设计文件路径 |
| 06-01 | `d1060ab6`, `e97ec68b` | OD Agent 旧 | export 已删 | 波形实验 |
| 06-22 | `15893956` | OD SQLite | **06** | 设计落地复盘 |
| 06-22 | `bedc90be` | OD Agent | **05** | `/baoyu-design 接下来应该做什么`（精简） |
| 06-22 | `360176f1` | OD Agent | **04** | `/baoyu-design 接手项目` |
| 06-22 | `56e83855` | OD Agent | export 已删 | 工作区清理 |
| 06-22 | subagent ×3 | OD Agent | export 已删 | UI 探索 |
| 06-23 | `019ef359` | Codex CLI | **07** | 设计系统产品裁决 |
| 06-25 | `019efcda` | Codex CLI | **10** | design-system-sync 规格与计划 |
| 06-22 | rollout ×4 | Codex CLI | 低价值 | Open Design `# Instructions` 设计任务，用户 turn 已被 compaction 吃掉 |

**Rollout 摘要（已复制）：** `2026-06-23` design_system、`2026-06-25` design_system_sync

---

### 结构化语义

| 日期 | ID / 文件 | 来源 | 状态 | 摘要 |
|------|-----------|------|------|------|
| 06-24 | `019ef857` | Codex CLI | **08** | semantic fixture 文本锚点校准 |
| 06-26 | `019f01f4` | Codex CLI | **11** | structurer acceptance 不应作为 universal 硬回归门 |

**Rollout 摘要：** `2026-06-24` semantic_fixture、`2026-06-26` semantic_eval_gate

---

### 业务逻辑 / 产品路线

| 日期 | ID / 文件 | 来源 | 状态 | 摘要 |
|------|-----------|------|------|------|
| 06-17 | `019ed5d8` | Codex CLI | **03** | 多端路线文档 + 桌面 V1 |
| 06-24 | `019ef8f0` | Codex CLI | **09** | 共享 ASR runtime 设计与计划 |

**Rollout 摘要：** `2026-06-17` multiplatform_roadmap、`2026-06-24` shared_asr_runtime

---

## 可跳过（6 月内但无内容）

| ID | 原因 |
|----|------|
| `03fd688a` | SQLite 空会话 |
| `a1c5df47`, `df2ecc2a`, `ee30044b` | Agent 启动失败（529/断连） |
| `cfc02762` | 仅 60KB，重复接手 + API 400 |
| `03c3ae9d` | 旧路径，仅 Instructions/hooks |

---

## Codex CLI rollout 源文件路径

```
C:\Users\finni\.codex\sessions\2026\06\17\rollout-2026-06-17T21-49-57-019ed5d8-827b-7921-a825-0daaac262b84.jsonl
C:\Users\finni\.codex\sessions\2026\06\23\rollout-2026-06-23T15-19-38-019ef359-3908-7870-9855-fb07a5c96a60.jsonl
C:\Users\finni\.codex\sessions\2026\06\24\rollout-2026-06-24T14-35-59-019ef857-a6ce-75f1-90f0-ec55e98e3881.jsonl
C:\Users\finni\.codex\sessions\2026\06\24\rollout-2026-06-24T17-22-52-019ef8f0-7e2b-7732-be4b-feb012f33cee.jsonl
C:\Users\finni\.codex\sessions\2026\06\25\rollout-2026-06-25T11-37-54-019efcda-f3be-7b60-912b-0fc0712e84bd.jsonl
C:\Users\finni\.codex\sessions\2026\06\26\rollout-2026-06-26T11-24-06-019f01f4-b10e-70f2-8e74-71704b16f270.jsonl
```

摘要副本：`codex-rollout-summaries/`（上述 6 条均有对应 `.md`）

---

## 仍未命中（6 月筛选范围内）

6 月 Codex 记录里没有「诉苦→拆三方向」原文；该 session 在 **5/30 Codex CLI**，见 [01](01-2026-05-30-project-roadmap-three-layers-planning.md)。
