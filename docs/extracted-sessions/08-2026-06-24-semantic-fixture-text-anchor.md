# Codex CLI — Semantic fixture 文本锚点校准

- **工作线:** 结构化语义
- **Session date**: 2026-06-24
- **来源:** `C:\Users\finni\.codex\sessions\2026\06\24\rollout-2026-06-24T14-35-59-019ef857-a6ce-75f1-90f0-ec55e98e3881.jsonl`
- **源文件大小:** 144 KB
- **提取消息数:** 4

> 已过滤：tool 输出、系统 Instructions、重复 assistant 副本。Compaction 块保留为摘要。

## User `2026-06-24T06:36:23`

<environment_context>
  <cwd>c:\Users\finni\Desktop\ListenGraph</cwd>
  <shell>powershell</shell>
  <current_date>2026-06-24</current_date>
  <timezone>Asia/Shanghai</timezone>
  <filesystem><workspace_roots><root>c:\Users\finni\Desktop\ListenGraph</root></workspace_roots><permission_profile type="disabled"><file_system type="unrestricted" /></permission_profile></filesystem>
</environment_context>

## User `2026-06-24T06:36:23`

6 个全部跑完。完整诊断报告如下。



---



# AI 草稿质量诊断报告（6/6）



## 一、总结果：2 绿 4 红（33% 通过率）



| seg | 结果 | 失败在哪 | 节点数(草稿范围) | 边数(草稿≥) |

|---|---|---|---|---|

| seg14 | ✅ 通过 | — | 落在 9-13 | ≥8 ✅ |

| seg18 | ❌ | mustContainOneOfTexts | 15(落在15-20) ✅ | 15(≥15) ✅ |

| seg31 | ❌ | mustContainOneOfTexts | 14(落在9-14) ✅ | 12(≥7) ✅ |

| seg33 | ✅ 通过 | — | 落在 10-18 | ≥10 |

| seg38 | ❌ | **forbiddenTexts**「池中」 | 13(落在10-15) ✅ | 12(≥8) ✅ |

| seg43 | ❌ | mustContainOneOfTexts | 14(落在10-18) ✅ | 11(≥10) ✅ |



## 二、核心发现：红全部来自「文本匹配」，结构断言 6/6 全过



这是最有价值的结论。我把断言分两类看：



**结构性断言（全过）：**

- 节点数范围 `min/maxMergedNodes` → **6/6 通过**

- 边数下界 `minMergedEdges` → **6/6 通过**

- 节点类型 `mustHaveNodeTypes`(claim) → **6/6 通过**

- fallback → **6/6 通过**



**文本类断言（4 个全挂在这）：**

- `mustContainOneOfTexts`（必含语义锚点）→ seg18/seg31/seg43 挂在这

- `forbiddenTexts`（禁词）→ seg38 挂在这



**没有一个红是来自节点数、边数、类型这些「数值/结构」断言。** AI 草稿对「这段该有几个节点、几条边、必须有 claim」的判断是**准确的**（6/6 框住了 structurer 真实输出）。



## 三、4 个红的具体性质（关键：是不是随机性？）



逐个看，4 个红**都不是 LLM 随机性**，而是两类**确定性的、机制性**问题：



### 类型 A：必含词的措辞不匹配（seg18/31/43）



这是最普遍的问题。三个失败的方式**完全一致**——意思对，措辞不同：



| seg | 草稿要的 | structurer 实际产出 |

|---|---|---|

| seg18 | 「脱口秀门槛不低」 | 「脱口秀的**实际**门槛**并不**低」 |

| seg31 | 「世界无所谓回应」 | 「世界**本身**无所谓回应**且极其混沌**」 |

| seg43 | 「幽默应对/自我解嘲」 | 「应尝试**自我解嘲**或将其表达出来」 |



注意 seg43 最冤：草稿写「自我解嘲」，structurer 写「自我解嘲或将其表达出来」——双向子串匹配 `actual.includes("自我解嘲")` **应该是 true 才对**。这说明草稿里那组用的是「幽默应对/自我解嘲」这种**带斜杠的合并写法**，整串当子串去匹配就挂了。



**根因**：strict 的匹配是「双向子串 + 去标点小写」，对措辞差异和格式（斜杠、修饰词）零容忍。AI 草稿生成的是「完整句子级的语义锚点」，和这个匹配机制不兼容。**这是确定性的机制不匹配，不是随机性——同一个草稿重跑 100 次都会挂。**



### 类型 B：禁词误判（seg38）



草稿禁「池中」，但 structurer 合理地用了「池中也无法做到...」（指代某人）。这是 AI 生成禁词时**过度激进**——它可能把 ASR 噪声里的字组合误判成该禁的词。这也是确定性的。



