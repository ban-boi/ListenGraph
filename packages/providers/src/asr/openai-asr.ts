import type { AsrProvider, AsrProviderConfig, TranscriptChunk } from '@listen-graphic/schema';
import { generateId } from '@listen-graphic/shared-utils';
import { DEFAULT_RETRY_POLICY } from '../config';
import {
  createTimeoutSignal,
  mapHttpError,
  retryAsync,
  type ProviderRequestError,
} from '../http/retry';

type OpenAITranscriptionResponse = {
  text?: string;
  language?: string;
  segments?: Array<{
    text?: string;
    start?: number;
    end?: number;
    confidence?: number;
  }>;
};

export class OpenAIAsrProvider implements AsrProvider {
  name = 'openai-asr';

  constructor(private readonly config: AsrProviderConfig) {}

  async transcribeChunk(input: {
    audio: Blob | ArrayBuffer;
    startMs: number;
    endMs: number;
    sessionId: string;
    language?: string;
  }): Promise<TranscriptChunk> {
    const retryPolicy = {
      ...DEFAULT_RETRY_POLICY,
      ...this.config.retry,
    };

    const response = await retryAsync(
      async (attempt) => {
        const audioBlob =
          input.audio instanceof Blob
            ? input.audio
            : new Blob([input.audio], { type: 'audio/webm' });
        const formData = new FormData();
        formData.set('file', audioBlob, 'chunk.webm');
        formData.set('model', this.config.model ?? 'gpt-4o-mini-transcribe');
        formData.set('language', input.language ?? this.config.language ?? 'zh');
        formData.set('response_format', 'verbose_json');

        const result = await fetch(
          `${this.config.endpoint ?? 'https://api.openai.com/v1'}/audio/transcriptions`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${getCredential(this.config)}`,
            },
            body: formData,
            signal: createTimeoutSignal(retryPolicy.timeoutMs),
          },
        );

        if (!result.ok) {
          throw mapHttpError({
            provider: this.name,
            stage: 'asr',
            status: result.status,
            message: await safeReadError(result),
            attemptCount: attempt,
          });
        }

        const json = (await result.json()) as OpenAITranscriptionResponse;
        if (!json.text) {
          throw mapHttpError({
            provider: this.name,
            stage: 'asr',
            code: 'INVALID_RESPONSE',
            message: 'ASR provider returned an empty transcript payload',
            retriable: false,
            attemptCount: attempt,
          });
        }
        return json;
      },
      retryPolicy,
      (error) => isRetriableProviderError(error, retryPolicy),
    );

    const text = (response.text ?? '').trim();
    const durationMs = Math.max(input.endMs - input.startMs, 1);
    const tokens = buildTokens(response, input.startMs, durationMs);

    return {
      chunkId: generateId('chunk'),
      sessionId: input.sessionId,
      text,
      startMs: input.startMs,
      endMs: input.endMs,
      tokens,
      provider: this.name,
      raw: response,
    };
  }
}

function getCredential(config: AsrProviderConfig) {
  return config.mode === 'relay' ? config.sessionToken : config.apiKey;
}

async function safeReadError(response: Response) {
  try {
    return (await response.text()) || `ASR request failed with status ${response.status}`;
  } catch {
    return `ASR request failed with status ${response.status}`;
  }
}

function isRetriableProviderError(
  error: unknown,
  retryPolicy: { retryableStatusCodes: number[] },
) {
  if (isAbortError(error)) {
    return true;
  }

  if (typeof error === 'object' && error && 'status' in error) {
    const status = (error as ProviderRequestError).status;
    return typeof status === 'number' && retryPolicy.retryableStatusCodes.includes(status);
  }

  return error instanceof TypeError;
}

function isAbortError(error: unknown) {
  return (
    (error instanceof Error && error.name === 'AbortError') ||
    (typeof DOMException !== 'undefined' &&
      error instanceof DOMException &&
      error.name === 'AbortError')
  );
}

function buildTokens(
  response: OpenAITranscriptionResponse,
  startMs: number,
  durationMs: number,
) {
  if (response.segments?.length) {
    return response.segments
      .filter((segment) => segment.text)
      .map((segment) => ({
        text: segment.text as string,
        startMs: startMs + Math.round((segment.start ?? 0) * 1000),
        endMs: startMs + Math.round((segment.end ?? durationMs / 1000) * 1000),
        confidence: segment.confidence,
      }));
  }

  const chars = Array.from(response.text ?? '');
  const step = durationMs / Math.max(chars.length, 1);
  return chars.map((char, index) => ({
    text: char,
    startMs: startMs + Math.round(index * step),
    endMs: startMs + Math.round((index + 1) * step),
  }));
}
