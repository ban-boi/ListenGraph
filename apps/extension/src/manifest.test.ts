import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('extension manifest', () => {
  it('exposes the audio worklet module as a web-accessible resource', () => {
    const manifestPath = resolve(process.cwd(), 'public/manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as {
      web_accessible_resources?: Array<{
        resources?: string[];
        matches?: string[];
      }>;
    };

    expect(manifest.web_accessible_resources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          resources: expect.arrayContaining(['offscreen/audio-processor.worklet.js']),
          matches: expect.arrayContaining(['<all_urls>']),
        }),
      ]),
    );
  });
});
