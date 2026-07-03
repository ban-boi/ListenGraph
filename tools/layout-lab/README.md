# 第 1 轮布局实验台（诊断集）

> 对 62 条真实会话图做可读性诊断，产出路线校准表。**不是产品功能，不进 live 链路。**
> 设计文档：`docs/superpowers/specs/2026-07-03-layout-lab-round1-design.md`
> 实现计划：`docs/superpowers/plans/2026-07-03-layout-lab-round1.md`

## 一次性准备

```bash
# 1. 复制真实图 dump（不进 git，含真实对话）
cp ~/Downloads/real-graphs-dump.json tools/layout-lab/inputs/real-graphs-dump.json

# 2. 安装 lab 依赖（lab 独立于 monorepo）
cd tools/layout-lab/run && npm install

# 3. 创建 node_modules junction（让 src/ 的 runtime bare import 解析）
#    Windows（PowerShell，需管理员或开发者模式）：
cd tools/layout-lab && cmd /c mklink /J node_modules run\node_modules
#    或 Unix：ln -s run/node_modules node_modules

# 4. 构建 fixture-lab 版扩展（spec 4.7 跨平台）
pnpm --filter extension build:fixture-lab

# 5. 配置 LLM（PowerShell）—— 跑 annotate 阶段才需要
$env:LAYOUT_LAB_LLM_API_KEY='sk-...'
$env:LAYOUT_LAB_LLM_MODEL='gpt-4o'   # 可选，默认 gpt-4o
```

## 跑全流程

```bash
cd tools/layout-lab && npx tsx run/run-all.mjs
```

或分阶段（每阶段独立可重跑）：

```bash
cd tools/layout-lab/run
npx tsx ../src/export-snapshot.ts        # 1. 算指标（纯函数，秒级）
npx tsx ../src/capture-screenshots.ts    # 2. 截图（需先 build:fixture-lab，~3 分钟）
npx tsx ../src/llm-annotate.ts           # 3. LLM 草标（需 API key，断点续跑）
npx tsx ../src/render-gallery.ts         # 4. 拼 HTML + 抽样（秒级）
```

单条重截（失败重跑）：`npx tsx ../src/capture-screenshots.ts --only=5`

纯文本标注（无多模态 API 时降级）：`npx tsx ../src/llm-annotate.ts --no-screenshot`

> **⚠️ 注意**：`build:fixture-lab` 会覆盖 `apps/extension/dist/`（与 prod build 共用输出目录）。
> 跑完 capture 后，若要恢复 prod 测试（`fixture-build.prod.test.ts` 会检查 dist 不含 `__listenGraphicFixture`），
> 需重新执行 `pnpm --filter extension build` 把 dist 恢复成 prod 版本。

## 人工审核

1. 打开 `outputs/gallery.html`，**全量扫 62 张缩略图**（5-10 分钟，catching 系统性偏差）
2. 按 `outputs/review-sample.json` 列出的样本**详细校正**（annotation 跑完后通常 15-25 条；未跑时全 62 条）
3. 校正后写回 `outputs/calibrated-diagnosis.json`
4. 汇总成 `outputs/diagnosis-table.md`（路线校准表）

## 数据安全

- `inputs/`、`outputs/`、`.tmp/`、`node_modules` 已 gitignore（含真实用户对话）
- dump 来源：扩展 IndexedDB `mergedGraphs` 表导出

## 阶段说明

| 阶段 | 输入 | 输出 | 耗时 |
|---|---|---|---|
| export | dump JSON | `outputs/metrics/*.json` + `outputs/simplified/*.json` | 秒级 |
| capture | dump + 扩展 dist | `outputs/screenshots/*.png` | ~3 分钟 |
| annotate | metrics + simplified + screenshots | `outputs/annotations/*.json` | 取决于 API |
| gallery | 全部 | `outputs/gallery.html` + `outputs/review-sample.json` | 秒级 |

## 第二轮方向

**等诊断表出来再决定**，不预设。可能方向：opposition 收紧门槛 / 大图 cluster / 主线强调 / evidence stack。
