# 扩展 Structure Unit Assembler 方案

## 目的
本文提出一层位于 `ASR stable utterance` 与 `structurer` 之间的运行时组装器：

`ASR stable utterance -> structure unit assembler -> structurer -> merge -> sidepanel`

目标不是让程序替代 LLM 理解语义，而是先把明显不适合立刻结构化的碎片输入缓一下，减少“半句进 structurer、空跑、图谱漏信息”的情况。

## 要解决的问题
当前 realtime 主链路默认把腾讯 `slice_type=2` 的稳定 utterance 直接当作 structurer 输入单元。

这带来几个问题：
- `stable utterance` 只表示“识别结果已稳定”，不表示“语义已完整”
- 真实口语里停顿常常只是思考或换气，不等于一句话结束
- 当前 incremental prompt 强约束“只抽 latest transcript 的净新增”，容易漏掉“上一句半截 + 下一句补完”的跨 utterance 语义
- 当前 incremental 无 fallback；若模型返回空 `nodes/edges`，transcript 仍保留，但图谱层不留痕

## 非目标
本文方案不追求：
- 程序级别的完整语义理解
- 完全替代 structurer
- 让 ASR 单独产出“结构化最优输入”
- 在 assembler 层做图谱抽取

assembler 的职责仅限于：
- 聚合 utterance
- 判断现在是 `wait` 还是 `commit`
- 在少数边界不确定场景下选择 `merge_with_prev`
- 控制延迟与输入质量的平衡

## 核心思路
将实时链路里的两个概念拆开：

1. `ASR unit`
- 由 ASR/VAD/endpoint detection 产生
- 对应稳定 utterance
- 强调低延迟、时间戳稳定、结果不再变化

2. `structure unit`
- 由 assembler 组装
- 对应“此刻适合送给 structurer 的文本单元”
- 强调尽量减少明显半句，但不追求严格语法句

因此当前主链路建议改为：

`ASR stable utterance -> pending buffer -> assembler decision(commit/wait/merge) -> structure unit -> structurer`

## 总体策略
默认采用：
- `programmatic assembler` 作为主方案
- 可选的小模型边界仲裁仅在“边界不确定”时触发

推荐原则：
- 大多数输入靠规则、分数、状态机解决
- 只有少量高歧义边界才请求小模型
- structurer 继续负责语义抽取，不承担流式边界修复主责

## 当前实现状态
截至 2026-04-29，Phase 1/2 已落到 extension realtime WS 主链路：

- Phase 1：`programmatic assembler` 已实现，负责 `wait / commit / skip_current`
- Phase 2：`merge_with_prev` 已实现，仅用于明显“上一条半句 + 当前条补完”的场景
- 小模型边界仲裁仍未接入，`llmBoundaryJudgeEnabled = false`
- assembler 只处理 realtime WS transcript；batch 路径仍走旧 structurer 窗口逻辑
- transcript 仍会落库、广播、进入 debug/export；assembler 只改变送给 structurer 的输入单元

当前主要实现位置：
- `apps/extension/src/service-worker/index.ts`
- `apps/extension/scripts/report-structure-unit-ws-kpis.mjs`
- `apps/extension/src/service-worker/fixtures/structure/replay-realtime-*.json`

当前调试/导出已包含：
- `assemblerRuns`
- `structureUnits`
- runtime snapshot 中的 `currentAssemblerState`

这意味着本文后面关于 Phase 1/2 的部分既保留设计依据，也作为当前实现的行为说明；Phase 3 的小模型仲裁仍是后续候选方案。

## 与现有前置判断的职责映射
引入 assembler 后，最重要的原则是：

- transcript 层与 structurer 提交层的职责必须分开
- 旧 helper 不能继续与 assembler 平级裁决“是否调用 structurer”
- `commit / wait / skip` 的最终决定权应收敛到 assembler

当前仓库里已存在几类前置判断：
- `hasEnoughBootstrapContext()`
- `hasEnoughRealtimeBootstrapContext()`
- `shouldForceBootstrapForCompletedRealtimeInput()`
- `shouldForceBootstrapForExternalRealtimeWindow()`
- `shouldSkipIncrementalStructuring()`
- `isLowInformationTranscript()`

若不做职责收敛，最容易出现的问题是：
- 外层旧逻辑先短路一次
- assembler 内部再判断一次
- 两套“延迟 / 跳过 / 强制提交”规则互相打架

因此建议在 Phase 1 明确采用下面的迁移原则。

