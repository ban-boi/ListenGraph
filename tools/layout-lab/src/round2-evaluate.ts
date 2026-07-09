import fs from 'node:fs';
import path from 'node:path';
import type { MergedGraph } from '@listen-graphic/schema';
import { computeBaselinePositions } from './baseline-layout';
import { computeClusterLayoutA } from './cluster-layout';
import { computeClusterLayoutB } from './cluster-overview';

const METRICS_DIR = path.resolve(import.meta.dirname, '../outputs/metrics');
const SIMPLIFIED_DIR = path.resolve(import.meta.dirname, '../outputs/simplified');
const DUMP_PATH = path.resolve(import.meta.dirname, '../inputs/real-graphs-dump.json');
const OUTPUT_PATH = path.resolve(import.meta.dirname, '../outputs/round2-llm-eval.json');

const OPENCODE_SERVE_URL = process.env.OPENCODE_SERVE_URL ?? 'http://127.0.0.1:4199';
const MODEL = process.env.LAYOUT_LAB_LLM_MODEL ?? 'opencode/deepseek-v4-flash-free';
const MAX_RETRIES = 3;

const SAMPLE_INDICES = [
  49, 41, 48, 34, 47, 40, 29, 28, 39, 61, 31, 46,
  37, 32, 58, 57,
  18, 21, 16, 12, 6,
  33, 51,
];

const SYSTEM_PROMPT = `你是图谱布局评审助手。对一张图的三个布局候选做纯文本评审（你看不到截图）。
只回答三个问题：
1. cluster 分区是否符合 graph 结构？（是否过度拆分/合并不当）
2. 哪些图不适合 cluster-first？（如真实争论、纯因果链）
3. baseline vs candidate A/B 的语义组织哪个更清晰？
只输出 JSON：{"partitionReasonable": bool, "unsuitableForCluster": bool, "unsuitableReason": string, "semanticOrgWinner": "baseline"|"A"|"B"|"tie", "note": string}`;

function buildPrompt(graphIndex: number, baselineMeta: unknown, aMeta: unknown, bMeta: unknown): string {
  const padded = String(graphIndex).padStart(2, '0');
  const simplified = JSON.parse(fs.readFileSync(path.join(SIMPLIFIED_DIR, `${padded}.json`), 'utf8'));
  return `${SYSTEM_PROMPT}\n\n--- graph JSON ---\n${JSON.stringify(simplified.simplified)}\n--- baseline meta ---\n${JSON.stringify(baselineMeta)}\n--- candidate A meta ---\n${JSON.stringify(aMeta)}\n--- candidate B meta ---\n${JSON.stringify(bMeta)}\n只输出 JSON，不要 markdown。`;
}

async function callOpencodeServe(prompt: string): Promise<string> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const sr = await fetch(`${OPENCODE_SERVE_URL}/session`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
      });
      if (!sr.ok) throw new Error(`serve /session ${sr.status}`);
      const sj = await sr.json();
      const mr = await fetch(`${OPENCODE_SERVE_URL}/session/${sj.id}/message`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parts: [{ type: 'text', text: prompt }] }),
      });
      if (!mr.ok) throw new Error(`serve /message ${mr.status}`);
      const mj = await mr.json();
      const content = (mj?.parts ?? []).filter((p: { type: string }) => p.type === 'text').map((p: { text: string }) => p.text).join('');
      if (!content.trim()) throw new Error('空内容');
      return content;
    } catch (e) {
      if (attempt < MAX_RETRIES) {
        console.warn(`  ↻ 第 ${attempt + 1} 次失败: ${(e as Error).message}`);
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      }
    }
  }
  throw new Error('重试耗尽');
}

export async function evaluateRound2(): Promise<void> {
  const dump = JSON.parse(fs.readFileSync(DUMP_PATH, 'utf8')) as MergedGraph[];
  const results: unknown[] = [];

  for (const idx of SAMPLE_INDICES) {
    const graph = dump[idx];
    if (!graph) continue;
    const baseline = computeBaselinePositions(graph, idx);
    const a = computeClusterLayoutA(graph, idx);
    const b = computeClusterLayoutB(graph, idx);
    const prompt = buildPrompt(idx, baseline.meta, a.meta, b.meta);

    try {
      const raw = await callOpencodeServe(prompt);
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw.replace(/```json\n?/g, '').replace(/```/g, '').trim());
      } catch {
        parsed = { raw };
      }
      results.push({ graphIndex: idx, eval: parsed });
      console.log(`[eval] #${idx} done`);
    } catch (e) {
      results.push({ graphIndex: idx, error: (e as Error).message });
      console.error(`[eval] #${idx} 失败: ${(e as Error).message}`);
    }
  }

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(results, null, 2));
  console.log(`[eval] 完成 → outputs/round2-llm-eval.json (${results.length} 条)`);
}

void evaluateRound2();
