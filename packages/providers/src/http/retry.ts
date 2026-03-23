import type {
  ProviderErrorCode,
  ProviderRetryPolicy,
  ProviderStage,
  SerializableProviderError,
} from '@listen-graphic/schema';

export class ProviderRequestError extends Error {
  readonly code: ProviderErrorCode;
  readonly provider: string;
  readonly stage: ProviderStage;
  readonly retriable: boolean;
  readonly status?: number;
  readonly attemptCount?: number;

  constructor(input: SerializableProviderError) {
    super(input.message);
    this.name = 'ProviderRequestError';
    this.code = input.code;
    this.provider = input.provider;
    this.stage = input.stage;
    this.retriable = input.retriable;
    this.status = input.status;
    this.attemptCount = input.attemptCount;
  }

  toJSON(): SerializableProviderError {
    return {
      code: this.code,
      message: this.message,
      provider: this.provider,
      stage: this.stage,
      retriable: this.retriable,
      status: this.status,
      attemptCount: this.attemptCount,
    };
  }
}

export async function retryAsync<T>(
  operation: (attempt: number) => Promise<T>,
  policy: ProviderRetryPolicy,
  shouldRetry: (error: unknown) => boolean = isRetryableError,
): Promise<T> {
  let attempt = 0;
  let lastError: unknown;

  while (attempt < policy.maxAttempts) {
    attempt += 1;
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      if (attempt >= policy.maxAttempts || !shouldRetry(error)) {
        throw attachAttemptCount(error, attempt);
      }

      const delayMs = Math.min(
        policy.baseDelayMs * 2 ** (attempt - 1),
        policy.maxDelayMs,
      );
      await sleep(delayMs);
    }
  }

  throw lastError;
}

export function createTimeoutSignal(timeoutMs: number): AbortSignal | undefined {
  if (typeof AbortController === 'undefined') {
    return undefined;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  controller.signal.addEventListener('abort', () => clearTimeout(timeout), { once: true });
  return controller.signal;
}

export function mapHttpError(params: {
  provider: string;
  stage: ProviderStage;
  status?: number;
  message: string;
  retriable?: boolean;
  code?: ProviderErrorCode;
  attemptCount?: number;
}) {
  return new ProviderRequestError({
    provider: params.provider,
    stage: params.stage,
    status: params.status,
    message: params.message,
    retriable: params.retriable ?? isRetryableStatus(params.status),
    code:
      params.code ??
      inferErrorCode({
        stage: params.stage,
        status: params.status,
      }),
    attemptCount: params.attemptCount,
  });
}

export function isRetryableStatus(status?: number) {
  return typeof status === 'number' && [408, 409, 425, 429, 500, 502, 503, 504].includes(status);
}

function inferErrorCode(params: {
  stage: ProviderStage;
  status?: number;
}): ProviderErrorCode {
  if (params.status === 401 || params.status === 403) {
    return 'AUTH_ERROR';
  }
  if (params.status === 429) {
    return 'RATE_LIMIT_ERROR';
  }
  return params.stage === 'asr' ? 'TRANSCRIBE_ERROR' : 'STRUCTURE_ERROR';
}

function isRetryableError(error: unknown) {
  if (error instanceof ProviderRequestError) {
    return error.retriable;
  }

  if (error instanceof Error && error.name === 'AbortError') {
    return true;
  }

  return error instanceof TypeError;
}

function attachAttemptCount(error: unknown, attemptCount: number) {
  if (error instanceof ProviderRequestError) {
    return new ProviderRequestError({
      ...error.toJSON(),
      attemptCount,
    });
  }

  if (error instanceof Error && error.name === 'AbortError') {
    return new ProviderRequestError({
      code: 'TIMEOUT_ERROR',
      message: 'Provider request timed out',
      provider: 'unknown-provider',
      stage: 'asr',
      retriable: true,
      attemptCount,
    });
  }

  if (error instanceof Error) {
    return new ProviderRequestError({
      code: 'NETWORK_ERROR',
      message: error.message,
      provider: 'unknown-provider',
      stage: 'asr',
      retriable: true,
      attemptCount,
    });
  }

  return error;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
