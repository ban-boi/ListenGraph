import fs from 'node:fs';
import path from 'node:path';
import type { MergedGraph } from '@listen-graphic/schema';
import { computeMetrics } from './metrics';
import { simplifyGraph } from './simplify';
import { whatDetectorSays } from './detector-check';
import type { GraphSnapshot } from './types';

const DEFAULT_INPUT = path.resolve(import.meta.dirname, '../inputs/real-graphs-dump.json');
const DEFAULT_OUTPUT = path.resolve(import.meta.dirname, '../outputs/metrics');

export async function exportSnapshots(
  inputPath: string = DEFAULT_INPUT,
  outputDir: string = DEFAULT_OUTPUT,
): Promise<GraphSnapshot[]> {
  const dump = JSON.parse(fs.readFileSync(inputPath, 'utf8')) as MergedGraph[];
  fs.mkdirSync(outputDir, { recursive: true });
  // 同时写 simplified 到子目录，供 annotate 阶段读
  const simplifiedDir = path.join(path.dirname(outputDir), 'simplified');
  fs.mkdirSync(simplifiedDir, { recursive: true });

  const snapshots: GraphSnapshot[] = dump.map((graph, i) => {
    const metrics = computeMetrics(graph);
    const simplified = simplifyGraph(graph);
    const detector = whatDetectorSays(graph);

    const padded = String(i).padStart(2, '0');
    fs.writeFileSync(
      path.join(outputDir, `${padded}.json`),
      JSON.stringify({ graphIndex: i, metrics, detector }, null, 2),
    );
    fs.writeFileSync(
      path.join(simplifiedDir, `${padded}.json`),
      JSON.stringify({ graphIndex: i, simplified }, null, 2),
    );

    return { graphIndex: i, source: graph, simplified, metrics, detector };
  });

  console.log(`[export] 完成 ${snapshots.length} 条图 → ${outputDir}`);
  return snapshots;
}

// CLI 入口
const onlyArg = process.argv.find((a) => a.startsWith('--input='));
const input = onlyArg ? onlyArg.slice('--input='.length) : DEFAULT_INPUT;
void exportSnapshots(input);
