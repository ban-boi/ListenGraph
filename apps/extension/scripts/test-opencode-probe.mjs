// 探针（修正版）：opencode `run --format json` 输出的是 NDJSON 事件流，
// 不是单个 JSON 对象。必须按行 parse，累积 type:"text" 的 part.text，
// 从 type:"step_finish" 的 part.tokens 取 token。
// 旧版用 JSON.parse(整段 stdout) 会失败并误判为"卡死/无输出"——这是 opencode 探测的核心修复点。
import { spawn } from 'node:child_process';

const WORK_DIR = process.env.OPENCODE_CWD?.trim() || 'C:\\Users\\finni\\Desktop\\ListenGraph';
const MODEL = process.env.OPENCODE_MODEL?.trim() || 'opencode/nemotron-3-ultra-free';
const PROMPT = '只回答数字：1加1等于几？';
const TIMEOUT_MS = Number(process.env.PROBE_TIMEOUT?.trim() || '90000');

console.log(`model: ${MODEL}`);
console.log(`cwd: ${WORK_DIR}`);
console.log(`prompt: ${PROMPT}`);
console.log(`timeout: ${TIMEOUT_MS}ms\n`);

const start = Date.now();
const child = spawn(
  'opencode',
  ['run', '-m', MODEL, '--format', 'json', '--dangerously-skip-permissions', PROMPT],
  { cwd: WORK_DIR, shell: true, env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' } },
);

let stdout = '';
let stderr = '';
let killed = false;

child.stdout.on('data', (c) => { stdout += c.toString(); });
child.stderr.on('data', (c) => { stderr += c.toString(); });

const timer = setTimeout(() => {
  killed = true;
  try { child.kill('SIGKILL'); } catch {}
  console.log(`⏱ TIMEOUT ${TIMEOUT_MS}ms — opencode 卡住被 kill`);
}, TIMEOUT_MS);

child.on('error', (err) => {
  clearTimeout(timer);
  console.log(`[spawn error] ${err.message}`);
});

child.on('exit', (code) => {
  clearTimeout(timer);
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`exit code: ${code} | 耗时: ${elapsed}s | killed=${killed}\n`);

  // ── 核心修复：按行 parse NDJSON 事件流 ──
  const lines = stdout.split(/\r?\n/).filter((l) => l.trim().startsWith('{'));
  console.log(`=== 事件流：共 ${lines.length} 个 JSON 事件 ===`);

  let textAccum = '';
  let tokens = null;
  const types = [];
  for (const line of lines) {
    let evt;
    try { evt = JSON.parse(line); } catch { continue; }
    types.push(evt.type);
    if (evt.type === 'text' && evt.part?.text) textAccum += evt.part.text;
    if (evt.type === 'step_finish' && evt.part?.tokens) tokens = evt.part.tokens;
  }
  console.log(`事件类型序列: ${types.join(' → ')}`);
  console.log(`\n累积文本响应: ${JSON.stringify(textAccum) || '(空)'}`);

  console.log('\n=== token 经济性分析 ===');
  if (tokens) {
    const inp = tokens.input ?? 0;
    const out = tokens.output ?? 0;
    console.log(`inputTokens=${inp} | outputTokens=${out} | total=${tokens.total}`);
    if (inp > 0 && inp < 5000) console.log(`✅ inputTokens=${inp} → 干净推理，没塞工作区上下文，免费额度耐用`);
    else if (inp >= 5000 && inp < 20000) console.log(`⚠️ inputTokens=${inp} → 像塞了 agent 框架上下文（与 cursor ~28000 对比仍更省）`);
    else if (inp >= 20000) console.log(`⚠️ inputTokens=${inp} → 与 cursor 同档（框架开销）`);
  } else {
    console.log('（无 step_finish.tokens，无法判断 token——可能事件流被截断）');
    console.log('=== STDOUT (raw, first 1500) ===');
    console.log(stdout.slice(0, 1500));
    if (stderr.trim()) {
      console.log('\n=== STDERR (first 800) ===');
      console.log(stderr.slice(0, 800));
    }
  }
});
