# Codex CLI — Semantic eval 不应作 universal 硬门

- **工作线:** 结构化语义
- **Session date**: 2026-06-26
- **来源:** `C:\Users\finni\.codex\sessions\2026\06\26\rollout-2026-06-26T11-24-06-019f01f4-b10e-70f2-8e74-71704b16f270.jsonl`
- **源文件大小:** 179 KB
- **提取消息数:** 4

> 已过滤：tool 输出、系统 Instructions、重复 assistant 副本。Compaction 块保留为摘要。

## User `2026-06-26T03:24:41`

<environment_context>
  <cwd>C:\Users\finni\Desktop\ListenGraph</cwd>
  <shell>powershell</shell>
  <current_date>2026-06-26</current_date>
  <timezone>Asia/Shanghai</timezone>
  <filesystem><workspace_roots><root>c:\Users\finni\Desktop\ListenGraph</root></workspace_roots><permission_profile type="disabled"><file_system type="unrestricted" /></permission_profile></filesystem>
</environment_context>

## User `2026-06-26T03:24:41`

## # 详细回顾：ListenGraph LLM-as-Judge Acceptance 校准 Pipeline --- ## 一、我们最初要解决的问题（目标） …: C:\Users\finni\.codex/attachments/60d5cbcc-6c02-4f9d-9651-9e61798bc3d3/pasted-text.txt

## My request for Codex:
嗯 用不同模型跑structurer的结果不一样 之前用旗舰模型跑出来的结果 然后让judgement去落acceptance，再用小模型跑 就跑全红了，但是以后的用户指不定会用什么模型跑，说不定会用端侧模型，咱们不能限制或者替人家假设，嗯，所以我觉得把这个东西做成回归测试是不合适的，我觉得只能用来当assmbler的效果检验工具，你觉得呢？说说你的想法


## Assistant `2026-06-26T03:25:15`

我会把这件事拆成两层：structurer 本身能不能跨模型稳定，以及这套 acceptance 是否应该进“硬回归门”。你描述的全红，核心不是某个断言太严，而是评估对象本身已经从“代码回归”变成了“模型行为分布”。

## Assistant `2026-06-26T03:26:00`

我同意你的判断：这套东西不适合当“硬回归测试”，至少不适合用来证明“任意用户模型下 structurer 都没退化”。

原因很直接：现在的 acceptance 是由旗舰模型输出和 judge 草稿一起校准出来的，它天然编码了一个“参考模型的语义密度、表达风格、节点粒度”。再用小模型或端侧模型跑，全红不一定说明代码坏了，更多是在说明：这个模型的结构化能力、输出密度、抽象粒度和参考模型不在同一个分布里。把这种红灯放进 CI 硬门，会把“模型能力差异”误报成“代码回归”。

我会把它定位成三层：

1. **硬回归测试**：只测确定性工程契约  
   例如 schema 合法、JSON 可解析、没有 fallback 爆炸、assembler 输入输出稳定、禁明显幻觉、关键流程不崩。这些可以进 CI。

2. **模型 profile benchmark**：测某个固定模型配置的质量  
   比如“glm-5.1 profile”“qwen-35b profile”“local-small profile”。每个 profile 有自己的基线和通过率，不互相替代。它回答的是：这个模型在 ListenGraph 上大概能做到什么水平。

3. **assembler 效果检验工具**：这是最适合当前 LLM-as-Judge pipeline 的位置  
   同一段输入、同一模型、with assembler vs without assembler，对比图谱是否更聚合、更少噪声、更抓重点。这个相对比较比“必须命中旗舰 acceptance”可靠得多。

所以我不会删掉这套 pipeline，但会改名和改预期：不要叫 `structure-regression` 的硬门，应该叫 `structure-eval` / `assembler-eval` / `model-quality-benchmark`。它的输出是报告、趋势、人工复核入口，不是默认阻塞发布的红绿灯。

一个比较稳的产品判断是：ListenGraph 不能替用户假设模型，但可以告诉用户“你当前模型的结构化质量档位”。这套评测正好可以服务这个目标。旗舰模型产出的 acceptance 可以作为“高质量参考线”，但不能作为所有模型必须通过的统一真理。
