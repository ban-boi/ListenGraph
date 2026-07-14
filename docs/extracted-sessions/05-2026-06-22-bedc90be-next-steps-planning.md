# Codex Agent Session: bedc90be — 接下来应该做什么（精简版）

- **Label**: 05-2026-06-22-bedc90be-next-steps-planning
- **Session date**: 2026-06-22
- **Source**: `C:\Users\finni\.claude\projects\C--Users-finni-AppData-Roaming-Open-Design-namespaces-release-stable-win-data-projects-c050dc4d-9dbf-4482-9304-6b55a503ce58\bedc90be-a7ef-4b80-ba69-ca4b67f0cd91.jsonl`
- **原 session**: 249 turns → **本文件保留开场、关键结论与收尾建议**
- **工作线**: UI / 设计系统

> 过程细节（四端 Playwright 体检、PHILOSOPHY 逐行修订、GateGuard 等）已删。完整 transcript 见源 JSONL。

---

## [1] USER 2026-06-22 15:41:52

/baoyu-design 接下来应该做什么  针对这个项目

---

## 初始诊断（2026-06-22）

**核心发现：波形动画 v2.3 方案四端实测全部正常**，推翻此前「还是没动起来」的印象——根因是浏览器缓存旧 Babel 编译 + Dark Reader 扩展扭曲颜色，不是代码 bug。

**真问题：**
1. **P0 波形** — 设计签名特性，需有「实测能稳定流动」的实据（本次已补齐）
2. **文档债** — `PHILOSOPHY.md` 仍写 mask+transform，代码已是 background-position v2.3，会误导接手者

**四端体检结论（摘要）**

| 验证项 | 结果 |
|--------|------|
| Extension / Desktop Web / Android 横竖波 | ✅ running 流动，done/waiting 静止，error 虚线+danger |
| v2.2 owner 色、无背景色块 | ✅ |
| 桌面 Web 不再无限长 | ✅ `.lg-window` 640px + overflow |

**首轮收尾：** 同步 PHILOSOPHY + 7 处 mask 过时注释，文档与代码对齐。项目状态：**健康**，波形签名特性可用。

---

## 「下一步做什么」专业建议（2026-06-23）

用户确认场景为 **工程落地**（非演示分享）。

**推荐：在 `PHILOSOPHY.md` 补一章「工程落地契约」**

理由：
1. 现有 PHILOSOPHY 是设计师视角，缺开发者视角（props、状态枚举、token 清单、验收标准）
2. 四端实测的 computed-style 断言可固化为回归清单（防退化）
3. 单一权威文档，接手者一处读完哲学→规则→落地→验收

**该章应含：** 组件 API 契约、四态状态机映射、Token 清单、回归验收断言、原型 class ↔ `packages/ui` 映射。

---

## 三段 Pipeline detail 产品裁决（2026-06-24）

**职责一句话：** ASR 刚听到了什么？ · Structurer 处理多慢、堵不堵？ · Graph 刚生成了什么？

| 段 | detail 示例 | 规则 |
|----|-------------|------|
| **ASR** | `…真正困难的是如何定义理解` | 最新转写尾部；左对齐+渐隐；partial 淡色；不循环跑马灯 |
| **Structurer** | `2.4s · 排队 3` | 不写「当前状态」（波形已表达）；接 `structuringSince` / `pendingTranscriptCount` |
| **Graph** | `新增 3 节点 · 2 关系` | 本轮产出，非累计 n/e；生成+导览期间波浪动，稳定后静止 |

**Graph 与导览合二为一：** 名称仍叫 Graph，扩展为「图谱生成与呈现阶段」。一行文案按阶段切换，优先级：错误 > 生成 > 导览 > 暂停 > 空闲。导览期间用 `导览 1/3 · 新增 3 节点` 重叠态，导览结束后回显完整产出 3–5 秒，再沉降为 `图谱已稳定`。不堆叠 `新增 3n · 2e · 导览 1/3`。

**设置面板：** 清除密钥改为可选 DangerZone，按钮语义改为「清除全部凭据」（原按钮实际重置整个配置，名称误导）。

**已落原型：** DEFAULT_PIPELINE、PipelineModule `data-owner`、PHILOSOPHY §1 detail 规范 + Graph 多态时序。动态状态机留给生产实现。

---

## 反哺生产怎么做（2026-06-25）

| 原型改动 | 生产反哺 |
|----------|----------|
| PipelineModule 去 status | 改生产 PipelineModule |
| detail 三段语义 | 改 status-cards / panel-reducer |
| Graph 多态 + `lastGraphDelta` | 抽状态机 |
| SecretField 眼睛、DangerZone | 进 packages/ui |
| SessionList / DiagnosticsDrawer | 新建共享组件 |
| 原子件从 extension 私有抽出 | Button/Input/Select/SecretField 等 |

**三步：** ① 组件进 `packages/ui`（TSX + 类型）→ ② 三端切换 import、删私有重复 → ③ 契约写进 types/docs。

**建议起点（最小风险）：** 先把 FormControls 等原子件抽进 `packages/ui`，顺带 SecretField 眼睛 + DangerZone。之后：PipelineModule 去 status → SessionList → DiagnosticsDrawer → Graph 多态。

**工程注意：** 大改动开 worktree（`feat/design-system-sync`）；先在 extension 验证再推 desktop/web-demo；每改一组件跑 Vitest/Playwright。

---

## 设计系统搬迁（2026-06-25）

**只挪 `designs/listen-graph-signal-v2/`**，不要带整个 Open Design 项目根（含 artifact、旧草稿、Playwright 截图等）。

已复制到 `C:\Users\finni\Desktop\listen-graph-design-system` 并 `git init` 首次提交。后续在新目录开新 session 继续反哺；原型路径与生产路径：

- 原型：`C:\Users\finni\Desktop\listen-graph-design-system`
- 生产：`C:\Users\finni\Desktop\ListenGraph`

---

## Session 收尾注意事项（2026-06-25）

1. **Babel `...rest` 坑仅原型** — 生产 TS 构建可正常 spread，别照搬 Button 白名单 hack
2. **波形别搬实现** — 生产已是 SVG path + ResizeObserver；只同步契约（波长 40、振幅 7、四态三色、流动规则）
3. **detail 接真实 state** — 非 DEFAULT_PIPELINE mock；Graph 多态是状态机不是文案轮播
4. **改造不是新建** — `packages/ui` 已有同名组件，对齐后删 extension 私有重复
5. **三端先在 extension 验证**
6. **新 session 先读 PHILOSOPHY.md + 摸 `packages/ui/src/` 再动手**
