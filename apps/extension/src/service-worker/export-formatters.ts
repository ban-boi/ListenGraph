import type { SessionRecord } from '@listen-graphic/storage';
import type { ExportFormat } from '../shared/messages';
import type { MergedGraph, TranscriptChunk } from '@listen-graphic/schema';

type ExportBundle = {
  session?: SessionRecord;
  transcripts: TranscriptChunk[];
  graph: MergedGraph;
};

export function buildSessionExport(bundle: ExportBundle, format: ExportFormat) {
  switch (format) {
    case 'json':
      return {
        filename: `${bundle.graph.sessionId}.json`,
        mimeType: 'application/json',
        content: JSON.stringify(
          {
            session: bundle.session ?? null,
            transcripts: bundle.transcripts,
            graph: bundle.graph,
          },
          null,
          2,
        ),
      };
    case 'markdown':
      return {
        filename: `${bundle.graph.sessionId}.md`,
        mimeType: 'text/markdown',
        content: toMarkdown(bundle),
      };
    case 'mermaid':
      return {
        filename: `${bundle.graph.sessionId}.mmd`,
        mimeType: 'text/plain',
        content: toMermaid(bundle.graph),
      };
  }
}

function toMarkdown(bundle: ExportBundle) {
  const header = [
    `# Listen Graphic Export`,
    '',
    `- sessionId: ${bundle.graph.sessionId}`,
    `- createdAt: ${bundle.session?.createdAt ?? 'unknown'}`,
    `- endedAt: ${bundle.session?.endedAt ?? 'active'}`,
    `- revision: ${bundle.graph.revision}`,
  ];

  const transcriptLines =
    bundle.transcripts.length === 0
      ? ['## Transcript', '', '_No transcript units exported._']
      : [
          '## Transcript',
          '',
          ...bundle.transcripts.map(
            (chunk) =>
              `- [${formatTime(chunk.startMs)}-${formatTime(chunk.endMs)}] ${sanitizeMarkdownText(chunk.text)}`,
          ),
        ];

  const nodeLines =
    bundle.graph.nodes.length === 0
      ? ['## Nodes', '', '_No graph nodes exported._']
      : [
          '## Nodes',
          '',
          ...bundle.graph.nodes.map(
            (node) =>
              `- ${node.id} | ${node.type} | ${formatTime(node.timestampMs)} | ${sanitizeMarkdownText(node.text)}`,
          ),
        ];

  const edgeLines =
    bundle.graph.edges.length === 0
      ? ['## Edges', '', '_No graph edges exported._']
      : [
          '## Edges',
          '',
          ...bundle.graph.edges.map(
            (edge) => `- ${edge.source} -> ${edge.target} (${edge.type})`,
          ),
        ];

  return [
    ...header,
    '',
    ...transcriptLines,
    '',
    ...nodeLines,
    '',
    ...edgeLines,
  ].join('\n');
}

function toMermaid(graph: MergedGraph) {
  const lines = ['graph TD'];

  for (const node of graph.nodes) {
    lines.push(`  ${sanitizeId(node.id)}["${escapeLabel(node.text)}"]`);
  }

  for (const edge of graph.edges) {
    lines.push(
      `  ${sanitizeId(edge.source)} -->|${edge.type}| ${sanitizeId(edge.target)}`,
    );
  }

  return lines.join('\n');
}

function sanitizeMarkdownText(text: string): string {
  return text.replace(/\n/g, ' ').replace(/\|/g, '\\|');
}

function sanitizeId(id: string) {
  return id.replace(/[^a-zA-Z0-9_]/g, '_');
}

function escapeLabel(text: string) {
  return text.replace(/"/g, '\\"');
}

function formatTime(ms: number) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}
