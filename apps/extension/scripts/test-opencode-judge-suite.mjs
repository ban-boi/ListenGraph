// opencode judge 深度测试套件
// 考点：微妙差异分辨、等价图 tie 判断、跨多次运行的稳定性
//
// 关键背景（与 test-gemma-judge-suite.mjs 的差异）：
// opencode `run --format json` CLI 在 Node spawn 下会挂起（非 TTY/ConPTY 环境死锁），
// 但 `opencode serve` 的 HTTP API 完全可用且无 TTY 依赖。
// 本套件走 serve HTTP：POST /session → POST /session/<id>/message → 解析 assistant parts。
//
// 前置：先启动 `opencode serve --port 4199`（或其他端口）。
// case 定义 / prompt / rubric 与 gemma suite 完全一致，便于横向对比。
import process from 'node:process';

const SERVE_URL = process.env.OPENCODE_SERVE_URL?.trim() || 'http://127.0.0.1:4199';
const MODEL = process.env.OPENCODE_MODEL?.trim() || 'opencode/nemotron-3-ultra-free';
const REPEATS = Number(process.env.REPEATS?.trim() || '3');
const REQ_TIMEOUT_MS = Number(process.env.JUDGE_TIMEOUT?.trim() || '120000');

// 同一段真实中文辩论内容（seg05 黄执中），与 gemma suite 共享，控制变量
const utterances = [
  { i: 1, text: '我个人看起来你请不要误会我并没有我并没有批判辩论这个活动', time: '408-415s' },
  { i: 2, text: '我自己也是辩论爱好者我是辩论的狂热者', time: '415-421s' },
  { i: 3, text: '可是时间久了以后我觉得我们比较像老顽童周伯通被困在桃花岛上没人跟他对战他就学会左右互搏左手跟右手打架', time: '421-441s' },
  { i: 4, text: '我们辩论的好多辩题其实都是自己在跟自己吵', time: '441-448s' },
];

const systemPrompt = `你是一个知识图谱质量评审专家。对比两份从同一段语音转写生成的知识图谱，按固定 rubric 评分。严格输出 JSON，不要 markdown 代码块标记。`;