### 映射表
| 现有函数 | 当前职责 | assembler 引入后的建议职责 |
|---|---|---|
| `hasEnoughBootstrapContext()` | 判断 bootstrap 是否已有足够上下文 | 不再直接决定是否调用 structurer；下沉为 assembler 的 bootstrap 信号源 |
| `hasEnoughRealtimeBootstrapContext()` | realtime 首次启动门槛 | 不再平级裁决；转成 assembler 的 `bootstrap_ready` 条件 |
| `shouldForceBootstrapForCompletedRealtimeInput()` | 会话结束时强制起一次 bootstrap | 保留语义，但由 assembler 统一执行为 `force_commit` |
| `shouldForceBootstrapForExternalRealtimeWindow()` | external realtime 的窗口兜底启动 | 保留语义，但转成 assembler 的强制提交信号 |
| `shouldSkipIncrementalStructuring()` | 跳过低信息量增量 | 不再直接短路 structurer；转成 assembler 的 `skip_or_low_weight` 信号 |
| `isLowInformationTranscript()` | 极低信息 utterance 识别 | 保留为底层 helper，供 assembler 使用 |

### Phase 1 的职责边界
Phase 1 建议明确如下：

1. transcript 仍然：
- 落库
- 广播到 sidepanel
- 进入 transcript debug/export

2. assembler 负责：
- 是否进入 pending buffer
- 是否继续等待
- 是否立刻提交 structure unit
- 是否因 `input_finished / manual_flush / 超时 / 上限` 强制提交

3. 旧函数只保留为：
- helper
- signal source
- fallback 兼容逻辑

不建议保留“旧逻辑先判断是否调用 structurer，assembler 再判断一次”的并存状态。

## Programmatic Assembler

### 运行位置
建议直接放在：
- `apps/extension/src/service-worker/index.ts`

它应位于：
- transcript 已稳定、已落库、已广播到 sidepanel
- 但尚未调用 `structurerProvider.extractSegmentGraph()`

也就是说：
- transcript 层继续保留原样输入
- assembler 只决定“现在提交什么给 structurer”

### 数据模型
建议引入两个运行时对象：

1. `pendingStructureBuffer`
- 保存尚未提交给 structurer 的 utterance 列表
- 是实时链路的短期缓冲

2. `committedStructureUnits`
- 调试用途
- 记录每次实际提交给 structurer 的 logical span

建议结构：

```ts
type PendingStructureBuffer = {
  utterances: TranscriptChunk[];
  startedAt: number;
  updatedAt: number;
  totalChars: number;
  effectiveChars: number;
  sawTerminalPunctuation: boolean;
  sawIncompleteTail: boolean;
};

type StructureUnit = {
  unitId: string;
  sourceChunkIds: string[];
  startMs: number;
  endMs: number;
  text: string;
  reason: 'commit_rule' | 'commit_timeout' | 'commit_force_flush' | 'commit_llm';
};
```

### 基本状态机
建议使用极小状态机，而不是试图用规则直接穷举语义。

状态：
- `idle`
- `collecting`
- `ready_to_commit`

状态含义：
- `idle`：当前没有 pending utterance
- `collecting`：正在累积，默认继续等
- `ready_to_commit`：本轮已满足提交条件，准备生成 structure unit

转移原则：
- `idle -> collecting`：收到第一条 stable utterance
- `collecting -> collecting`：信号显示更像半句，继续等
- `collecting -> ready_to_commit`：信号显示已基本收束，或达到硬超时/硬上限
- `ready_to_commit -> idle`：提交 structure unit 后清空 buffer

这里的状态机不判断“语义是什么”，只判断“此时提交是否更合适”。

### Phase 1 状态转移顺序
为避免实现时把“硬规则”和“评分兜底”混在一起，Phase 1 建议固定以下顺序。

#### 入口前提
每次处理的是一条已经稳定的 utterance：
- transcript 已落库
- transcript 已广播给 sidepanel
- 当前逻辑正准备决定“是否形成 structure unit 并提交给 structurer”

#### 状态机顺序
1. `idle`
- 收到一条可参与组装的 utterance
- 初始化 `pendingStructureBuffer`
- 转到 `collecting`

2. `collecting`
- 把当前 utterance 追加进 buffer
- 更新 buffer 的统计量与信号
- 先走硬规则
- 若命中 `commit`，转到 `ready_to_commit`
- 若命中 `skip_current`，保持 `collecting` 或回到 `idle`
- 若命中 `wait`，保持 `collecting`
- 若硬规则未决，再进入评分兜底

3. `ready_to_commit`
- 基于当前 buffer 生成 `StructureUnit`
- 调用 structurer
- 写入调试信息
- 清空 buffer
- 回到 `idle`

## Phase 1 决策伪代码
下面的伪代码不是最终实现，但建议作为 Phase 1 的顺序骨架。

