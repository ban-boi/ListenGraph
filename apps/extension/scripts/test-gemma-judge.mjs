// 实测 gemma-4-12b-qat 作为 LLM Judge 的能力
// 构造一段真实中文辩论 utterance + 两个有意差异的 graph，看它能否按 rubric 抓出缺陷
import process from 'node:process';

const BASE_URL = process.env.LM_STUDIO_BASE_URL?.trim() || 'http://localhost:1234/v1';
const MODEL = process.env.LM_STUDIO_MODEL?.trim() || 'google/gemma-4-12b-qat';

// 单个评分维度的 schema：graph1/graph2 各 1-5 分 + 理由
const dimSchema = {
  type: 'object',
  properties: {
    graph1: { type: 'integer', minimum: 1, maximum: 5 },
    graph2: { type: 'integer', minimum: 1, maximum: 5 },
    reason: { type: 'string' },
  },
  required: ['graph1', 'graph2', 'reason'],
  additionalProperties: false,
};

// 真实数据：来自 seg05 黄执中哲理辩（已脱敏，取核心几句）
const utterances = [
  { i: 1, text: '我个人看起来你请不要误会我并没有我并没有批判辩论这个活动', time: '408-415s' },
  { i: 2, text: '我自己也是辩论爱好者我是辩论的狂热者', time: '415-421s' },
  { i: 3, text: '可是时间久了以后我觉得我们比较像老顽童周伯通被困在桃花岛上没人跟他对战他就学会左右互搏左手跟右手打架', time: '421-441s' },
  { i: 4, text: '我们辩论的好多辩题其实都是自己在跟自己吵', time: '441-448s' },
];

// Graph1：高质量。覆盖核心论点（辩论爱好者的自我对抗），关系正确，无噪声节点
const graph1 = {
  nodes: [
    { id: 'n1', type: 'claim', text: '辩论爱好者容易陷入自我对抗' },
    { id: 'n2', type: 'reason', text: '时间久了像老顽童左右互搏，没人对话就自己跟自己吵' },
    { id: 'n3', type: 'example', text: '左手跟右手打架' },
  ],
  edges: [
    { sourceText: '时间久了像老顽童左右互搏，没人对话就自己跟自己吵', targetText: '辩论爱好者容易陷入自我对抗', type: 'supports' },
    { sourceText: '左手跟右手打架', targetText: '时间久了像老顽童左右互搏，没人对话就自己跟自己吵', type: 'example_of' },
  ],
};

// Graph2：故意劣化。口头禅变节点、连接词变节点、把反对标成支持、漏掉核心论点
const graph2 = {
  nodes: [
    { id: 'n1', type: 'claim', text: '我是辩论的狂热者' },
    { id: 'n2', type: 'reason', text: '我个人看起来' },
    { id: 'n3', type: 'example', text: '可是' },
    { id: 'n4', type: 'reason', text: '左手跟右手打架' },
  ],
  edges: [
    { sourceText: '可是', targetText: '我是辩论的狂热者', type: 'supports' },
    { sourceText: '我个人看起来', targetText: '我是辩论的狂热者', type: 'causes' },
    { sourceText: '左手跟右手打架', targetText: '我是辩论的狂热者', type: 'opposes' },
  ],
};

const systemPrompt = `你是一个知识图谱质量评审专家。对比两份从同一段语音转写生成的知识图谱，按固定 rubric 评分。严格输出 JSON，不要 markdown 代码块标记。`;

