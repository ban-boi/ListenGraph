import fs from 'node:fs';
import path from 'node:path';
import type { Annotation } from './types';

const METRICS_DIR = path.resolve(import.meta.dirname, '../outputs/metrics');
const SIMPLIFIED_DIR = path.resolve(import.meta.dirname, '../outputs/simplified');
const SCREENSHOT_DIR = path.resolve(import.meta.dirname, '../outputs/screenshots');
const OUTPUT_DIR = path.resolve(import.meta.dirname, '../outputs/annotations');

// 后端类型：openai（OpenAI 兼容 /chat/completions，需 key）| opencode-serve（免费模型，无需 key）
// opencode-serve 复用仓库 judge-acceptance.mjs 的 session/message 调用方式，
// 走纯文本（免费模型不支持图片），适合无 API key 时跑通管线。
const PROVIDER = process.env.LAYOUT_LAB_LLM_PROVIDER ?? 'opencode-serve';
const MODEL = process.env.LAYOUT_LAB_LLM_MODEL ?? 'opencode/nemotron-3-ultra-free';
const API_KEY = process.env.LAYOUT_LAB_LLM_API_KEY ?? '';
const BASE_URL = process.env.LAYOUT_LAB_LLM_BASE_URL ?? 'https://api.openai.com/v1';
const OPENCODE_SERVE_URL = process.env.OPENCODE_SERVE_URL ?? 'http://127.0.0.1:4199';
const MAX_RETRIES = parseInt(process.env.LAYOUT_LAB_MAX_RETRIES ?? '3', 10);

const SYSTEM_PROMPT = `你是图谱可读性诊断助手。对一张语义图，分别判断：
1. semanticReading：语义上像什么（争论/解释/因果/多话题/修正/时间线/其他）。主要基于 graph JSON + 指标。
2. layoutFailures：当前空间布局的阅读问题（数组，可多个）。重点看截图 + longLabelNodeCount/isLargeGraph。
3. detectorMismatch：对照 detector 命中 vs 你的 semanticReading，detector 是否误导。
4. visualTreatment：需要什么视觉处理。
5. confidence：high/medium/low。
严格按 JSON schema 输出，不要额外解释。`;

// 构建给 LLM 的文本 prompt（两个后端共用：openai 拼进 content[0].text，opencode 拼进 user 消息）
function buildTextPrompt(
  simplified: { simplified: unknown },
  metrics: { metrics: unknown; detector: unknown },
): string {
  return `${SYSTEM_PROMPT}\n\n--- graph JSON ---\n${JSON.stringify(simplified.simplified)}\n\n--- metrics ---\n${JSON.stringify(metrics.metrics)}\n--- detector ---\n${JSON.stringify(metrics.detector)}\n\n只输出一个 JSON 对象，字段：semanticReading(字符串), layoutFailures(字符串数组), detectorMismatch(布尔), detectorHitNote(字符串,可选), visualTreatment(字符串), confidence("high"|"medium"|"low")。不要 markdown 代码块，不要额外解释。`;
}

// 宽松 JSON 解析：模型可能裹 ```json 代码块或带多余文本，尝试提取首个 {...} 块
function parseAnnotationJson(raw: string, index: number): Annotation {
  let text = raw.trim();
  // 去掉 markdown 代码块包裹
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) text = codeBlockMatch[1].trim();
  // 提取首个 { 到最后一个 } 的片段
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    text = text.slice(start, end + 1);
  }
  const parsed = JSON.parse(text);
  return { graphIndex: index, ...parsed };
}

// opencode-serve 后端：复用 judge-acceptance.mjs 的 session/message 调用方式
// 走纯文本（免费模型不支持图片），system prompt 拼进 user 消息（serve 自带 build agent system）
async function callOpencodeServe(userPrompt: string, index: number): Promise<Annotation> {
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      // 1. 建 session
      const sessRes = await fetch(`${OPENCODE_SERVE_URL}/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      if (!sessRes.ok) {
        throw new Error(`serve POST /session 返回 ${sessRes.status}（确认 opencode serve 已启动: ${OPENCODE_SERVE_URL}）`);
      }
      const sessJson = await sessRes.json();
      const sid = sessJson.id;

      // 2. 发 message
      const msgRes = await fetch(`${OPENCODE_SERVE_URL}/session/${sid}/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parts: [{ type: 'text', text: userPrompt }] }),
      });
      if (!msgRes.ok) {
        const detail = (await msgRes.text()).slice(0, 200);
        throw new Error(`serve POST /message 返回 ${msgRes.status}: ${detail}`);
      }
      const msgJson = await msgRes.json();
      const parts = msgJson?.parts ?? [];
      const content = parts
        .filter((p: { type: string }) => p.type === 'text')
        .map((p: { text: string }) => p.text)
        .join('');
      if (!content.trim()) {
        throw new Error('serve 返回空内容（assistant 无 text part）');
      }
      return parseAnnotationJson(content, index);
    } catch (err) {
      lastErr = err as Error;
      if (attempt < MAX_RETRIES) {
        console.warn(`  ↻ opencode-serve 第 ${attempt + 1} 次失败: ${(err as Error).message}，重试...`);
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      }
    }
  }
  throw new Error(`opencode-serve 重试 ${MAX_RETRIES} 次仍失败: ${lastErr?.message ?? '未知错误'}`);
}

