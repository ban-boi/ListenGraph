export function normalizeText(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[，。！？、,.!?]/g, '')
    .replace(/\s+/g, '');
}