const userPrompt = `## 原始 ASR 转写
${utterances.map((u) => `${u.i}. ${u.text} (${u.time})`).join('\n')}

## Graph1
节点：
${graph1.nodes.map((n) => `- ${n.id} | ${n.type} | ${n.text}`).join('\n')}
边：
${graph1.edges.map((e) => `- ${e.sourceText} → ${e.targetText} | ${e.type}`).join('\n')}

## Graph2
节点：
${graph2.nodes.map((n) => `- ${n.id} | ${n.type} | ${n.text}`).join('\n')}
边：
${graph2.edges.map((e) => `- ${e.sourceText} → ${e.targetText} | ${e.type}`).join('\n')}

## 评分 Rubric（1-5 分）
- coverage：是否覆盖原始 utterances 的主要语义点（遗漏核心论点→扣分）
- faithfulness：节点文本是否忠实于原文（出现原文没说的→扣分）
- relationQuality：边类型是否准确（反驳标为 supports→扣分）
- noiseHandling：口头禅/连接词/碎片是否被过滤（变成节点→扣分）

## 输出格式（严格 JSON）
{
  "coverage": { "graph1": <1-5>, "graph2": <1-5>, "reason": "..." },
  "faithfulness": { "graph1": <1-5>, "graph2": <1-5>, "reason": "..." },
  "relationQuality": { "graph1": <1-5>, "graph2": <1-5>, "reason": "..." },
  "noiseHandling": { "graph1": <1-5>, "graph2": <1-5>, "reason": "..." },
  "preferred": "graph1" | "graph2" | "tie",
  "reason": "..."
}`;

async function main() {
  console.log(`模型: ${MODEL}`);
  console.log(`端点: ${BASE_URL}`);
  console.log('发送 judge 请求...\n');

  const start = Date.now();
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.3,
      max_tokens: 1500,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'judge_result',
          strict: true,
          schema: {
            type: 'object',
            properties: {
              coverage: dimSchema,
              faithfulness: dimSchema,
              relationQuality: dimSchema,
              noiseHandling: dimSchema,
              preferred: { type: 'string', enum: ['graph1', 'graph2', 'tie'] },
              reason: { type: 'string' },
            },
            required: ['coverage', 'faithfulness', 'relationQuality', 'noiseHandling', 'preferred', 'reason'],
            additionalProperties: false,
          },
        },
      },
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error(`HTTP ${res.status}: ${errText}`);
    process.exit(1);
  }

  const data = await res.json();
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  const content = data.choices?.[0]?.message?.content ?? '';
  const usage = data.usage ?? {};

  console.log(`耗时: ${elapsed}s | tokens: ${usage.total_tokens ?? '?'}\n`);
  console.log('=== 原始输出 ===');
  console.log(content);
  console.log('\n=== JSON 解析 ===');

  // 尝试解析 JSON
  let parsed = null;
  try {
    const startIdx = content.indexOf('{');
    const endIdx = content.lastIndexOf('}');
    if (startIdx >= 0 && endIdx > startIdx) {
      parsed = JSON.parse(content.slice(startIdx, endIdx + 1));
    } else {
      parsed = JSON.parse(content);
    }
    console.log('✅ JSON 解析成功\n');
    console.log(JSON.stringify(parsed, null, 2));
    evaluate(parsed);
  } catch (e) {
    console.log(`❌ JSON 解析失败: ${e.message}`);
    console.log('（这本身就是 judge 能力不足的信号）');
  }
}

// 评估 gemma 的判断是否符合预期（graph1 应明显优于 graph2）
function evaluate(parsed) {
  console.log('\n=== 质量评估（对照预期）===');
  const dims = ['coverage', 'faithfulness', 'relationQuality', 'noiseHandling'];
  let pass = 0;
  for (const dim of dims) {
    const g1 = parsed[dim]?.graph1;
    const g2 = parsed[dim]?.graph2;
    const ok = typeof g1 === 'number' && typeof g2 === 'number' && g1 > g2;
    if (ok) pass++;
    console.log(`- ${dim}: graph1=${g1} graph2=${g2} ${ok ? '✅ graph1>graph2' : '❌ 未正确区分'}`);
  }
  const pref = parsed.preferred;
  console.log(`- preferred: ${pref} ${pref === 'graph1' ? '✅ 选对了' : '❌ 选错/平局'}`);
  console.log(`\n总计: ${pass}/4 维度正确区分，偏好 ${pref === 'graph1' ? '正确' : '错误'}`);
}

main().catch((err) => {
  console.error('失败:', err.message);
  process.exit(1);
});