// openai 兼容后端：支持多模态（图片）
async function callOpenai(
  textPrompt: string,
  index: number,
  hasScreenshot: boolean,
): Promise<Annotation> {
  const padded = String(index).padStart(2, '0');
  const content: unknown[] = [{ type: 'text', text: textPrompt }];
  if (hasScreenshot) {
    const imgPath = path.join(SCREENSHOT_DIR, `${padded}.png`);
    if (fs.existsSync(imgPath)) {
      const b64 = fs.readFileSync(imgPath).toString('base64');
      content.push({ type: 'image_url', image_url: { url: `data:image/png;base64,${b64}` } });
    }
  }
  const resp = await fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: 'user', content }],
      response_format: { type: 'json_object' },
    }),
  });
  if (!resp.ok) throw new Error(`LLM 请求失败 ${resp.status}: ${await resp.text()}`);
  const data = await resp.json();
  return parseAnnotationJson(data.choices[0].message.content, index);
}

export async function annotateOne(
  index: number,
  hasScreenshot: boolean,
): Promise<Annotation> {
  const padded = String(index).padStart(2, '0');
  const metrics = JSON.parse(fs.readFileSync(path.join(METRICS_DIR, `${padded}.json`), 'utf8'));
  const simplified = JSON.parse(fs.readFileSync(path.join(SIMPLIFIED_DIR, `${padded}.json`), 'utf8'));
  const textPrompt = buildTextPrompt(simplified, metrics);

  if (PROVIDER === 'opencode-serve') {
    // opencode-serve 走纯文本（免费模型不支持图片），忽略 hasScreenshot
    return callOpencodeServe(textPrompt, index);
  }
  return callOpenai(textPrompt, index, hasScreenshot);
}

export async function annotateAll(hasScreenshot = true): Promise<void> {
  // opencode-serve 不需要 API key；openai 后端需要
  if (PROVIDER === 'openai' && !API_KEY) {
    console.error(
      '[annotate] 错误：PROVIDER=openai 但未设置 LAYOUT_LAB_LLM_API_KEY。\n' +
        '设置方法（PowerShell）：$env:LAYOUT_LAB_LLM_API_KEY=\'sk-...\'\n' +
        '或改用免费后端：$env:LAYOUT_LAB_LLM_PROVIDER=\'opencode-serve\'（需先 opencode serve --port 4199）',
    );
    process.exit(1);
  }
  if (PROVIDER === 'opencode-serve') {
    console.log(`[annotate] 后端: opencode-serve | serve: ${OPENCODE_SERVE_URL} | 模型: ${MODEL} | 纯文本模式（无图片）`);
  } else {
    console.log(`[annotate] 后端: openai | 模型: ${MODEL} | 截图输入: ${hasScreenshot ? '是' : '否'}`);
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const metricFiles = fs
    .readdirSync(METRICS_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort();

  for (const f of metricFiles) {
    const index = parseInt(f, 10);
    const padded = String(index).padStart(2, '0');
    const outPath = path.join(OUTPUT_DIR, `${padded}.json`);
    if (fs.existsSync(outPath)) {
      console.log(`[annotate] ${padded} 已存在，跳过`);
      continue;
    }
    try {
      const ann = await annotateOne(index, hasScreenshot);
      fs.writeFileSync(outPath, JSON.stringify(ann, null, 2));
      console.log(`[annotate] ${padded} done confidence=${ann.confidence}`);
    } catch (e) {
      console.error(`[annotate] ${padded} 失败:`, (e as Error).message);
    }
  }
}

// CLI：--no-screenshot 跳过截图输入（降级纯文本模式）
const noShot = process.argv.includes('--no-screenshot');
void annotateAll(!noShot);