```ts
function onStableUtterance(transcript: TranscriptChunk) {
  persistTranscript(transcript);
  broadcastTranscript(transcript);

  if (!shouldAssemblerHandle(transcript)) {
    return;
  }

  if (assembler.state === 'idle') {
    assembler.beginBuffer(transcript);
  } else {
    assembler.appendToBuffer(transcript);
  }

  const buffer = assembler.getBuffer();
  const signals = deriveAssemblerSignals(buffer, transcript);

  const hardDecision = decideByHardRules({
    buffer,
    transcript,
    signals,
  });

  if (hardDecision.type === 'skip_current') {
    recordAssemblerRun({ decision: 'skip_current', reason: hardDecision.reason });

    if (hardDecision.dropCurrentOnly) {
      assembler.removeLatestIfNeeded();
    }

    if (assembler.isBufferEmpty()) {
      assembler.resetToIdle();
    }

    return;
  }

  if (hardDecision.type === 'wait') {
    recordAssemblerRun({ decision: 'wait', reason: hardDecision.reason });
    assembler.keepCollecting();
    return;
  }

  if (hardDecision.type === 'commit') {
    commitCurrentBuffer(hardDecision.reason);
    return;
  }

  const score = scoreBoundary(buffer, signals);
  const scoreDecision = decideByScore({ buffer, signals, score });

  if (scoreDecision.type === 'commit') {
    commitCurrentBuffer(scoreDecision.reason);
    return;
  }

  if (scoreDecision.type === 'wait') {
    recordAssemblerRun({
      decision: 'wait',
      reason: scoreDecision.reason,
      score,
    });
    assembler.keepCollecting();
    return;
  }

  if (llmBoundaryJudgeEnabled && scoreDecision.type === 'uncertain') {
    const llmDecision = decideBoundaryBySmallModel({
      buffer,
      transcript,
      signals,
    });

    if (llmDecision.type === 'commit') {
      commitCurrentBuffer('commit_llm');
      return;
    }

    if (llmDecision.type === 'wait') {
      recordAssemblerRun({ decision: 'wait', reason: 'wait_llm' });
      assembler.keepCollecting();
      return;
    }
  }

  recordAssemblerRun({ decision: 'wait', reason: 'wait_fallback' });
  assembler.keepCollecting();
}
```

### `commitCurrentBuffer()` 的建议语义
提交动作建议固定为：

```ts
function commitCurrentBuffer(reason: CommitReason) {
  assembler.state = 'ready_to_commit';

  const unit = assembler.materializeStructureUnit(reason);
  recordStructureUnit(unit);

  runStructurerWithUnit(unit);

  assembler.clearBuffer();
  assembler.state = 'idle';
}
```

关键点：
- `commit` 决策与 `runStructurer` 调用绑定
- 一旦 materialize 出 `StructureUnit`，就不再回头走旧的 transcript 级提交逻辑
- 提交后必须清空 buffer，避免同一批 utterance 被重复提交

## Phase 1 硬规则顺序
硬规则不只是“有哪些规则”，更重要的是“先后顺序”。建议固定成下面这样。

### Step 1: 极低信息量直接处理
先识别当前 utterance 是否属于极低信息量输入，例如：
- `嗯`
- `啊`
- `好的`
- `谢谢`
- `欢迎`
- `掌声`

建议语义：
- 若当前 buffer 为空：直接 `skip_current`
- 若当前 buffer 非空：默认不提升 commit 倾向，但也不一定清空已有 buffer

这一步的目标是：
- 避免把无意义 utterance 变成组装噪声
- 但不误伤前面已积累的有意义 buffer

### Step 2: 强制提交条件
优先处理机械兜底信号：
- `input_finished`
- `manual_flush`
- `hardWaitMs` 超时
- `maxBufferedUtterances` 超限
- `maxBufferedChars` 超限

命中后直接：
- `commit`

这类信号不应再进入评分层。

### Step 3: 明确 bootstrap-ready 条件
若当前仍处于“尚未产出 merged graph”的阶段，则检查 bootstrap 相关条件：
- 是否达到最小上下文要求
- 是否满足 force bootstrap 场景
- 是否达到最低有效字符数 / 时长

建议语义：
- 未达到 bootstrap-ready：`wait`
- 已达到 bootstrap-ready：继续向下判断，不必在此处立即 `commit`

原因是：
- bootstrap-ready 只表示“已经具备可启动资格”
- 不代表此刻一定是最优提交边界

### Step 4: 明确句末强收束
若同时满足：
- 已命中句末强收束标点
- 长度达到最低有效阈值
- 未命中更高优先级的强制等待条件

则优先：
- `commit`

这里要明确：
- 强收束信号优先级高于弱尾部模式
- 不应出现“因为弱尾部词表命中，就压过句末句号”的情况

### Step 5: `merge_with_prev` 只做候选，不默认启用
Phase 1 不建议默认启用真正的 `merge_with_prev` 提交策略。

但可以在硬规则层记录：
- 当前 buffer 是否形成明显的 `merge_with_prev` 候选

用途仅限于：
- 调试观察
- Phase 2 设计输入
- 可选小模型边界仲裁的上下文

Phase 1 里它默认不直接驱动提交。

### Step 6: 剩余情况进入评分兜底
只有前面都未决时，才进入 `scoreBoundary()`。

