// gemma-4-12b-qat structurer test
// real openai-structurer.ts system prompt + real Chinese debate text
import process from 'node:process';

const BASE_URL = process.env.LM_STUDIO_BASE_URL?.trim() || 'http://localhost:1234/v1';
const MODEL = process.env.LM_STUDIO_MODEL?.trim() || 'google/gemma-4-12b-qat';
const REPEATS = Number(process.env.REPEATS?.trim() || '3');

const SYSTEM_PROMPT = [
  'You are a strict JSON structurer for ListenGraph.',
  'Return only one JSON object. No markdown, no explanation, no code fences.',
  'The JSON shape must be exactly:',
  '{"topic":"string","nodes":[{"id":"n1","type":"claim","text":"short text"}],"edges":[{"source":"n1","target":"n2","type":"supports"}]}',
  'Allowed node types: claim, reason, example, question, conclusion.',
  'Allowed edge types: supports, opposes, causes, follows, example_of.',
  'Node text must be concise, atomic, and must not include timestamps.',
  'If there is not enough new information, return {"topic":"","nodes":[],"edges":[]}.',
  'When mode is bootstrap, summarize the full window into useful nodes.',
  'Treat recentGraphContext as frozen semantics from earlier in the session.',
  'Preserve explicit names, titles, and concrete quoted terms from the transcript when they matter, especially person names, show names, and debate/topic labels.',
  'Do not replace explicit names or concrete terms with vague abstractions when the literal wording carries meaning.',
  'Avoid repeating the same event, debate topic, example, or claim with different wording.',
].join(' ');

const WINDOW_TRANSCRIPT = [
  '[408640-415240] 我个人看起来你请不要误会我并没有我并没有批判辩论这个活动',
  '[415240-421240] 我自己也是辩论爱好者我是辩论的狂热者',
  '[421240-441640] 可是时间久了以后我觉得我们比较像老顽童周伯通被困在桃花岛上没人跟他对战他就学会左右互搏左手跟右手打架',
  '[441640-448640] 我们辩论的好多辩题其实都是自己在跟自己吵',
].join('\n');

const SCHEMA = {
  type: 'object',
  properties: {
    topic: { type: 'string' },
    nodes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          type: { type: 'string', enum: ['claim', 'reason', 'example', 'question', 'conclusion'] },
          text: { type: 'string' },
        },
        required: ['id', 'type', 'text'],
        additionalProperties: false,
      },
    },
    edges: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          source: { type: 'string' },
          target: { type: 'string' },
          type: { type: 'string', enum: ['supports', 'opposes', 'causes', 'follows', 'example_of'] },
        },
        required: ['source', 'target', 'type'],
        additionalProperties: false,
      },
    },
  },
  required: ['topic', 'nodes', 'edges'],
  additionalProperties: false,
};

function buildUserPrompt() {
  return JSON.stringify({
    language: 'zh',
    mode: 'bootstrap',
    windowTranscript: WINDOW_TRANSCRIPT,
    latestChunkTranscript: '[441640-448640] 我们辩论的好多辩题其实都是自己在跟自己吵',
    recentGraphContext: [],
    previousGraphSummary: null,
  });
}

async function callStructurer() {
  const start = Date.now();
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildUserPrompt() },
      ],
      temperature: 0.1,
      max_tokens: 1200,
      response_format: { type: 'json_schema', json_schema: { name: 'segment_graph', strict: true, schema: SCHEMA } },
    }),
  });

  if (!res.ok) {
    return { error: `HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`, elapsed: (Date.now() - start) / 1000 };
  }
  const data = await res.json();
  const elapsed = (Date.now() - start) / 1000;
  const content = data.choices?.[0]?.message?.content ?? '';
  try {
    const s = content.indexOf('{');
    const e = content.lastIndexOf('}');
    const parsed = JSON.parse(s >= 0 ? content.slice(s, e + 1) : content);
    return { parsed, elapsed, tokens: data.usage?.total_tokens };
  } catch (err) {
    return { error: `JSON parse fail: ${err.message}`, raw: content.slice(0, 300), elapsed };
  }
}

