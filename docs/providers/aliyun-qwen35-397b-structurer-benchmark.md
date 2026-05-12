# Aliyun Qwen3.5-397B-A17B Structurer 基准测试

> 状态：选型评估记录
>
> 这是 2026-05-11 对阿里云 `qwen3.5-397b-a17b` 模型在 ListenGraph structurer 场景下的测试结果。
> 结论：模型能力合格但延迟过高（推理型模型），**不适合实时 structurer 场景**。

> 测试日期：2026-05-11
> 测试人：Barry + Claude Code 辅助
> API Key：阿里云 DashScope API Key
> 端点：`https://dashscope.aliyuncs.com/compatible-mode/v1`

---

## 一、测试背景

### 1.1 为什么测试这个模型

ListenGraph 实时对话可视化工具的 structurer 模块负责将 ASR 转写文本提取为知识图谱（nodes + edges）。
当前默认 structurer 模型为 `qwen-plus`（非推理型），需评估更大参数模型能否提升图谱质量。

### 1.2 模型规格

| 属性 | 值 |
|------|-----|
| 模型 ID | `qwen3.5-397b-a17b` |
| 架构 | MoE（Mixture of Experts） |
| 总参数量 | **397B**（3970 亿） |
| 激活参数量 | **17B**（170 亿） |
| 推理模式 | **强制思考型**（不可关闭 reasoning） |
| API 端点 | 阿里云 DashScope（OpenAI 兼容模式） |
| 定价 | 按阿里云 DashScope 官方定价 |

### 1.3 测试环境

| 项目 | 值 |
|------|-----|
| 网络 | 中国大陆家庭宽带 |
| 请求方式 | HTTPS POST（非流式） |
| response_format | `{ type: "json_object" }` |
| Extension 超时设置 | 90,000 ms（90 秒） |
| 测试 fixture 数量 | 15（bootstrap + incremental + replay + 低新颖度） |

---

## 二、客观实验结果

### 2.1 基础延迟测试（简单 prompt）

用最简单的 prompt 测模型响应基线：

| 模型 | prompt_tokens | 耗时 | reasoning_tokens | completion_tokens | 状态 |
|------|--------------|------|------------------|-------------------|------|
| qwen3.5-397b-a17b | 66 | **58.0s** | 2,719 | 3,024 | 200 |
| qwen-plus（对照） | 69 | **11.2s** | 0 | 300 | 200 |

- `qwen3.5-397b-a17b` 的 reasoning_tokens 占 completion_tokens 的 **88%**
- 即使是极简输入，模型仍需约 60 秒完成内部推理

### 2.2 完整 structurer prompt 模拟

用 ListenGraph 实际 structurer 的完整 system prompt（3068 字符）+ incremental 模式的 user payload（970 字符，含 recentGraphContext）模拟真实调用：

| 项目 | 值 |
|------|-----|
| System prompt | 3,068 字符（ListenGraph 完整 structurer 指令） |
| User payload | 970 字符（incremental 模式，含 3 个已有节点 + 2 条已有边） |
| prompt_tokens | 1,118 |
| 耗时 | **110.0s** |
| reasoning_tokens | **5,682** |
| completion_tokens | 5,793 |
| 输出 | 1 node, 1 edge（正确连接到已有节点） |
| 状态 | 200 ✅（但超出 extension 90s 超时） |

- reasoning_tokens 占 completion_tokens 的 **98%**
- 实际输出仅约 111 token，其余全部是内部推理

### 2.3 完整测试套件（15 fixture）

运行 `structure-focused.real.test.ts`，覆盖 bootstrap、incremental、replay、低新颖度等场景：

| 项目 | 值 |
|------|-----|
| 总 fixture 数 | 15 |
| 通过 | **14** |
| 失败 | **1**（`incremental-role-self`：语义正确但子串匹配失败） |
| 总耗时 | **1,269.6s**（约 21 分钟） |
| 测试执行时间 | 1,260.5s |
| 平均每 fixture | **~84s** |

失败详情：
```
incremental-role-self: 期望包含文本"专业的状态"
实际输出: "工作时需保持严肃专业状态，放松时更接近本真样子"
→ 语义正确，子串"专业的状态"在"严肃专业状态"中未精确匹配
```

### 2.4 Extension 运行时实际表现

从 debug 导出日志（`session_1778473505193_1-debug-full.json`）提取的 6 次真实 structurer 调用：