这一层的作用是：
- 对模糊边界做保守选择
- 给“是否需要小模型仲裁”提供触发条件

而不是：
- 重新覆盖前面已经命中的强规则

## Phase 1 评分兜底顺序
评分层建议进一步固定为：

1. 计算 `score`
2. 若 `score >= commitThreshold`：`commit`
3. 若 `score <= waitThreshold`：`wait`
4. 若落在中间不确定区：
- 默认 `wait`
- 若启用了小模型边界仲裁，则进入小模型判定

这样可以确保：
- 不确定区默认偏保守
- 不会因为评分抖动导致系统过于激进地提交

## Phase 1 决策输出类型
建议把 assembler 决策统一收敛成有限集合，避免实现时到处散落布尔分支。

```ts
type AssemblerDecision =
  | { type: 'skip_current'; reason: string; dropCurrentOnly?: boolean }
  | { type: 'wait'; reason: string }
  | { type: 'commit'; reason: CommitReason };
```

好处：
- 调试日志更清晰
- replay 更容易统计 KPI
- 不容易在实现里把“wait but keep buffer”和“skip current but keep buffer”混淆

## Phase 1 实现约束
为降低首版复杂度，建议显式约束：

- 不在 Phase 1 默认启用真正的 `merge_with_prev`
- 不让评分层覆盖已经命中的硬规则
- 不让弱信号压过句末强收束信号
- 不让旧的 transcript 级 `skip / bootstrap / force` 逻辑与 assembler 平级裁决
- 不让小模型边界仲裁成为主路径

满足这些约束后，Phase 1 才是一个：
- 可解释
- 可回滚
- 可用 replay 对照调参

的保守版本。

## 信号设计
建议把判断拆成弱信号，而不是单个硬规则。

### 信号可靠性分层
不是所有信号都应被同等对待。Phase 1 建议显式区分：

#### 强信号
这些信号相对稳定，可用于硬规则或高优先级判断：
- 强制提交信号：`input_finished`、`manual_flush`、超时、上限
- 明确句末收束：句末存在 `。！？`
- 明显的累计长度 / 等待时长阈值

#### 弱信号
这些信号只适合作为辅助判断，不应直接强力加减分：
- 尾部模式词表，如 `因为 / 所以 / 但是 / 然后 / 我觉得`
- `utterances.length >= 2`
- 仅靠单个口语模式推断“像没说完”

Phase 1 不建议把弱信号直接做成高权重硬扣分项，否则会与强信号打架。

### 1. 完整性正信号
表示“更像可以提交”：
- 当前 buffer 总字符数达到阈值
- 最新 utterance 以句末标点收束
- 最新 utterance 结尾出现明显收束表达
- 最新 utterance 本身长度已足够
- 前后两条拼接后形成更完整的短段
- 当前 buffer 已等待超过软超时

### 2. 未完成负信号
表示“更像应该继续等”：
- 最新 utterance 结尾是明显连接词、悬空短语或未完开头
- 最新 utterance 很短且没有收束信号
- 最新 utterance 更像补语前半段、主语引入、评价起手式
- 当前 buffer 的最后一条比前一条更像“接着往下说”

### 3. 强制提交信号
表示“即使不完美也必须提交”：
- `input_finished`
- `manual_flush`
- pending buffer 超过最大等待时长
- pending buffer 累积 utterance 数超过上限
- pending buffer 累积字符数超过上限

## 建议使用的程序化特征
以下特征不要求系统真正理解语义，但能显著降低明显半句。

### 文本长度特征
- `normalizedCharCount`
- `effectiveCharCount`
- `utteranceCount`
- `bufferDurationMs`

### 标点特征
- 句末是否有 `。！？`
- 是否仅有逗号、顿号等弱收束标记
- 是否完全无标点

### 尾部模式特征
可维护一个小型中文口语尾部模式表。

这里最重要的约束是：
- 只做“末尾窗口”匹配
- 不做全文任意位置匹配
- 若已命中明确句末收束信号，尾部未完成模式默认不应触发强负信号

否则很容易误伤：
- `因为时间关系我们就不展开了。`
- `所以呢我觉得这个方案可以。`

这些句子虽然包含连接词，但整体是完整句。

#### 倾向未完成
- `因为`
- `但是`
- `所以`
- `如果`
- `然后`
- `就是`
- `这个问题`
- `我的意思是`
- `我觉得`
- `它的问题在于`

#### 倾向收束
- `就是这样`
- `这很重要`
- `这就是核心`
- `我反对`
- `我同意`
- `这是结论`

这些模式不是语义理解，只是边界估计信号。

### 尾部模式的建议实现
不建议：
- 只要文本里出现 `因为 / 所以 / 我觉得` 就判定未完成

建议：
- 只在 utterance 末尾窗口内匹配
- 并且要求尾部后面没有明显实质内容
- 并且默认排除已命中句末强收束标点的情况

