import { describe, expect, it } from 'vitest';

import {
  formatGraphNodeTime,
  getGraphNodeTypeColor,
  getGraphNodeTypeLabel,
} from './graph-node-utils';

describe('graph-node-utils', () => {
  it('formats milliseconds as M:SS', () => {
    expect(formatGraphNodeTime(65_000)).toBe('1:05');
    expect(formatGraphNodeTime(90_000)).toBe('1:30');
  });

  it('maps node types to Chinese labels and colors', () => {
    expect(getGraphNodeTypeLabel('claim')).toBe('观点');
    expect(getGraphNodeTypeColor('claim')).toBe('var(--lg-node-claim)');
    expect(getGraphNodeTypeLabel('unknown')).toBe('unknown');
    expect(getGraphNodeTypeColor('unknown')).toBe('var(--lg-muted)');
  });
});
