export function normalizeText(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[，。！？、,.!?]/g, '')
    .replace(/\s+/g, '');
}

export function buildTextBigrams(input: string): string[] {
  const normalized = normalizeText(input);
  if (normalized.length <= 1) {
    return normalized ? [normalized] : [];
  }

  const bigrams: string[] = [];
  for (let index = 0; index < normalized.length - 1; index += 1) {
    bigrams.push(normalized.slice(index, index + 2));
  }

  return bigrams;
}

export function computeTextOverlap(a: string, b: string): number {
  const aBigrams = new Set(buildTextBigrams(a));
  const bBigrams = new Set(buildTextBigrams(b));

  if (aBigrams.size === 0 || bBigrams.size === 0) {
    return 0;
  }

  let overlapCount = 0;
  for (const token of aBigrams) {
    if (bBigrams.has(token)) {
      overlapCount += 1;
    }
  }

  return overlapCount / Math.max(aBigrams.size, bBigrams.size);
}