| Run | 模式 | window | recentCtx | 耗时 | 状态 | 产出 |
|-----|------|--------|-----------|------|------|------|
| 0 | bootstrap | 3 chunks / 50 chars | 0N 0E | 83.6s | success | 1N 0E |
| 1 | incremental | 1 chunk / 31 chars | 1N 0E | 76.4s | success | 0N 0E |
| 2 | incremental | 1 chunk / 31 chars | 1N 0E | 73.3s | success | 0N 0E |
| 3 | incremental | 2 chunks / 75 chars | 1N 0E | 87.7s | success | 2N 1E |
| 4 | incremental | 3 chunks / 137 chars | 3N 1E | 78.8s | success | 1N 1E |
| 5 | incremental | 3 chunks / 212 chars | 4N 2E | **90.0s** | **timeout** | 无 |

随后日志显示 12:35-12:38 间**连续三次超时**，structurer 进入死循环：
```
backlog 积压至 56 条 transcript
状态反复切换：structuring → error → structuring → error
```

---

## 三、数据分析

### 3.1 延迟对比汇总

| 场景 | qwen3.5-397b-a17b | qwen-plus | 倍率 |
|------|-------------------|-----------|------|
| 简单 prompt | 58s | 11.2s | 5.2x |
| 完整 structurer prompt | 110s | 未测（预估 15-25s） | ~5-7x |
| 测试套件平均每 fixture | 84s | 未测 | - |
| Extension 运行时平均 | 80s | 未测 | - |

### 3.2 根因：强制推理模式

`qwen3.5-397b-a17b` 是一个**强制思考型模型**（类似 OpenAI o1 / DeepSeek-R1），无法通过参数关闭 reasoning。

实测 token 构成：

| 场景 | 总 completion_tokens | reasoning_tokens | reasoning 占比 | 实际输出 token |
|------|---------------------|------------------|---------------|---------------|
| 简单 prompt | 3,024 | 2,719 | 88% | ~305 |
| 完整 structurer prompt | 5,793 | 5,682 | 98% | ~111 |

推理 token 的生成时间决定了总延迟。模型"思考"时间占总响应时间的 90%+。

### 3.3 与 extension 超时的关系

| 指标 | 值 |
|------|-----|
| Extension structurer 超时 | 90s |
| 运行时平均响应时间 | 80s |
| 安全裕度 | **仅 10s（11%）** |
| 完整 prompt 模拟 | 110s（超出 22%） |

在 extension 实际运行中，73-88 秒的成功调用已经逼近超时线。一旦网络有轻微波动或服务端排队，就会超过 90 秒导致超时。这正是 debug 日志中观察到的现象：前几次勉强通过，之后连续超时。

### 3.4 图谱质量

| 指标 | 值 |
|------|-----|
| 测试通过率 | 14/15（93%） |
| 唯一失败原因 | 子串匹配边界 case（语义正确） |
| 运行时产出密度 | 5 次成功 → 4 nodes / 2 edges（部分 incremental 正确返回空） |

模型能力合格。在增量模式下能够正确判断信息新颖度，低新颖度时返回空（符合预期），有新信息时正确连接到已有节点。

---

## 四、结论

### 4.1 对 ListenGraph 实时场景的评估

| 维度 | 评价 |
|------|------|
| 图谱质量 | 合格（93% fixture 通过） |
| 延迟 | **不可用**（平均 84s，超 extension 90s 超时线） |
| 稳定性 | **不可用**（10s 裕度下，网络波动即超时死循环） |
| 成本 | 高（每次调用消耗 3000-6000 token，其中 90%+ 为推理 token） |

### 4.2 适用与不适用场景

**适用：**
- 离线批量处理（无实时性要求）
- 对图谱质量有极高要求且可接受分钟级延迟的场景

**不适用：**
- ListenGraph 的实时对话结构化（当前场景）
- 任何单次调用要求 < 30s 的场景

### 4.3 选型建议

对于 ListenGraph 实时 structurer，模型选型应满足：

1. **非推理型模型**（reasoning_tokens = 0）或推理型模型但可关闭 reasoning
2. **平均延迟 < 20s**（留足超时裕度）
3. **支持 `response_format: { type: "json_object" }`**（确保结构化输出）

当前推荐优先级：

| 优先级 | 模型 | 理由 |
|--------|------|------|
| 1 | `qwen-plus` | 当前默认，~11s，稳定 |
| 2 | `qwen-turbo` | 更快，适合高频率调用 |
| 3 | `qwen3-235b-a22b` | 更大参数但非推理型（需验证延迟） |
| 不推荐 | `qwen3.5-397b-a17b` | 强制推理，延迟不可接受 |

---

## 五、参考

- 测试导出文件：`session_1778473505193_1-debug.json`、`session_1778473505193_1-debug-full.json`
- 测试用例：`apps/extension/src/service-worker/structure-focused.real.test.ts`
- Structurer provider 实现：`packages/providers/src/structurer/openai-structurer.ts`
- 历史基准测试：[Zhipu GLM-4.7-Flash 性能基准测试](zhipu-glm-benchmark-2026-03-31.md)
- 阿里云 DashScope 文档：https://help.aliyun.com/zh/model-studio/
