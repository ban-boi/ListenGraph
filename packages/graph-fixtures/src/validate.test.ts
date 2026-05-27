import { describe, expect, it } from 'vitest';

import { validateAllFixtures } from './validate';

describe('validateAllFixtures', () => {
  it('passes after fixtures are generated', () => {
    const report = validateAllFixtures();
    expect(report.ok, report.errors.join('\n')).toBe(true);
  });
});
