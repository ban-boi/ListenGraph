// 探针：确认 cursor-agent 在 --output-format json 下的输出结构
// 这决定适配层怎么写（content 在哪个字段、有没有 agent 元数据包裹）
import { spawn } from 'node:child_process';

const PROBE_PROMPT = 'Reply with ONLY this exact JSON object and absolutely nothing else, no markdown, no explanation: {"probe":true,"n":42,"word":"hello"}';

const args = [
  '-p', PROBE_PROMPT,
  '--model', 'auto',
  '--mode', 'ask',
  '--output-format', 'json',
];

console.log('spawning cursor-agent...');
console.log(`args: ${args.join(' ').slice(0, 80)}...\n`);

const start = Date.now();
const child = spawn('cursor-agent', args, {
  shell: true,
  cwd: process.cwd(),
  env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
});

let stdout = '';
let stderr = '';

child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

child.on('error', (err) => {
  console.log(`\n[spawn error] ${err.message}`);
  console.log('（可能 cursor-agent 不在 PATH，或需要 cmd.exe 包装）');
});

child.on('exit', (code) => {
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`exit code: ${code} | 耗时: ${elapsed}s\n`);

  console.log('=== STDOUT (raw, first 2000 chars) ===');
  console.log(stdout.slice(0, 2000));
  console.log(`\n[stdout total length: ${stdout.length} chars]`);

  if (stderr.trim()) {
    console.log('\n=== STDERR (first 1000 chars) ===');
    console.log(stderr.slice(0, 1000));
  }

  // 尝试把整个 stdout 当 JSON 解析，看结构
  console.log('\n=== 结构分析 ===');
  const trimmed = stdout.trim();
  try {
    const parsed = JSON.parse(trimmed);
    console.log('stdout 整体是合法 JSON。顶层 keys:');
    console.log(Object.keys(parsed));
    console.log('\n各顶层字段类型/预览:');
    for (const [k, v] of Object.entries(parsed)) {
      const preview = typeof v === 'string' ? v.slice(0, 120) : JSON.stringify(v)?.slice(0, 120);
      console.log(`  ${k}: [${typeof v}] ${preview}`);
    }
  } catch {
    console.log('stdout 整体不是合法 JSON（可能是 stream-json 分片或纯文本包裹）');
    // 尝试找第一个 JSON 对象
    const s = stdout.indexOf('{');
    const e = stdout.lastIndexOf('}');
    if (s >= 0 && e > s) {
      try {
        const inner = JSON.parse(stdout.slice(s, e + 1));
        console.log(`但在 [${s}..${e}] 位置找到了内嵌 JSON，顶层 keys:`, Object.keys(inner));
      } catch (err2) {
        console.log(`内嵌提取也失败: ${err2.message}`);
      }
    }
  }
});
