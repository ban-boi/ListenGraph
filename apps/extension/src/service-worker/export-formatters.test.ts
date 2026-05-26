import { describe, expect, it } from 'vitest';
import { buildSessionExport } from './export-formatters';

const session = {
  sessionId: 'session_export',
  sourceType: 'tab' as const,
  createdAt: 100,
  endedAt: 200,
};

const transcripts = [
  {
    chunkId: 'chunk_1',
    sessionId: 'session_export',
    text: '第一段转写',
    startMs: 0,
    endMs: 30000,
    provider: 'mock-asr',
  },
];

const graph = {
  sessionId: 'session_export',
  revision: 1,
  topics: [],
  nodes: [
    {
      id: 'node-1',
      type: 'claim' as const,
      text: '节点文本',
      timestampMs: 0,
      status: 'confirmed' as const,
    },
  ],
  edges: [],
  viewHints: {
    defaultView: 'timeline' as const,
  },
  updatedAt: 200,
};

describe('export formatters', () => {
  it('生成 JSON 导出内容', () => {
    const result = buildSessionExport({
      session,
      transcripts,
      graph,
    }, 'json');

    expect(result.filename).toBe('session_export.json');
    expect(result.mimeType).toBe('application/json');
    expect(result.content).toContain('"sessionId": "session_export"');
    expect(result.content).toContain('"第一段转写"');
    expect(result.content).not.toContain('assemblerRuns');
    expect(result.content).not.toContain('structureUnits');
  });

  it('生成 Markdown 导出内容', () => {
    const result = buildSessionExport({ session, transcripts, graph }, 'markdown');

    expect(result.filename).toBe('session_export.md');
    expect(result.content).toContain('# Listen Graphic Export');
    expect(result.content).toContain('## Transcript');
    expect(result.content).toContain('第一段转写');
    expect(result.content).toContain('## Nodes');
    expect(result.content).toContain('节点文本');
    expect(result.content).not.toContain('## Assembler Runs');
    expect(result.content).not.toContain('## Structure Units');
  });

  it('生成 Mermaid 导出内容', () => {
    const result = buildSessionExport({ session, transcripts, graph }, 'mermaid');

    expect(result.filename).toBe('session_export.mmd');
    expect(result.content).toContain('graph TD');
    expect(result.content).toContain('node_1["节点文本"]');
  });
});