示意：

```ts
function hasIncompleteTailPattern(text: string) {
  const normalized = normalizeText(text);
  if (hasTerminalPunctuation(normalized)) {
    return false;
  }

  return /(因为|所以|但是|然后|就是|我觉得|我的意思是|问题在于)$/u.test(
    normalized,
  );
}
```

上面只是方向示意，不是最终正则。关键是：
- 精确后缀匹配
- 强收束优先于弱尾部模式
- 不允许“句中连接词”误触发“尾部未完成”

### 拼接提升特征
这是最关键的规则。

若满足：
- 上一条单看像未完成
- 当前条本身像补足
- 两条拼接后的字符数、收束性或结构完整感明显提升

则优先：
- `merge_with_prev`
- 生成一个由两条或多条 utterance 构成的 structure unit

### 低信息量特征
继续沿用现有 hard skip 思路，但仅用于“直接不进 pending buffer”或“进入后不提高 commit 分数”的极低信息输入：
- `嗯`
- `啊`
- `好的`
- `谢谢`
- `欢迎`
- `掌声`

不建议把“像半句但可能有意义”的输入当低信息量直接丢弃。

## 一个可落地的打分草案
不建议一开始就做复杂分类器，但也不建议把所有信号一视同仁地线性加减。

Phase 1 推荐采用：
- 先走硬规则
- 再走评分兜底

而不是：
- 所有信号平权加减分

原因是：
- 强信号与弱信号可靠性差异很大
- 信号之间存在明显耦合
- 若弱信号直接大幅扣分，容易压过更可靠的完成信号

例如：
- 句末标点通常是相对强的完成信号
- 尾部模式词表只是弱信号
- 因此不应出现“因为弱尾部词表命中，就压过句末句号”的情况

### 建议的两段式判断

#### 第一段：硬规则
优先处理以下情况：
- `force_commit`
- 明确低信息量直接跳过
- 明确的 `merge_with_prev` 候选
- 明确的句末强收束 + 长度足够

#### 第二段：评分兜底
仅对剩余边界不明确的情况打分。

评分层的目标不是做完美分类，而是：
- 在“明显该 commit”和“明显该 wait”之间做保守选择
- 给小模型边界仲裁提供一个触发依据

### 关于 `utterances.length >= 2`
该信号不应被理解为：
- “只要两条 utterance 就更值得提交”

更合理的解释是：
- 在其他条件接近时，多条 utterance 意味着有更多机会形成一个可提交单元

因此它最多只能是弱正信号，不应单独驱动提交。

### 关于 `sawIncompleteTail`
该信号不应被理解为：
- “命中词表就强制 wait”

更合理的解释是：
- 在缺少强收束信号时，作为一个提醒系统“可能还没说完”的弱负信号

因此它不应在以下场景里压过更可靠信号：
- 已有明确句末标点
- 长度明显足够且整体已收束
- 已命中强制提交条件

```ts
function scoreBoundary(buffer: PendingStructureBuffer): number {
  let score = 0;

  if (buffer.effectiveChars >= 28) score += 2;
  if (buffer.effectiveChars >= 40) score += 1;
  if (buffer.sawTerminalPunctuation) score += 2;
  if (buffer.utterances.length >= 2) score += 1;
  if (buffer.updatedAt - buffer.startedAt >= 2200) score += 1;

  if (buffer.sawIncompleteTail) score -= 3;
  if (buffer.effectiveChars <= 8) score -= 2;
  if (buffer.utterances.length === 1 && !buffer.sawTerminalPunctuation) score -= 1;

  return score;
}
```

建议初始提交条件：
- `score >= 2` 时 `commit`
- `score <= 1` 时 `wait`
- 落在临界区时可进入“小模型仲裁”或继续等下一条

以上数字只是起点，真实值应由 replay fixture 调参。

### 打分草案的使用约束
这份打分草案的定位应明确为：
- 初版兜底策略
- 用于 replay 调参起点

而不应被误解为：
- Phase 1 的最终判决器
- 一套可脱离上下文独立成立的完备分类器

若后续 replay 表明某些信号持续误导判断，应优先：
- 收紧信号定义
- 调整硬规则优先级
- 再考虑调权重

而不是只反复微调 `+2 / -3` 这类系数。

## 提交流程
每次收到 stable utterance 时：

1. transcript 先按现状落库并广播
2. utterance 进入 `pendingStructureBuffer`
3. 更新 buffer 信号
4. 计算边界分数
5. 若命中强制提交，直接 `commit`
6. 若分数明显够高，`commit`
7. 若分数明显偏低，`wait`
8. 若处于不确定区间，可选调用小模型做 `commit / wait / merge_with_prev`

提交后的行为：
- 生成 `StructureUnit`
- 以该 unit 替代“单条 latest utterance”作为一次 structurer 输入焦点
- pending buffer 清空，重新开始下一轮