function audit(parsed) {
  const issues = [];
  const passes = [];
  const { topic, nodes, edges } = parsed;

  if (topic && topic.length > 2) passes.push(`topic ok: "${topic.slice(0, 30)}"`);
  else if (!topic) issues.push('topic empty');
  else issues.push(`topic too short: "${topic}"`);

  const validNodeTypes = new Set(['claim', 'reason', 'example', 'question', 'conclusion']);
  const badNodeTypes = nodes.filter((n) => !validNodeTypes.has(n.type));
  if (badNodeTypes.length) issues.push(`${badNodeTypes.length} invalid node type(s)`);
  else passes.push(`all node types valid (${nodes.length})`);

  const nodeIds = new Set(nodes.map((n) => n.id));
  const danglingEdges = edges.filter((e) => !nodeIds.has(e.source) || !nodeIds.has(e.target));
  if (danglingEdges.length) issues.push(`${danglingEdges.length} dangling edge(s)`);
  else if (edges.length > 0) passes.push(`all edges reference existing node ids (${edges.length})`);
  else issues.push('no edges (disconnected graph)');

  const allText = nodes.map((n) => n.text).join('');
  const properNouns = ['周伯通', '桃花岛', '左右互搏', '老顽童'];
  const preserved = properNouns.filter((p) => allText.includes(p));
  if (preserved.length >= 2) passes.push(`proper nouns kept: ${preserved.join('/')}`);
  else issues.push(`proper nouns lost (kept: ${preserved.join('/') || 'none'})`);

  const hallucinationHints = ['人工智能', '区块链', '股票', '天气', '互联网'];
  const hallucinated = hallucinationHints.filter((h) => allText.includes(h));
  if (hallucinated.length) issues.push(`possible hallucination: ${hallucinated.join('/')}`);

  const coreClaim = /自己跟自己|自我对抗|左手.*右手|内部.*争论/.test(allText);
  if (coreClaim) passes.push('core claim captured (debater self-opposition)');
  else issues.push('core claim missed (self-opposition)');

  const noiseNodes = nodes.filter((n) => /^(可是|我个人看起来|然后|那个|嗯|啊)$/.test(n.text.trim()));
  if (noiseNodes.length) issues.push(`${noiseNodes.length} filler/noise node(s)`);
  else passes.push('filler/noise filtered');

  const causesEdges = edges.filter((e) => e.type === 'causes');
  const supportsEdges = edges.filter((e) => e.type === 'supports');
  if (causesEdges.length > 0 && supportsEdges.length === 0) {
    issues.push(`only causes no supports (${causesEdges.length}) — this segment is reason-supports-claim, should favor supports`);
  } else if (supportsEdges.length > 0) {
    passes.push(`uses supports (${supportsEdges.length}, appropriate)`);
  }

  return { passes, issues };
}

async function main() {
  console.log(`model: ${MODEL} | endpoint: ${BASE_URL} | bootstrap x ${REPEATS}`);
  console.log(`structurer prompt = real openai-structurer.ts system prompt`);
  console.log(`input window:\n${WINDOW_TRANSCRIPT}\n`);

  const runs = [];
  for (let i = 1; i <= REPEATS; i++) {
    process.stdout.write(`run ${i}/${REPEATS} ... `);
    const r = await callStructurer();
    if (r.error) {
      console.log(`FAIL ${r.error}`);
      runs.push({ run: i, error: r.error });
      continue;
    }
    const a = audit(r.parsed);
    runs.push({
      run: i,
      elapsed: r.elapsed.toFixed(0),
      tokens: r.tokens,
      topic: r.parsed.topic,
      nodeCount: r.parsed.nodes.length,
      edgeCount: r.parsed.edges.length,
      parsed: r.parsed,
      audit: a,
    });
    console.log(`${r.elapsed.toFixed(0)}s | topic="${(r.parsed.topic || '').slice(0, 20)}" | nodes=${r.parsed.nodes.length} edges=${r.parsed.edges.length} | pass${a.passes.length} fail${a.issues.length}`);
  }

  const first = runs.find((r) => r.parsed);
  if (first) {
    console.log(`\n${'='.repeat(60)}\nrun 1 output (full)\n${'='.repeat(60)}`);
    console.log(JSON.stringify(first.parsed, null, 2));
    console.log(`\n--- audit ---`);
    first.audit.passes.forEach((p) => console.log(`PASS ${p}`));
    first.audit.issues.forEach((x) => console.log(`FAIL ${x}`));
  }

  const valid = runs.filter((r) => r.parsed);
  if (valid.length >= 2) {
    console.log(`\n${'='.repeat(60)}\nstability across ${valid.length} runs\n${'='.repeat(60)}`);
    const nodeCounts = valid.map((r) => r.nodeCount);
    const edgeCounts = valid.map((r) => r.edgeCount);
    const topics = valid.map((r) => r.topic);
    const ncRange = Math.max(...nodeCounts) - Math.min(...nodeCounts);
    const ecRange = Math.max(...edgeCounts) - Math.min(...edgeCounts);
    const topicStable = new Set(topics).size === 1;
    console.log(`nodeCount: [${nodeCounts}] range=${ncRange} ${ncRange <= 1 ? 'OK' : 'UNSTABLE'}`);
    console.log(`edgeCount:  [${edgeCounts}] range=${ecRange} ${ecRange <= 1 ? 'OK' : 'UNSTABLE'}`);
    console.log(`topic:      ${topicStable ? 'OK consistent' : 'UNSTABLE'} [${topics.map((t) => `"${(t || '').slice(0, 15)}"`).join(', ')}]`);
  }

  console.log('\ndone.');
}

main().catch((err) => {
  console.error('failed:', err.message);
  process.exit(1);
});
