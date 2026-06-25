# Pipeline 可视化契约

本文档是生产实现的当前契约。原型可用于追踪设计来源，但生产实现以这里和代码测试为准。

## 布局

- `< 400px`: 单列竖排，横向波浪。
- `400px - 599px`: ASR / Structurer 顶行，Graph 单独一行。
- `>= 600px`: 三段并排，竖向波浪。

## 模块

每个模块只显示 dot、label、detail。不要在 label 旁边再显示 status 文本。

- ASR detail 回答“刚听到什么”。
- Structurer detail 回答“当前处理压力如何”。
- Graph detail 回答“图谱现在产出了什么”。

## Graph 状态优先级

1. Structurer 错误：`保留旧图 · 待处理 N`
2. 新增落地，`nowMs - lastGraphDelta.at <= 1000`: `新增 N 节点 · M 关系`
3. 自动导览中：`导览 current/total`
4. 导览暂停：`导览暂停 current/total`
5. 空图：`等待图谱数据`
6. 最近回显，`nowMs - lastGraphUpdatedAt <= 5000`: `回显 N 节点 · M 关系`
7. 稳定：`图谱已稳定 · N 节点 · M 关系`

空图检查在回显/稳定之前：空图时回显/稳定会产出"图谱已稳定 · 0 节点 · 0 关系"的误导文案，故空图优先返回"等待图谱数据"。

## 波浪

生产继续使用 `PipelineWaveDivider` 的 SVG path + ResizeObserver 实现。不要用原型里的 CSS background-image 替换它。

当前视觉常量：

- wavelength: 40px
- amplitude: 7px
- statuses: idle, active, complete, error
- tones: signal, insight, neutral

## Release Surface Rule

provider、model、endpoint、token、错误堆栈和调试日志不进入常驻 pipeline 模块。它们属于设置、错误提示、调试面板或诊断抽屉。