## 与现有 structurer 的衔接
建议保持现有 bootstrap / incremental 语义，但把“latest transcript”替换成“latest structure unit”。

即未来更准确的运行时语义应变成：

`带最近 transcript 窗口做上下文，但只抽 latest structure unit 所暗示的净新增`

建议变化：
- transcript window 仍保留原始 utterance 粒度，供调试与导出
- assembler 额外生成 structure unit window
- structurer prompt 中：
  - `windowTranscript` 可继续保留原 utterance 拼接文本
  - `latestChunkTranscript` 建议改名为 `latestStructureUnitTranscript`

这样可以避免把原始 ASR 轨迹信息丢掉，同时改善增量焦点。

## incremental prompt 合约的收紧
仅把 `latestChunkTranscript` 改名为 `latestStructureUnitTranscript` 还不够。

一旦 `latest` 从单条 utterance 变成由 2-3 条 utterance 组成的 structure unit，会产生二阶影响：
- 单次 incremental 暴露给模型的净新增语义量变大
- 单次返回多个节点的概率上升
- 与 `mergeSegmentGraph()` 的近重复保守合并碰撞会更频繁
- 空输出率可能下降，但 merge 折叠率可能上升
- “append to history” 与“单次增量变胖”之间会有轻微张力

因此建议在 assembler 引入后，连同 incremental prompt 合约一起收紧，而不是只做字段重命名。

### 建议新增的语义声明
建议在 prompt 中显式补充：

- `latestStructureUnitTranscript` 可能由多个相邻 utterance 组成
- 这些 utterance 在本轮应被视为同一批同时可见的净新增上下文
- 不要因为 unit 变大就放宽“冻结历史”的原则
- 若 unit 内部只是把已有 claim 补全、补理由、补例子，优先追加 `reason/example` 或边，而不是重述主 claim

### 建议保留的硬约束
assembler 引入后，下面这些原则仍应保留：
- `recentGraphContext` 视为冻结语义
- incremental 不改写历史节点文本、类型或 speaker
- unit 内新增应尽量少而精，而不是因为输入变长就广泛重述
- 若 unit 内部大部分信息只是支撑已有语义，优先补边或附属节点

### 建议的 prompt 方向
可在现有 incremental 合约上补一类约束：

- “Treat all utterances inside latestStructureUnitTranscript as one coherent new unit for this turn.”
- “Even if latestStructureUnitTranscript is longer than a single utterance, preserve append-only behavior.”
- “Prefer a minimal set of net-new nodes that represent the unit, not a full re-summary of the unit.”

这部分需要与：
- `docs/extension/structurer-runtime.md`
- `docs/extension/incremental-graph-stability.md`

保持一致。

## 可选的小模型边界仲裁

### 目的
小模型不是第二个 structurer。

它只做一个轻量判定：
- `commit`
- `wait`
- `merge_with_prev`

只在程序规则无法稳定判断时触发。

### 触发条件
建议仅在以下情况调用：
- 分数处于临界区间，例如 `score in [1, 2]`
- 上一条像未完成，但当前条也不像明显补足
- 连续两次程序判断都倾向 `wait`，但 buffer 已接近软超时
- 最近连续出现 structurer 空输出，怀疑切碎了

### 输入
建议输入非常小，避免把它做成第二次完整结构化：

```json
{
  "language": "zh",
  "previous_utterance": "...",
  "current_utterance": "...",
  "buffer_text": "...",
  "buffer_char_count": 32,
  "buffer_wait_ms": 1800,
  "task": "Decide one of: commit, wait, merge_with_prev"
}
```

### 输出
建议只接受：

```json
{ "decision": "commit" }
```

或：

```json
{ "decision": "wait" }
```

或：

```json
{ "decision": "merge_with_prev" }
```

必要时可加：
- `reason`
- `confidence`

但运行时不应依赖长解释。

### 模型选择原则
建议：
- 默认关闭
- 使用低成本、低延迟的小模型
- 设置很短 timeout
- 超时或失败直接回退到程序规则

这层仲裁失败不应阻塞主链路。

## 调试与可观测性
建议在调试数据中新增：

- `assemblerRuns`
- `pendingStructureSnapshots`
- `structureUnits`

每次 decision 至少记录：
- 当前 buffer 的 chunk ids
- `effectiveChars`
- `waitMs`
- 分数
- 命中的规则
- 最终 decision
- 是否调用小模型
- 小模型耗时
- 提交原因

这会显著提升 replay 调参效率。

## Phase 1 KPI 与默认启用门槛
assembler 会在现有链路上额外引入等待与聚合，因此不能只凭主观感受决定是否默认启用。

Phase 1 建议先在 replay fixture 上固化以下 KPI：

1. 首图延迟
- `first_graph_latency_ms_p50`
- `first_graph_latency_ms_p95`

2. structurer 调用频率
- `structurer_calls_per_minute`