function buildUserPrompt(graph1, graph2) {
  return `## 原始 ASR 转写
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
- relationQuality：边类型是否准确（反驳标为 supports→扣分；因果与支持混用也要审视）
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
}

// ── Case A：对照题，好 vs 极差，预期明显区分 ──
const caseA = {
  name: 'A-对照(好vs极差)',
  expect: 'graph1 明显优于 graph2',
  graph1: {
    nodes: [
      { id: 'n1', type: 'claim', text: '辩论爱好者容易陷入自我对抗' },
      { id: 'n2', type: 'reason', text: '时间久了像老顽童左右互搏，没人对话就自己跟自己吵' },
      { id: 'n3', type: 'example', text: '左手跟右手打架' },
    ],
    edges: [
      { sourceText: '时间久了像老顽童左右互搏，没人对话就自己跟自己吵', targetText: '辩论爱好者容易陷入自我对抗', type: 'supports' },
      { sourceText: '左手跟右手打架', targetText: '时间久了像老顽童左右互搏，没人对话就自己跟自己吵', type: 'example_of' },
    ],
  },
  graph2: {
    nodes: [
      { id: 'n1', type: 'claim', text: '我是辩论的狂热者' },
      { id: 'n2', type: 'reason', text: '我个人看起来' },
      { id: 'n3', type: 'example', text: '可是' },
    ],
    edges: [
      { sourceText: '可是', targetText: '我是辩论的狂热者', type: 'supports' },
    ],
  },
};

// ── Case B：微妙差异。唯一差别：关系类型 supports vs causes ──
const caseB = {
  name: 'B-微妙(supports vs causes)',
  expect: 'relationQuality 上 graph1(supports) 应略优于 graph2(causes)；其余维度接近',
  graph1: {
    nodes: [
      { id: 'n1', type: 'claim', text: '辩论爱好者容易陷入自我对抗' },
      { id: 'n2', type: 'reason', text: '时间久了像老顽童左右互搏，自己跟自己吵' },
    ],
    edges: [
      { sourceText: '时间久了像老顽童左右互搏，自己跟自己吵', targetText: '辩论爱好者容易陷入自我对抗', type: 'supports' },
    ],
  },
  graph2: {
    nodes: [
      { id: 'n1', type: 'claim', text: '辩论爱好者容易陷入自我对抗' },
      { id: 'n2', type: 'reason', text: '时间久了像老顽童左右互搏，自己跟自己吵' },
    ],
    edges: [
      { sourceText: '时间久了像老顽童左右互搏，自己跟自己吵', targetText: '辩论爱好者容易陷入自我对抗', type: 'causes' },
    ],
  },
};

// ── Case C：等价/tie ──
const caseC = {
  name: 'C-等价(tie)',
  expect: 'preferred 应为 tie，各维度分差 ≤ 1',
  graph1: {
    nodes: [
      { id: 'n1', type: 'claim', text: '辩论爱好者容易陷入自我对抗' },
      { id: 'n2', type: 'example', text: '老顽童左右互搏，左手跟右手打架' },
    ],
    edges: [
      { sourceText: '老顽童左右互搏，左手跟右手打架', targetText: '辩论爱好者容易陷入自我对抗', type: 'example_of' },
    ],
  },
  graph2: {
    nodes: [
      { id: 'n1', type: 'claim', text: '长期辩论的人容易自己跟自己争论' },
      { id: 'n2', type: 'example', text: '周伯通在桃花岛上左右互搏' },
    ],
    edges: [
      { sourceText: '周伯通在桃花岛上左右互搏', targetText: '长期辩论的人容易自己跟自己争论', type: 'example_of' },
    ],
  },
};

const CASES = [caseA, caseB, caseC];

// ── serve HTTP 调用 ──
// opencode 不支持 response_format json_schema（免费模型路由限制），靠 prompt 强约束 + 解析兜底
async function callJudge(graph1, graph2) {
  const start = Date.now();

  // 1. 新建 session
  const sessRes = await fetchWithTimeout(
    `${SERVE_URL}/session`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
    REQ_TIMEOUT_MS,
  );
  if (!sessRes.ok) return { error: `POST /session ${sessRes.status}`, elapsed: (Date.now() - start) / 1000 };
  const { id: sid } = await sessRes.json();

  // 2. 发 message（system prompt 拼进 user prompt 第一段，opencode build agent 自带 system，硬覆盖会冲突）
  const userContent = `${systemPrompt}\n\n${buildUserPrompt(graph1, graph2)}`;
  const msgRes = await fetchWithTimeout(
    `${SERVE_URL}/session/${sid}/message`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parts: [{ type: 'text', text: userContent }] }),
    },
    REQ_TIMEOUT_MS,
  );
  if (!msgRes.ok) {
    return { error: `POST /message ${msgRes.status}: ${(await msgRes.text()).slice(0, 150)}`, elapsed: (Date.now() - start) / 1000 };
  }
  const msg = await msgRes.json();
  const elapsed = (Date.now() - start) / 1000;

  // 3. 取 assistant 文本 + token
  const parts = msg.parts || [];
  const text = parts.filter((p) => p.type === 'text').map((p) => p.text).join('');
  const tokens = msg.info?.tokens;

  // 4. 解析 JSON（模型可能裹 markdown 代码块）
  try {
    const s = text.indexOf('{');
    const e = text.lastIndexOf('}');
    if (s < 0 || e < s) return { error: '响应不含 JSON', raw: text.slice(0, 200), elapsed, tokens };
    const parsed = JSON.parse(text.slice(s, e + 1));
    return { parsed, elapsed, tokens };
  } catch (err) {
    return { error: `JSON 解析失败: ${err.message}`, raw: text.slice(0, 200), elapsed, tokens };
  }
}

function fetchWithTimeout(url, opts, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { ...opts, signal: ctrl.signal }).finally(() => clearTimeout(timer));
}

async function main() {
  console.log(`后端: opencode serve ${SERVE_URL} | 模型: ${MODEL} | 每个 case 重复 ${REPEATS} 次\n`);
  console.log(`共 ${CASES.length} 个 case × ${REPEATS} 次 = ${CASES.length * REPEATS} 次请求\n`);

  const results = {};
  for (const tc of CASES) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Case ${tc.name}`);
    console.log(`预期: ${tc.expect}`);
    console.log('='.repeat(60));

    results[tc.name] = { runs: [], prefs: [], scores: {} };
    const dims = ['coverage', 'faithfulness', 'relationQuality', 'noiseHandling'];
    dims.forEach((d) => (results[tc.name].scores[d] = { graph1: [], graph2: [] }));

    for (let i = 1; i <= REPEATS; i++) {
      process.stdout.write(`  run ${i}/${REPEATS} ... `);
      const r = await callJudge(tc.graph1, tc.graph2);
      if (r.error) {
        console.log(`❌ ${r.error}`);
        results[tc.name].runs.push({ run: i, error: r.error, raw: r.raw });
        continue;
      }
      const p = r.parsed;
      const pref = p.preferred;
      results[tc.name].runs.push({
        run: i,
        elapsed: r.elapsed.toFixed(1),
        tokens: r.tokens,
        preferred: pref,
        scores: dims.reduce((acc, d) => {
          acc[d] = `${p[d]?.graph1}/${p[d]?.graph2}`;
          return acc;
        }, {}),
      });
      results[tc.name].prefs.push(pref);
      dims.forEach((d) => {
        results[tc.name].scores[d].graph1.push(p[d]?.graph1);
        results[tc.name].scores[d].graph2.push(p[d]?.graph2);
      });
      const scoreStr = dims.map((d) => `${d.slice(0, 4)}=${p[d]?.graph1}/${p[d]?.graph2}`).join(' ');
      console.log(`${r.elapsed.toFixed(0)}s | ${pref} | ${scoreStr}`);
    }
  }

  // ── 汇总 ──
  console.log('\n\n');
  console.log('#'.repeat(60));
  console.log('#  汇总分析');
  console.log('#'.repeat(60));

  for (const tc of CASES) {
    const r = results[tc.name];
    console.log(`\n## ${tc.name}`);
    console.log(`预期: ${tc.expect}`);

    const prefCounts = r.prefs.reduce((acc, p) => ((acc[p] = (acc[p] || 0) + 1), acc), {});
    const prefList = r.prefs.join(',');
    const consistent = Object.keys(prefCounts).length === 1;
    console.log(`preferred 序列: [${prefList}] ${consistent ? '✅ 一致' : '⚠️ 不稳定'}`);
    console.log(`  分布: ${JSON.stringify(prefCounts)}`);

    const dims = ['coverage', 'faithfulness', 'relationQuality', 'noiseHandling'];
    for (const d of dims) {
      const g1 = r.scores[d].graph1.filter((x) => typeof x === 'number');
      const g2 = r.scores[d].graph2.filter((x) => typeof x === 'number');
      if (g1.length === 0) continue;
      const stats = (arr) => {
        const min = Math.min(...arr);
        const max = Math.max(...arr);
        const mean = (arr.reduce((s, x) => s + x, 0) / arr.length).toFixed(1);
        return `${arr.join(',')} (min=${min} max=${max} 均值=${mean} 极差=${max - min})`;
      };
      const g1Consistent = Math.max(...g1) - Math.min(...g1) <= 1;
      const mark = g1Consistent ? '✅' : '⚠️波动';
      console.log(`  ${d}: graph1=${stats(g1)} ${mark} | graph2=${stats(g2)}`);
    }
  }

  console.log('\n完成。');
}

main().catch((err) => {
  console.error('套件失败:', err.message);
  console.error('（确认 opencode serve 已启动：opencode serve --port 4199）');
  process.exit(1);
});
