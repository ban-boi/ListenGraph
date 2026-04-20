# 仓库指引

## 项目结构与模块组织

ListenGraph 是一个 `pnpm` + Turborepo 的 monorepo。主应用在 `apps/`：`web-demo/` 为 Vite React 演示；`extension/` 为 Chrome MV3 扩展，含 `src/service-worker/`、`src/sidepanel/`、`src/content-script/` 与 `e2e/`。共享包在 `packages/`：`schema` 核心类型，`domain` 合并/规范化/稳定性逻辑，`providers` ASR 与结构化器集成，`graph-renderers` 纯图谱布局与渲染辅助，`storage` Dexie 持久化，`shared-utils` 通用工具。当前实现说明见 `docs/`；`docs/plans/` 中带时间戳的文件仅作自动生成的参考，**不是**权威设计。

## 构建、测试与开发命令

除非另有说明，请在仓库根目录执行命令。

- `pnpm dev:web`：用 Vite 启动 web 演示。
- `pnpm dev:ext`：启动扩展开发构建。
- `pnpm build`：通过 Turbo 构建所有 workspace。
- `pnpm lint`：在整个仓库运行 ESLint。
- `pnpm typecheck`：在所有 workspace 运行 TypeScript 检查。
- `pnpm test:ext:contract`：扩展运行时契约测试。
- `pnpm test:ext:replay`：structure replay 与真实接口冒烟覆盖。
- `pnpm test:ext:e2e`：轻量扩展 Playwright 流程。

针对单个应用可使用筛选，例如 `pnpm --filter extension test:run` 或 `pnpm --filter web-demo test:e2e`。

## 代码风格与命名约定

使用 TypeScript，缩进 2 空格，并遵循 `.prettierrc` 中的 Prettier 默认：单引号、分号、尾随逗号。ESLint 使用 `@typescript-eslint`；提交前请跑 lint。React 组件优先 `PascalCase`，函数与变量优先 `camelCase`，文件名宜具描述性，如 `provider-registry.test.ts`、`openai-structurer.ts`。`packages/graph-renderers` 中的图谱渲染逻辑应保持为纯逻辑，避免混入 React 组件关注点。

## 测试指引

单元与集成测试使用 Vitest，文件命名为 `*.test.ts`；Playwright 在 `apps/*/e2e` 覆盖端到端流程。修改扩展时遵循本仓库三层策略：**先契约、再 replay、最后轻量 E2E**。示例顺序：`pnpm test:ext:contract`，再 `pnpm test:ext:replay`，若用户流程有变更再 `pnpm test:ext:e2e`。

## 提交与 Pull Request 指引

近期历史使用 Conventional Commit 前缀，例如 `feat(extension): ...`、`fix(domain,providers): ...`、`test(extension): ...`、`docs: ...`。保持 scope 准确、subject 简洁。PR 应说明受影响的应用/包、概括已做测试、必要时关联 issue；涉及侧栏或 UI 变更时请附截图或录屏。

## 面向 Agent 的说明

优先查阅 `docs/README.md` 与 `docs/testing/README.md` 了解当前行为与测试入口。不要将 `docs/plans/2026-*.md` 这类文件当作唯一事实来源。

## 文档来源备注

- `docs/plans/` 下以日期时间戳开头的文档（如 `2026-03-20-*.md`）为 **Cursor 的 plan 模式自动生成**，非人工撰写，仅供参考，不应视为项目决策或当前实现的权威来源。
