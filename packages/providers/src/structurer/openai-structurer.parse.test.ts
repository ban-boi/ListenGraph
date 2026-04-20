import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  OpenAIStructurerProvider,
  STRUCTURER_RESPONSE_PREVIEW_MAX_CHARS,
  tryParseSegmentGraphPayload,
} from './openai-structurer';

describe('tryParseSegmentGraphPayload', () => {
  it('accepts valid JSON object', () => {
    const raw = '{"topic":"t","nodes":[],"edges":[]}';
    const r = tryParseSegmentGraphPayload(raw);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.payload.topic).toBe('t');
    }
  });

  it('returns primary_json diagnostics when content is not JSON', () => {
    const r = tryParseSegmentGraphPayload('not json at all');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.diagnostics.parseStage).toBe('primary_json');
      expect(r.diagnostics.responsePreview).toBe('not json at all');
      expect(r.diagnostics.responseTruncated).toBe(false);
      expect(r.diagnostics.parseMessage).toBeDefined();
    }
  });

  it('truncates responsePreview when raw content exceeds max chars', () => {
    const long = 'x'.repeat(STRUCTURER_RESPONSE_PREVIEW_MAX_CHARS + 500);
    const r = tryParseSegmentGraphPayload(long);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.diagnostics.responseTruncated).toBe(true);
      expect(r.diagnostics.responsePreview?.length).toBe(STRUCTURER_RESPONSE_PREVIEW_MAX_CHARS);
    }
  });

  it('strips markdown fences before parse', () => {
    const raw = '```json\n{"topic":"","nodes":[],"edges":[]}\n```';
    const r = tryParseSegmentGraphPayload(raw);
    expect(r.ok).toBe(true);
  });
});

describe('OpenAIStructurerProvider INVALID_RESPONSE retry', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              choices: [{ message: { content: 'plain text not json' } }],
            }),
            { status: 200 },
          ),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      topic: '',
                      nodes: [],
                      edges: [],
                    }),
                  },
                },
              ],
            }),
            { status: 200 },
          ),
        ),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('retries HTTP when first body is unparseable and succeeds on second', async () => {
    const provider = new OpenAIStructurerProvider({
      type: 'openai',
      mode: 'direct',
      apiKey: 'test-key',
      model: 'test-model',
      retry: {
        maxAttempts: 3,
        baseDelayMs: 1,
        maxDelayMs: 2,
        timeoutMs: 10_000,
        retryableStatusCodes: [],
      },
    });

    const chunk = {
      chunkId: 'c1',
      sessionId: 's1',
      text: 'hello',
      startMs: 0,
      endMs: 1000,
      provider: 'mock',
    };

    const segment = await provider.extractSegmentGraph({
      sessionId: 's1',
      transcriptWindow: [chunk],
      language: 'zh',
    });

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(segment.nodes.length).toBeGreaterThanOrEqual(0);
    expect(segment.segmentId).toBeDefined();
  });
});