3. commit 后空输出比率
- `empty_structurer_output_ratio`
- 定义为：assembler 已 commit 一个 structure unit，但 structurer 返回空 `nodes/edges` 的比例

4. 辅助观测项
- `avg_utterances_per_structure_unit`
- `avg_effective_chars_per_structure_unit`

### 为什么这三项是硬门槛
- 首图延迟过高：用户会直接感知“图不动”
- 调用次数不降反升：说明 assembler 没带来节流收益
- commit 后空输出比率过高：说明 assembler 只是把碎片换了一种形式送进 structurer

### 建议的评估方式
在 replay fixture 上至少跑：
- 引入 assembler 前的 baseline
- 引入 assembler 后、默认参数下的结果
- 关键参数变化后的 A/B 对照

建议优先把 KPI 计算脚本做成独立工具，再进入大规模调参。

### 关于“漏信息率”
“漏信息率”是有价值的指标，但短期不建议把它作为 Phase 1 的自动硬门槛，因为：
- 需要更强的人工标注或半人工基准
- 很容易让第一版评估体系过重

更现实的做法是：
- Phase 1 先把 latency / call frequency / empty-output ratio 做硬指标
- “漏信息”先通过 fixture 人工 review 辅助判断

### 2026-04-29 验证记录
本轮验证覆盖 8 条 `replay-realtime-*` fixture：

- 原有 5 条 replay fixture
- `replay-realtime-merge-with-prev-boundary`
- `replay-realtime-complete-sentence-with-setup-tail`
- `replay-realtime-consecutive-incomplete`
- `replay-realtime-low-info-interruption`

离线 KPI 使用：

```powershell
pnpm --filter extension test:structure:ws:kpi
```

关键结果：

| 指标 | 当前结果 | 判断 |
|---|---:|---|
| `firstGraphLatencyMs` p50 | `50000ms` | 正常 |
| 平均 structurer calls/min | `1.86` | 正常 |
| `merge_with_prev` commits | `1` | 仅专用 fixture 触发 |
| 平均 utterances/commit | `1.81` | 正常 |
| `emptyOutputRatio` | `0.43` | 观测项，不阻塞 assembler 验收 |

真实 strict replay 使用：

```powershell
pnpm --filter extension test:structure:real:replay:strict
```

8 条 fixture 已全部通过真实 structurer replay。新增边界 fixture 的验证含义：

| Fixture | 覆盖点 | 结果 |
|---|---|---|
| `complete-sentence-with-setup-tail` | 句中包含 `核心是`，不应误判为半句 | 未触发 `merge_with_prev` |
| `consecutive-incomplete` | 连续极短半句，不应误触发 merge | 最终靠完整内容提交 |
| `low-info-interruption` | `嗯` / `掌声` 插入中间 | 被低信息过滤跳过 |

本轮结论：
- Phase 1/2 对现有 replay 样本无明显回归
- `merge_with_prev` 当前只在真正“半句 + 补完”场景触发
- 三条边界反例未出现误合并或误延迟
- `emptyOutputRatio` 继续记录，但没有 no-assembler A/B baseline 时，不应直接归因给 assembler

### 2026-05-08 离线回放对照测试

目的：用同一模型跑 with-assembler 和 no-assembler 两条路径，量化 assembler 对 structurer 调用行为和输出分布的影响。

#### 方法

1. 选取全部 8 条 `replay-realtime-*` fixture
2. 先跑 with-assembler（assembler 启用），诊断工件保存到 `artifacts/provider-instability/`
3. 再跑 no-assembler（`LISTEN_GRAPHIC_STRUCTURE_UNIT_ASSEMBLER_ENABLED=false`），诊断工件保存到 `no-assembler/` 子目录
4. 从诊断工件的 `fetchTraces` 中提取图谱指标进行对比

工具链：

| 工具 | 用途 |
|---|---|
| `scripts/run-structure-replay-strict.mjs` | with-assembler 路径 |
| `scripts/run-structure-replay-strict.mjs --no-assembler` | no-assembler 路径 |
| `scripts/compare-assembler-baseline.mjs` | 自动对比两条路径的诊断数据 |
| `pnpm test:structure:compare:baseline` | 一键运行完整对照流程 |

#### 结果（qwen3.5-397b-a17b）

| 指标 | With Assembler | No Assembler |
|------|---------------|--------------|
| structurer 调用次数 | 14 | 13 |
| 空输出比例 | 35.7% | 38.5% |
| 总 nodes | 35 | 21 |
| 总 edges | 27 | 15 |
| 每 call 平均 nodes | 2.5 | 1.62 |
| 每 call 平均 edges | 1.93 | 1.15 |

per-fixture 关键差异：

