import fs from 'node:fs';
import path from 'node:path';
import type { Annotation } from './types';

const METRICS_DIR = path.resolve(import.meta.dirname, '../outputs/metrics');
const SIMPLIFIED_DIR = path.resolve(import.meta.dirname, '../outputs/simplified');
const SCREENSHOT_DIR = path.resolve(import.meta.dirname, '../outputs/screenshots');
const OUTPUT_DIR = path.resolve(import.meta.dirname, '../outputs/annotations');

// 可配置 provider（spec 5.4）。默认 openai 兼容接口。
const PROVIDER = process.env.LAYOUT_LAB_LLM_PROVIDER ?? 'openai';
const MODEL = process.env.LAYOUT_LAB_LLM_MODEL ?? 'gpt-4o';
const API_KEY = process.env.LAYOUT_LAB_LLM_API_KEY ?? '';
const BASE_URL = process.env.LAYOUT_LAB_LLM_BASE_URL ?? 'https://api.openai.com/v1';

const SYSTEM_PROMPT = `你是图谱可读性诊断助手。对一张语义图，分别判断：
1. semanticReading：语义上像什么（争论/解释/因果/多话题/修正/时间线/其他）。主要基于 graph JSON + 指标。
2. layoutFailures：当前空间布局的阅读问题（数组，可多个）。重点看截图 + longLabelNodeCount/isLargeGraph。
3. detectorMismatch：对照 detector 命中 vs 你的 semanticReading，detector 是否误导。
4. visualTreatment：需要什么视觉处理。
5. confidence：high/medium/low。
严格按 JSON schema 输出，不要额外解释。`;

export async function annotateOne(
  index: number,
  hasScreenshot: boolean,
): Promise<Annotation> {
  const padded = String(index).padStart(2, '0');
  const metrics = JSON.parse(
    fs.readFileSync(path.join(METRICS_DIR, `${padded}.json`), 'utf8'),
  );
  const simplified = JSON.parse(
    fs.readFileSync(path.join(SIMPLIFIED_DIR, `${padded}.json`), 'utf8'),
  );

  const content: unknown[] = [
    {
      type: 'text',
      text: `${SYSTEM_PROMPT}\n\n--- graph JSON ---\n${JSON.stringify(simplified.simplified)}\n\n--- metrics ---\n${JSON.stringify(metrics.metrics)}\n--- detector ---\n${JSON.stringify(metrics.detector)}`,
    },
  ];

  if (hasScreenshot) {
    const imgPath = path.join(SCREENSHOT_DIR, `${padded}.png`);
    if (fs.existsSync(imgPath)) {
      const b64 = fs.readFileSync(imgPath).toString('base64');
      content.push({
        type: 'image_url',
        image_url: { url: `data:image/png;base64,${b64}` },
      });
    }
  }

  const resp = await fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: 'user', content }],
      response_format: { type: 'json_object' },
    }),
  });

  if (!resp.ok) {
    throw new Error(`LLM 请求失败 ${resp.status}: ${await resp.text()}`);
  }
  const data = await resp.json();
  const parsed = JSON.parse(data.choices[0].message.content);
  return { graphIndex: index, ...parsed };
}

export async function annotateAll(hasScreenshot = true): Promise<void> {
  if (!API_KEY) {
    console.error(
      '[annotate] 错误：未设置 LAYOUT_LAB_LLM_API_KEY 环境变量。\n' +
        '设置方法（PowerShell）：$env:LAYOUT_LAB_LLM_API_KEY=\'sk-...\'\n' +
        '可选：LAYOUT_LAB_LLM_MODEL（默认 gpt-4o）、LAYOUT_LAB_LLM_BASE_URL、LAYOUT_LAB_LLM_PROVIDER',
    );
    process.exit(1);
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
