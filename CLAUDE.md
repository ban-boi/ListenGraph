# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述 (Project Overview)

ListenGraphic 是一个基于 React Flow 的对话可视化工具，用于将实时语音转写文本转化为结构化的知识图谱。项目采用 pnpm monorepo 架构，包含 Web Demo 和 Chrome Extension 两个应用。

## 常用命令 (Common Commands)

```bash
# 开发服务器
pnpm dev:web      # 启动 web-demo (http://localhost:5173)
pnpm dev:ext      # 启动 extension 开发服务器

# 构建
pnpm build        # 构建所有包和应用
pnpm lint         # 对所有包运行 ESLint
pnpm typecheck    # 对所有包运行 TypeScript 类型检查

# 单个包操作（在各包目录下）
pnpm test         # 运行单元测试 (Vitest)
pnpm test:run     # 运行测试并退出
pnpm test:e2e     # 运行 E2E 测试 (Playwright)
pnpm test:e2e:ui  # 运行 E2E 测试（带 UI）
pnpm test:e2e:headed  # 运行 E2E 测试（有头模式）

# 扩展构建
cd apps/extension
pnpm build        # 构建扩展到 dist/ 目录（用于加载到 Chrome）
```

## 代码架构 (Code Architecture)

### Monorepo 结构

```
apps/
├── web-demo/         # React Web 演示应用
└── extension/        # Chrome MV3 扩展
    ├── sidepanel/    # 侧边栏 UI
    ├── offscreen/    # 保留/实验路径，不是当前主链路宿主
    ├── service-worker/  # 后台服务
    └── content-script/  # 当前音频捕获入口

packages/
├── schema/           # 核心 TypeScript 类型定义
├── domain/           # 业务逻辑（合并、规范化、视图选择）
├── providers/        # ASR 和结构化提供者接口（含 Mock 实现）
├── graph-renderers/  # React Flow 视图渲染器
├── storage/          # IndexedDB 持久化 (Dexie)
├── ui/              # UI 组件
└── shared-utils/    # 共享工具函数
```

### 核心数据类型

在 `packages/schema/src/` 中定义：

- **SegmentGraph**: 单个音频片段的图谱（由 ASR + 结构化生成）
- **MergedGraph**: 合并后的完整会话图谱
- **GraphNode**: 图节点（claim, reason, example, question, conclusion）
- **GraphEdge**: 图边（supports, opposes, causes, follows, example_of）
- **TranscriptChunk**: 原始转写文本块

### 数据流

```
TranscriptChunk (ASR)
       ↓
SegmentGraph (Structurer Provider)
       ↓
mergeSegmentGraph() (domain/merge.ts)
       ↓
MergedGraph
       ↓
Graph Renderer (graph-renderers/*)
       ↓
React Flow Visualization
```

### Chrome Extension 架构

- **Service Worker**: 后台服务，处理扩展生命周期
- **SidePanel**: 主 UI，使用 React + ReactFlow
- **Content Script**: 当前通过 `getDisplayMedia + AudioWorklet` 处理音频捕获
- **Offscreen Document**: 保留在仓库中，但不是当前 production mainline
- **Message Types**: 定义在 `apps/extension/src/shared/messages.ts`

### 图谱渲染器

`graph-renderers` 包提供了 5 种视图类型：

- **causal**: 因果关系图（causes, supports）
- **timeline**: 时间线视图（follows）
- **comparison**: 对比视图（opposes）
- **flow**: 流程图（follows, causes）
- **hierarchy**: 层级图（example_of, supports）

视图选择逻辑在 `domain/view-selection.ts` 中通过评分算法自动决定。

### 存储层

使用 Dexie (IndexedDB ORM) 在 `packages/storage/` 中：
- `sessions`: 会话元数据
- `transcriptChunks`: 原始转写
- `segmentGraphs`: 片段图谱
- `mergedGraphs`: 合并图谱

### 路径别名

所有包都通过 TypeScript paths 解析，无需构建即可跨包导入：
```typescript
import { GraphNode } from '@listen-graphic/schema';
import { mergeSegmentGraph } from '@listen-graphic/domain';
```

## 测试

### 单元测试
- 使用 Vitest + jsdom + Testing Library
- 测试文件: `*.test.ts` 或 `*.spec.ts`
- Mock 配置: `apps/*/src/test/setup.ts`

### E2E 测试
- 使用 Playwright
- 测试目录: `apps/*/e2e/`
- 配置文件: `apps/*/playwright.config.ts`
- 运行时自动启动开发服务器

## 开发注意事项

1. **包依赖**: 所有包都是 `workspace:*` 依赖，通过 pnpm 自动链接
2. **类型安全**: 使用 Zod 进行运行时验证（主要在 schema 包中）
3. **React Flow**: 所有视图渲染器基于 `reactflow` 库
4. **扩展开发**: 修改扩展代码后，需要在 `chrome://extensions` 中重新加载
5. **AudioWorklet**: 当前音频处理链路位于 content script；`offscreen` 仍是保留路径
6. **Provider 设置**: 当前产品面只暴露 `direct` 直连配置；`relay` 仅保留在底层 schema/provider 合约中
