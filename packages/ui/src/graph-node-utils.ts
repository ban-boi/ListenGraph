export function formatGraphNodeTime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}

export function getGraphNodeTypeColor(type: string): string {
  const colors: Record<string, string> = {
    claim: 'var(--lg-node-claim)',
    reason: 'var(--lg-node-evidence)',
    example: 'var(--lg-node-concept)',
    question: 'var(--lg-node-question)',
    conclusion: 'var(--lg-node-conclusion)',
  };
  return colors[type] || 'var(--lg-muted)';
}

export function getGraphNodeTypeLabel(type: string): string {
  const labels: Record<string, string> = {
    claim: '观点',
    reason: '论据',
    example: '例子',
    question: '问题',
    conclusion: '结论',
  };
  return labels[type] || type;
}