| Fixture | With (nodes/edges) | No (nodes/edges) | 说明 |
|---------|-------------------|------------------|------|
| `merge-with-prev-boundary` | 9 / 8 | 3 / 3 | assembler 的 merge 决策显著提升 |
| `ruyu-pang-zhan-opening` | 11 / 8 | 0 / 0 | 无 assembler 完全没产出有效图谱 |
| `debate-response-world` | 8 / 6 | 6 / 4 | assembler 略优 |
| 其余 5 个 | 相近 | 相近 | 差异不显著 |

#### 指标局限性

- **节点/边数量是最低成本的自动化 proxy，不等于质量**
- 更多节点可能是更全面的提取（好），也可能是冗余碎片化或幻觉（坏）
- 真正的质量评估需要：语义准确性、相关性、幻觉率等维度
- 当前对比只能回答"assembler 是否改变了输出行为"，不能完全回答"输出是否更好"

#### 结论

assembler 在相同模型下改变了 structurer 的调用行为和输出分布，主要体现在 merge-with-prev 决策和低信息片段过滤上。但当前指标不足以对"输出质量"做绝对判断，需要后续设计语义级评估方案。

因此当前验收口径是：

`Assembler Phase 1/2 verification passed; full replay baseline passed; offline comparison shows assembler changes output distribution; quality assessment requires semantic-level evaluation beyond node/edge counts.`

## 测试建议
assembler 的验证重点不应放在 E2E，而应放在 replay / fixture。

建议新增三类测试：

1. 纯规则单测
- 给定 utterance 序列
- 断言 decision 序列是否符合预期

2. transcript replay 回归
- 使用真实腾讯 realtime fixture
- 对比“直接按 stable utterance 送 structurer”与“assembler 后再送 structurer”的差异
- 重点看空跑率、空节点率、漏信息率

3. 可选小模型仲裁 mock 测试
- 验证超时、失败、非法 JSON 时能否回退程序规则

### KPI 对照要求
仅有“测试通过”还不够。Phase 1 合并前建议同时产出 KPI 对照结果：
- 首图延迟分位
- 每分钟 structurer 调用次数
- commit 后空输出比率
- 平均每个 structure unit 聚合的 utterance 数

这些指标建议由脚本自动汇总，而不是人工观察日志。

## 渐进落地建议
建议分三阶段：

### Phase 1
只上 programmatic assembler：
- pending buffer
- 分数
- 超时
- commit / wait

先不接小模型。
先不默认启用 `merge_with_prev`。
先不改变下游 timeline / camera-follow / debug 展示语义。

### Phase 2
加入 `merge_with_prev`：
- 对明显“上一句半截 + 下一句补完”的场景做组装

这一阶段需要同步讨论下游影响：
- `evidenceChunkIds` 如何映射到多个 source chunk
- timeline / camera-follow 如何从一个 structure unit 反解回时间区间
- debug/export 如何展示 transcript 与 structure unit 的关联

### Phase 3
只在临界边界接入小模型仲裁：
- 默认关闭
- 通过 provider setting 或 feature flag 手动开启

## 建议的默认参数
第一版可以先保守：
- `softWaitMs = 1800`
- `hardWaitMs = 4000`
- `minEffectiveCharsForCommit = 28`
- `maxBufferedUtterances = 3`
- `maxBufferedChars = 72`
- `llmBoundaryJudgeEnabled = false`

这些值应通过 replay fixture 调整，不应先当成产品常量。

## Feature Flag 与回滚策略
assembler 改变的是主链路节奏控制，因此第一版必须具备清晰的开关与回滚能力。

### 建议
- Phase 1 通过 feature flag 控制 assembler 是否启用
- 默认关闭
- 在 replay KPI 达标前，不建议直接作为默认主路径

### 推荐形态
至少具备一层：
- 全局 feature flag

更理想的是两层：
- 全局 feature flag
- 会话级或调试级 runtime 开关

### 最低要求
应能在调试信息中明确看到：
- 当前 session 是否启用了 assembler
- 当前使用的参数集
- 是否启用了小模型边界仲裁

这样才能保证：
- 联调时可控
- 出问题时可回滚
- 回归对照时可复现

## 风险与取舍

### 收益
- 减少明显半句直接进入 structurer
- 降低 incremental 空跑
- 改善“补足前文”的信息保留
- 降低让 structurer 兼任断句修复器的压力

### 代价
- 会引入少量额外延迟
- 规则过强可能导致提交过晚
- 规则过弱又会退回当前碎片问题
- 小模型仲裁若滥用，会让链路复杂度和成本上升

## 结论
本方案的关键不是“让程序理解语义”，而是承认 realtime ASR 的稳定 utterance 与 structurer 需要的输入单元不是同一个概念。

建议先在 service worker 中加入一层轻量 `programmatic assembler`，用状态机、弱信号、超时和少量拼接规则来生成 `structure unit`。在此基础上，仅对少数高歧义边界引入可选的小模型仲裁。

这比“每条 utterance 直接送 structurer”更稳，也比“再上一个完整 LLM 做二次结构化”更便宜、更可控。
