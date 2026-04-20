# CLAUDE.md

本文件为 Claude Code（[claude.ai/code](https://claude.ai/code)）在本仓库中协作时的说明。

---

## 项目概述（Project Overview）

**ListenGraphic**（npm 包名：`listen-graphic`）是一个基于 React Flow 的对话可视化工具，用于将实时语音转写文本转化为结构化知识图谱。项目采用 **pnpm monorepo**（pnpm@10 + turbo@2），包含 **Web Demo** 与 **Chrome Extension** 两个应用。

---

## 常用命令（Common Commands）

### 根目录

| 场景 | 命令 |
|------|------|
| 启动 web-demo | `pnpm dev:web` → <http://localhost:5173> |
| 启动 extension 开发服务器 | `pnpm dev:ext` |
| 构建全部 | `pnpm build` |
| ESLint | `pnpm lint` |
| TypeScript 检查 | `pnpm typecheck` |

### 根目录 · 扩展相关测试

| 命令 | 说明 |
|------|------|
| `pnpm test:ext:contract` | 扩展 service-worker 契约测试 |
| `pnpm test:ext:replay` | 扩展 structure replay 测试 |
| `pnpm test:ext:e2e` | 扩展 E2E 本地测试 |
| `pnpm test:ext:e2e:closure` | 扩展 E2E 闭合测试 |

### `apps/extension/` 目录下

| 命令 | 说明 |
|------|------|
| `pnpm test` | Vitest（watch） |
| `pnpm test:run` | 单元测试并退出 |
| `pnpm test:contract` | service-worker 契约测试 |
| `pnpm test:structure` | structure mock + real smoke |
| `pnpm test:structure:stable` | mock + real smoke + replay strict |
| `pnpm test:structure:full` | mock + real full |
| `pnpm test:asr:real` | 真实 ASR 实时测试 |
| `pnpm test:asr:compare` | ASR 传输层对比 |
| `pnpm test:e2e` | E2E 本地 mock |
| `pnpm test:e2e:real` | E2E 真实 provider |
| `pnpm test:e2e:closure` | E2E 闭合 |
| `pnpm test:e2e:full` | 全部 E2E |
| `pnpm build` | 构建到 `dist/`（供 Chrome 加载） |

### Fixture

| 命令 | 说明 |
|------|------|
| `pnpm prepare:asr:real` | 准备 ASR 实时测试 fixture |
| `pnpm prepare:structure:replay` | 准备 structure replay fixture |

---

## 代码架构（Code Architecture）

### Monorepo 结构

```text
apps/
├── web-demo/          # React Web 演示应用
└── extension/         # Chrome MV3 扩展
    ├── sidepanel/     # 侧边栏 UI（React + ReactFlow + zustand）
    ├── offscreen/     # 保留/实验路径，非当前主链路宿主
    ├── service-worker/# 后台：会话、ASR 调度、structure、导出等
    └── content-script/# 当前音频捕获入口

packages/
├── schema/            # 核心 TypeScript 类型
├── domain/            # 合并、规范化、稳定性、视图选择
├── providers/         # ASR / Structurer 提供者
│                      #   ASR: mock / openai / tencent（含实时 WebSocket）
│                      #   Structurer: mock / openai / zhipu / baidu / aliyun
│                      #   registry、config、http/retry 等
├── graph-renderers/   # React Flow 视图渲染器（纯函数，无 React 组件）
├── storage/           # IndexedDB（Dexie）
├── ui/                # UI 组件（当前多为 placeholder）
└── shared-utils/      # 共享工具
```

### 核心数据类型

定义位置：`packages/schema/src/`

| 类型 | 说明 |
|------|------|
| `SegmentGraph` | 单片段图谱（ASR + 结构化） |
| `MergedGraph` | 合并后会话图谱；含 `topics`、`viewHints`（默认视图与评分） |
| `GraphNode` | 节点：`claim` / `reason` / `example` / `question` / `conclusion`；含 `status`（draft/confirmed）、`topicId`、`evidenceChunkIds` |
| `GraphEdge` | 边：`supports` / `opposes` / `causes` / `follows` / `example_of`；含 `confidence`、`evidenceChunkIds` |
| `TranscriptChunk` | 原始转写块；含 `tokens`、`speakerHints` |
| `TranscriptToken` | 逐词：`text`、`startMs`、`endMs`、`speaker`、`confidence` |
| `ViewType` | `timeline` / `causal` / `comparison` / `flow` / `hierarchy` |
| `ProviderConfig` | ASR + Structurer 配置；支持 `direct` / `relay` |

### 数据流

```text
TranscriptChunk (ASR)
        ↓
SegmentGraph (Structurer Provider)
        ↓
mergeSegmentGraph() + stabilizeGraph() + normalizeGraph()  (domain/)
        ↓
MergedGraph
        ↓
Graph Renderer (graph-renderers/*)
        ↓
React Flow 可视化
```

### Chrome Extension 架构

| 部分 | 路径 / 说明 |
|------|-------------|
| Service Worker | `service-worker/index.ts`：会话生命周期、ASR、structure、合并、持久化、导出（JSON / Markdown / Mermaid） |
| | `tencent-realtime.ts`：腾讯实时 ASR WebSocket |
| | `export-formatters.ts`：会话导出格式 |
| SidePanel | `sidepanel/App.tsx`：React + ReactFlow + **zustand** |
| Content Script | `getDisplayMedia` + **AudioWorklet** 音频捕获 |
| Offscreen | 仓库内保留，非 production 主链路 |
| 共享模块 | `messages.ts`（流式 ASR、导出、debug/replay 等） |
| | `audio.ts`、`build-info.ts` |
| | `orchestrator.ts`：实验路径，当前未启用 |

**SessionState**：`idle` → `capturing` → `transcribing` → `structuring` → `stopped` / `error`

**流式 ASR 消息**：`ASR_STREAM_UTTERANCE_READY`、`ASR_STREAM_PARTIAL_UPDATED`、`ASR_STREAM_STATUS`、`ASR_STREAM_ERROR`

### 图谱渲染器（`graph-renderers`）

| 视图 | 侧重关系 |
|------|-----------|
| `causal` | `causes`、`supports` |
| `timeline` | `follows` |
| `comparison` | `opposes` |
| `flow` | `follows`、`causes` |
| `hierarchy` | `example_of`、`supports` |

视图自动选择：`domain/view-selection.ts`（评分算法）。

### Domain 包要点

| 文件 | 职责 |
|------|------|
| `merge.ts` | 片段图谱合并 |
| `normalize.ts` | 规范化 |
| `stabilize.ts` | 稳定性处理 |
| `view-selection.ts` | 视图类型评分与选择 |

### 存储层（`packages/storage/`）

使用 **Dexie**（IndexedDB），当前 **DB version 2**：

| Store | 内容 |
|-------|------|
| `sessions` | 元数据：`sessionId`、`sourceType`、`createdAt`、`endedAt`、`title` |
| `transcriptChunks` | 原始转写 |
| `segmentGraphs` | 片段图谱 |
| `mergedGraphs` | 合并图谱 |
| `settings` | 键值配置（含 provider config） |

`repositories.ts`：`SessionRepository`、`TranscriptChunkRepository`、`SegmentGraphRepository`、`MergedGraphRepository`、`SettingsRepository`。

### 路径别名

跨包导入通过 TypeScript paths，无需先构建各包：

```ts
import { GraphNode } from '@listen-graphic/schema';
import { mergeSegmentGraph } from '@listen-graphic/domain';
```

---

## 测试

### 单元测试

- 栈：**Vitest** + **jsdom** + **Testing Library**
- 文件：`*.test.ts` 或 `*.spec.ts`
- 全局 setup：`apps/*/src/test/setup.ts`

### E2E（Playwright）

- 目录：`apps/extension/e2e/`
- Spec：
  - `extension.local.spec.ts` — 本地 mock
  - `extension.real.spec.ts` — 真实 provider
  - `extension.closure.spec.ts` — 闭合验证
- 配置：`apps/*/playwright.config.ts`（运行时会拉起 dev server）

### 扩展专项

| 类型 | 说明 |
|------|------|
| 契约测试（`test:contract`） | service-worker 消息契约 |
| Structure | mock + 真实 API smoke + replay strict |
| ASR 实时 | 真实 provider 连接与转写 |
| Provider 恢复 | 错误恢复与重试 |

---

## 开发注意事项

1. **依赖**：工作区包使用 `workspace:*`，由 pnpm 链接。
2. **运行时校验**：主要在 `schema` 包用 **Zod**。
3. **React Flow**：渲染器在 `graph-renderers` 中为纯函数，不含 React 组件。
4. **扩展重载**：改扩展代码后需在 `chrome://extensions` 中重新加载。
5. **AudioWorklet**：主音频链路在 content script；offscreen 仍为保留路径。
6. **Provider**：产品面主要暴露 **direct**；**relay** 仅在 schema/provider 合约层保留。
7. **状态**：Extension 侧栏用 **zustand v5**。
8. **工具链**：pnpm@10、turbo@2、vitest、playwright、vite@5。
9. **docs/plans 时间戳文档**：`docs/plans/` 下以日期时间戳开头的文件是 Cursor 的 plan 模式自动生成的，非人工编写，仅作参考。