## 四、这对你的决策意味着什么



回到你最初的诉求：「不当严格回归，对随机性心里有数」。



诊断告诉你：**真正的红根本不是随机性**。4 个红里有 3 个是「必含词措辞不匹配」的确定性 bug，1 个是「禁词误判」的确定性 bug。如果你「心里有数 = 红了就忽略」，你会把**这 4 个确定性的草稿缺陷**也一起忽略掉——它们本是可以修的。



所以现在你有两个清晰的选择：



### 选择 A：修文本类断言的机制，让草稿真正可用（推荐）



4 个红里 3 个是同一类（mustContainOneOfTexts），有明确修法：

- **生成端**：让 judge 草稿把「句子级锚点」拆成「2-4 字关键词组」，避免斜杠/修饰词

- **或匹配端**：给 strict 的文本匹配加「关键词重叠」兜底（草稿词被实际文本包含即算命中，已是双向子串，问题在斜杠和修饰词）



修完这 3 个，通过率能从 33% → 83%（只剩 seg38 禁词那一个边缘 case）。这样这套 fixture 就能真正当「弱监控」用：偶尔红的都是真信号。



### 选择 B：接受现状，把 acceptance 降级为「只看结构」



把所有 fixture 的 `mustContainOneOfTexts` 和 `forbiddenTexts` **删掉**，只保留节点数/边数/类型/fallback。这样 6/6 全绿，但验收力度回到「只验结构不验语义」——等于 AI 草稿的语义判断部分白做了。



### 选择 C：现状不动，文档记下「红的都是文本匹配问题」



接受 4/6 红，但在文档里明确标注：**local strict 的红只看结构断言，文本断言（必含/禁词）的红按已知机制问题忽略**。这是最低成本，但也是最容易滑向「凡是红的都忽略」的方案。



---



我的建议是 **A**，因为你花这么大力气做 judge pipeline，目标就是用 AI 的语义判断当验收。现在数据告诉你「语义判断本身是对的（结构全过），只是锚点措辞和匹配机制不匹配」——这是个低成本可修的问题，修了能让整个 pipeline 真正闭环。



要不要**修文本锚点的匹配机制**（具体是给 strict 的 mustContainOneOfTexts 加「按词切分再匹配」的兜底，这样「自我解嘲或将其表达出来」能命中「自我解嘲」），然后重跑这 4 个验证？这是让 3 个红的必含词断言转绿的最小改动。

## User `2026-06-24T06:36:26`

<turn_aborted>
The user interrupted the previous turn on purpose. Any running unified exec processes may still be running in the background. If any tools/commands were aborted, they may have partially executed.
</turn_aborted>

## Assistant `2026-06-24T06:37:22`

我同意选 **A**，但我会把它定义得更窄一点：**不要把 strict 变成语义相似度判断器，只修“锚点格式和短语颗粒度”的确定性误差。**

原因是这 6 条结果已经说明了两件事：

1. 结构门槛是有效的：节点数、边数、claim、fallback 全过，说明 AI 草稿在“这段输出大概应该长什么样”上是靠谱的。
2. 红灯集中在文本断言，且是机制问题：斜杠合并、修饰词差异、禁词过度激进。这不该靠“忽略红灯”解决，否则以后真的语义漏抓也会被一起忽略。

我建议的修法顺序是：

1. **先改生成端规则**：让 AI draft 的 `mustContainOneOfTexts` 产出短锚点数组，而不是整句或斜杠组合。比如 `["自我解嘲", "幽默应对"]`，不要 `"幽默应对/自我解嘲"`。
2. **再给 strict 匹配加很小的兜底**：把候选锚点按 `/、，,；;|` 这类分隔符拆开，过滤太短 token 后做现有的双向子串匹配。这样不是放宽到“意思差不多就过”，只是把一个错误写法还原成多个锚点。
3. **forbiddenTexts 更保守**：禁词只适合放明显幻觉、人名错配、主题外概念；像「池中」这种短词、可作正常上下文词的，不该自动进禁词。禁词最好要求更长、更特异，或者人工/二次 judge 确认。

我不建议一上来做“关键词重叠比例”或 embedding 相似度。那会把 strict gate 的可解释性打掉。现在最小正确改动应该是：**锚点拆分 + 生成提示约束 + 重跑 4 个红样本**。如果 seg18/31/43 转绿、seg38 仍红，那就正好证明问题边界清楚：必含锚点机制修好了，禁词策略另行收紧。

所以我的判断是：**A 是对的，但先修 deterministic parsing/anchor granularity，不要升级成宽松语义匹配。** 这和 ListenGraph 之前的验收方向一致：semantic fixture 是弱语义门，不是 snapshot，也不是随便红了就忽略。
