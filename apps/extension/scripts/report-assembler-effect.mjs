// apps/extension/scripts/report-assembler-effect.mjs
// 第 3 层：assembler 效果报告。
//
// 从所有 judgment 提取 graphA（with assembler）/ graphB（without）的盲评数据，
// 计算 assembler on/off 的质量差（Δ），回答「assembler 到底有没有用」。
//
// 这是配对实验：同一段输入、同一模型、唯一变量是 assembler 开关。
// 结论是相对的（开比关好 Δ），不是绝对评分。
// 报告不进 CI、不阻塞发布，仅供人工复核 + assembler 改动时回归对比。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const judgmentDir = path.resolve(
  __dirname,
  '..',
  'src',
  'service-worker',
  'fixtures',
  'asr-realtime',
  'artifacts',
  'segments',
  'judgments',
);
const outPath = path.resolve(
  __dirname,
  '..',
  'src',
  'service-worker',
  'fixtures',
  'asr-realtime',
  'artifacts',
  'segments',
  'assembler-effect-report.md',
);

const DIMS = ['coverage', 'faithfulness', 'relationQuality', 'noiseHandling'];
const DIM_LABELS = {
  coverage: '覆盖率',
  faithfulness: '忠实度',
  relationQuality: '关系质量',
  noiseHandling: '噪声处理',
};

main();

function main() {
  const judgments = fs
    .readdirSync(judgmentDir)
    .filter((n) => n.startsWith('replay-local-seg') && n.endsWith('.judgment.json'))
    .map((n) => JSON.parse(fs.readFileSync(path.join(judgmentDir, n), 'utf-8')))
    .filter((j) => j.coverage && j.faithfulness); // 跳过不完整的

  if (judgments.length === 0) {
    console.log('未找到 judgment。');
    return;
  }

  console.log(`分析 ${judgments.length} 个 judgment...\n`);

  // 1. 偏好统计：graphA(with) / graphB(without) / tie
  let preferA = 0, preferB = 0, tie = 0;
  for (const j of judgments) {
    if (j.preferredActual === 'graphA') preferA++;
    else if (j.preferredActual === 'graphB') preferB++;
    else tie++;
  }

  // 2. 四维度 Δ（graphA - graphB），算均值
  const dimStats = {};
  for (const dim of DIMS) {
    const deltas = judgments
      .map((j) => (j[dim]?.graphA ?? 0) - (j[dim]?.graphB ?? 0))
      .filter((d) => Number.isFinite(d));
    const sum = deltas.reduce((s, d) => s + d, 0);
    dimStats[dim] = {
      mean: sum / deltas.length,
      positive: deltas.filter((d) => d > 0).length,
      negative: deltas.filter((d) => d < 0).length,
      zero: deltas.filter((d) => d === 0).length,
      total: deltas.length,
    };
  }

  // 3. 逐 segment 明细（Δ 不为 0 或偏好明确的）
  const details = judgments
    .map((j) => {
      const seg = j.fixtureName.match(/seg\d+/)?.[0] ?? j.fixtureName;
      const deltas = {};
      for (const dim of DIMS) {
        deltas[dim] = (j[dim]?.graphA ?? 0) - (j[dim]?.graphB ?? 0);
      }
      return { seg, preferred: j.preferredActual, deltas, reason: j.promoteReason?.slice(0, 30) };
    })
    .sort((a, b) => a.seg.localeCompare(b.seg));

  // 4. 生成 markdown
  const lines = [
    `# Assembler 效果报告`,
    ``,
    `生成时间: ${new Date().toISOString()}`,
    `样本数: ${judgments.length} 个 segment（盲评：graphA=with assembler, graphB=without）`,
    ``,
    `## 结论`,
    ``,
    generateConclusion(preferA, preferB, tie, dimStats, judgments.length),
    ``,
    `## 偏好分布`,
    ``,
    `- graphA（with assembler）被偏好: ${preferA} 次（${pct(preferA, judgments.length)}）`,
    `- graphB（without assembler）被偏好: ${preferB} 次（${pct(preferB, judgments.length)}）`,
    `- tie: ${tie} 次（${pct(tie, judgments.length)}）`,
    ``,
    `> 盲评：judge 不知道哪个是 with/without。preferredActual 是去掉位置偏差后的真实偏好。`,
    ``,
    `## 四维度质量差（graphA 均分 − graphB 均分，Δ>0 表示 assembler 更好）`,
    ``,
    `| 维度 | Δ均值 | A更好 | B更好 | 持平 |`,
    `|------|-------|-------|-------|------|`,
    ...DIMS.map((dim) => {
      const s = dimStats[dim];
      const sign = s.mean > 0 ? '+' : '';
      return `| ${DIM_LABELS[dim]} | ${sign}${s.mean.toFixed(2)} | ${s.positive} | ${s.negative} | ${s.zero} |`;
    }),
    ``,
    `## 逐 segment 明细`,
    ``,
    `| Seg | 偏好 | Cov Δ | Faith Δ | Rel Δ | Noise Δ |`,
    `|-----|------|-------|---------|-------|---------|`,
    ...details.map((d) => {
      const fmtDelta = (v) => (v > 0 ? `+${v}` : `${v}`);
      return `| ${d.seg} | ${d.preferred} | ${fmtDelta(d.deltas.coverage)} | ${fmtDelta(d.deltas.faithfulness)} | ${fmtDelta(d.deltas.relationQuality)} | ${fmtDelta(d.deltas.noiseHandling)} |`;
    }),
    ``,
    `## 使用说明`,
    ``,
    `- 这是**第 3 层 assembler 效果检验**，不进 CI、不阻塞发布。`,
    `- 改动 assembler 代码后重跑 compare + judge，对比本报告的 Δ 分布变化。`,
    `- Δ 系统性为正 = assembler 有益；系统性为负 = assembler 有害；接近 0 = assembler 无明显效果。`,
    `- 跨模型混杂时，不同模型批次的 Δ 不可直接比较，需按生成模型分组看（见 judgment 的 generatedAt）。`,
  ];

  fs.writeFileSync(outPath, lines.join('\n'));
  console.log(`报告已写入: ${outPath}`);
  console.log(`\n=== 结论预览 ===`);
  console.log(generateConclusion(preferA, preferB, tie, dimStats, judgments.length));
}

function generateConclusion(preferA, preferB, tie, dimStats, total) {
  const avgDelta =
    DIMS.reduce((s, d) => s + dimStats[d].mean, 0) / DIMS.length;
  const aBetter = preferA > preferB;
  const trend =
    avgDelta > 0.3 ? 'assembler 明显有益' :
    avgDelta < -0.3 ? 'assembler 明显有害' :
    'assembler 效果不显著';
  return [
    `- 偏好倾向: ${aBetter ? 'graphA (with assembler)' : 'graphB (without assembler)'} 更多被偏好（${Math.max(preferA, preferB)}/${total}）`,
    `- 四维度平均 Δ = ${avgDelta > 0 ? '+' : ''}${avgDelta.toFixed(2)} → ${trend}`,
    `- 注意：样本跨多模型生成（glm/qwen），结论是混合模型下的平均效果，按模型拆分需进一步分析。`,
  ].join('\n');
}

function pct(n, total) {
  return total > 0 ? `${((n / total) * 100).toFixed(0)}%` : '?';
}
