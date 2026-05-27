import { describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('production sidepanel bundle', () => {
  it('does not ship __listenGraphicFixture', () => {
    const bundlePath = path.resolve(__dirname, '../../dist/sidepanel/sidepanel.js');
    const code = fs.readFileSync(bundlePath, 'utf-8');
    expect(code).not.toContain('__listenGraphicFixture');
  });
});
