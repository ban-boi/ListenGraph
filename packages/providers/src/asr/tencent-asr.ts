/**
 * Tencent Cloud ASR Provider
 * Implements AsrProvider interface for Tencent Cloud (腾讯云) ASR service.
 *
 * Features:
 * - Uses TC3-HMAC-SHA256 signature for authentication (Web Crypto API compatible)
 * - Supports recording file recognition with async polling
 * - Compatible with Chrome Extension environment
 */

import type {
  AsrProvider,
  AsrProviderConfig,
  ProviderErrorCode,
  TranscriptChunk,
  ProviderRetryPolicy,
} from '@listen-graphic/schema';
import { generateId } from '@listen-graphic/shared-utils';
import { DEFAULT_RETRY_POLICY } from '../config';
import {
  createTimeoutSignal,
  mapHttpError,
  retryAsync,
  ProviderRequestError,
} from '../http/retry';

// Tencent Cloud API response types
interface TencentAsrResponse {
  Response: {
    RequestId: string;
    Error?: {
      Code: string;
      Message: string;
    };
    Data?: {
      TaskId: number;
      TaskStatus?: number;
      StatusStr?: string;
      Result?: string;
      ResultDetail?: Array<{
        FinalSentence?: string;
        StartMs?: number;
        EndMs?: number;
        Confidence?: number;
      }>;
    };
  };
}

// Task status enum
const TaskStatus = {
  WAITING: 0,
  PROCESSING: 1,
  SUCCESS: 2,
  FAILED: 3,
  CANCELED: 4,
} as const;

// Engine type enum
const EngineType = {
  CHINESE_16K: '16k_zh',
  CHINESE_ENGLISH_16K: '16k_zh_en',
  CHINESE_LARGE_16K: '16k_zh_large',
  CHINESE_8K: '8k_zh',
  CHINESE_LARGE_8K: '8k_zh_large',
  ENGLISH_16K: '16k_en',
} as const;

type EngineTypeValue = typeof EngineType[keyof typeof EngineType];

export class TencentAsrProvider implements AsrProvider {
  readonly name = 'tencent-asr';
  private readonly config: AsrProviderConfig;
  private readonly endpoint: string;
  private readonly apiVersion = '2019-06-14';
  private readonly service = 'asr';
  private progressListener?: (message: string) => void;

  constructor(config: AsrProviderConfig) {
    this.config = config;
    this.endpoint = this.normalizeEndpoint(config.endpoint);
  }

  setProgressListener(listener?: (message: string) => void) {
    this.progressListener = listener;
  }

  /**
   * Transcribe an audio chunk
   */
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

    try {
      // Step 1: Create recognition task
      const taskId = await this.createRecognitionTask(input, retryPolicy);

      // Step 2: Poll for completion
      const result = await this.pollTaskStatus(taskId, retryPolicy);

      // Step 3: Parse and return result
      return this.parseResult(result, input);
    } catch (error) {
      if (this.isProviderRequestError(error)) {
        throw error;
      }

      if (error instanceof Error && error.name === 'AbortError') {
        throw mapHttpError({
          provider: this.name,
          stage: 'asr',
          code: 'TIMEOUT_ERROR',
          message: 'Tencent ASR request timed out',
          retriable: true,
          attemptCount: 1,
        });
      }

      if (error instanceof TypeError) {
        throw mapHttpError({
          provider: this.name,
          stage: 'asr',
          code: 'NETWORK_ERROR',
          message: error.message,
          retriable: true,
          attemptCount: 1,
        });
      }

      if (error instanceof Error) {
        throw mapHttpError({
          provider: this.name,
          stage: 'asr',
          code: this.inferLocalErrorCode(error.message),
          message: error.message,
          retriable: this.isRetriableError(error),
          attemptCount: 1,
        });
      }

      throw mapHttpError({
        provider: this.name,
        stage: 'asr',
        code: 'TRANSCRIBE_ERROR',
        message: 'Tencent ASR request failed',
        retriable: false,
        attemptCount: 1,
      });
    }
  }

  /**
   * Create a recognition task using Tencent Cloud API
   */
  private async createRecognitionTask(
    input: {
      audio: Blob | ArrayBuffer;
      startMs: number;
      endMs: number;
      sessionId: string;
      language?: string;
    },
    retryPolicy: ProviderRetryPolicy,
  ): Promise<number> {
    // Convert audio to base64
    const audioBuffer = input.audio instanceof Blob
      ? await input.audio.arrayBuffer()
      : input.audio;
    const audioBase64 = this.arrayBufferToBase64(audioBuffer);

    // Prepare request payload
    const payload = {
      EngineModelType: this.config.model ?? this.getEngineType(input.language),
      ChannelNum: 1,
      ResTextFormat: 0,
      SourceType: 1, // Audio data (not URL)
      Data: audioBase64,
      DataLen: audioBuffer.byteLength,
    };

    return retryAsync(
      async (attempt) => {
        this.reportProgress(`腾讯 ASR 正在创建识别任务，第 ${attempt} 次请求`);
        const timestamp = Math.floor(Date.now() / 1000);
        const authorization = await this.buildAuthorization(payload, timestamp);

        const result = await fetch(`https://${this.endpoint}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: authorization,
            'X-TC-Action': 'CreateRecTask',
            'X-TC-Version': this.apiVersion,
            'X-TC-Timestamp': timestamp.toString(),
            ...(this.config.region && { 'X-TC-Region': this.config.region }),
          },
          body: JSON.stringify(payload),
          signal: createTimeoutSignal(Math.max(retryPolicy.timeoutMs, 30_000)),
        });

        if (!result.ok) {
          throw mapHttpError({
            provider: this.name,
            stage: 'asr',
            status: result.status,
            message: await result.text(),
            retriable: this.isRetriableStatus(result.status),
            attemptCount: attempt,
          });
        }

        const data: TencentAsrResponse = await result.json();
        if (data.Response?.Error) {
          throw this.mapTencentError({
            rawCode: data.Response.Error.Code,
            message: data.Response.Error.Message,
            attemptCount: attempt,
          });
        }

        if (!data.Response?.Data?.TaskId) {
          throw mapHttpError({
            provider: this.name,
            stage: 'asr',
            code: 'INVALID_RESPONSE',
            message: 'No TaskId returned from CreateRecTask',
            retriable: true,
            attemptCount: attempt,
          });
        }

        this.reportProgress(`腾讯 ASR 任务已创建，TaskId=${data.Response.Data.TaskId}`);
        return data.Response.Data.TaskId;
      },
      retryPolicy,
      (error) => this.isRetriableProviderError(error, retryPolicy),
    );
  }

  /**
   * Poll task status until completion
   */
  private async pollTaskStatus(
    taskId: number,
    retryPolicy: ProviderRetryPolicy,
  ): Promise<NonNullable<TencentAsrResponse['Response']['Data']>> {
    const maxAttempts = 60;
    const pollInterval = 2000; // 2 seconds

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const timestamp = Math.floor(Date.now() / 1000);
      const authorization = await this.buildAuthorization({ TaskId: taskId }, timestamp);

      const response = await fetch(`https://${this.endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: authorization,
          'X-TC-Action': 'DescribeTaskStatus',
          'X-TC-Version': this.apiVersion,
          'X-TC-Timestamp': timestamp.toString(),
          ...(this.config.region && { 'X-TC-Region': this.config.region }),
        },
        body: JSON.stringify({ TaskId: taskId }),
        signal: createTimeoutSignal(Math.max(retryPolicy.timeoutMs, 30_000)),
      });

      if (!response.ok) {
        throw mapHttpError({
          provider: this.name,
          stage: 'asr',
          status: response.status,
          message: await response.text(),
          retriable: this.isRetriableStatus(response.status),
          attemptCount: attempt + 1,
        });
      }

      const data: TencentAsrResponse = await response.json();
      if (data.Response?.Error) {
        throw this.mapTencentError({
          rawCode: data.Response.Error.Code,
          message: data.Response.Error.Message,
          attemptCount: attempt + 1,
        });
      }

      const task = data.Response?.Data;
      if (!task) {
        throw mapHttpError({
          provider: this.name,
          stage: 'asr',
          code: 'INVALID_RESPONSE',
          message: 'No task data in response',
          retriable: true,
          attemptCount: attempt + 1,
        });
      }

      if (this.shouldReportPollProgress(attempt)) {
        this.reportProgress(
          `腾讯 ASR 轮询中，TaskId=${taskId}，第 ${attempt + 1} 次，状态=${task.StatusStr ?? task.TaskStatus ?? 'unknown'}`,
        );
      }

      // Check if task is complete
      if (
        task.TaskStatus === TaskStatus.SUCCESS ||
        task.TaskStatus === TaskStatus.FAILED ||
        task.TaskStatus === TaskStatus.CANCELED
      ) {
        if (task.TaskStatus !== TaskStatus.SUCCESS) {
          throw mapHttpError({
            provider: this.name,
            stage: 'asr',
            code: 'TRANSCRIBE_ERROR',
            message: `ASR task failed with status: ${task.StatusStr ?? 'unknown'}`,
            retriable: false,
            attemptCount: attempt + 1,
          });
        }
        this.reportProgress(
          `腾讯 ASR 完成，TaskId=${taskId}，耗时约 ${(attempt + 1) * (pollInterval / 1000)} 秒`,
        );
        return task;
      }

      // Wait before next poll
      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }

    this.reportProgress(
      `腾讯 ASR 超时，TaskId=${taskId}，超过 ${maxAttempts * (pollInterval / 1000)} 秒仍未完成`,
    );
    throw mapHttpError({
      provider: this.name,
      stage: 'asr',
      code: 'TIMEOUT_ERROR',
      message: `ASR task ${taskId} did not complete within ${maxAttempts * (pollInterval / 1000)} seconds`,
      retriable: true,
      attemptCount: maxAttempts,
    });
  }

  /**
   * Parse recognition result from Tencent Cloud response
   */
  private parseResult(
    task: NonNullable<TencentAsrResponse['Response']['Data']>,
    input: {
      audio: Blob | ArrayBuffer;
      startMs: number;
      endMs: number;
      sessionId: string;
      language?: string;
    },
  ): TranscriptChunk {
    const text = task.Result || '';
    const durationMs = Math.max(input.endMs - input.startMs, 1);

    // Build tokens with timestamps
    const tokens = task.ResultDetail
      ? this.buildTokensFromResultDetail(task.ResultDetail, input.startMs)
      : this.buildFallbackTokens(text, input.startMs, durationMs);

    return {
      chunkId: generateId('chunk'),
      sessionId: input.sessionId,
      text,
      startMs: input.startMs,
      endMs: input.endMs,
      tokens,
      provider: this.name,
      raw: task,
    };
  }

  // ==================== Crypto Methods (Browser Compatible) ====================

  /**
   * Build authorization header using TC3-HMAC-SHA256
   */
  private async buildAuthorization(payload: any, timestamp: number): Promise<string> {
    const date = new Date(timestamp * 1000).toISOString().split('T')[0];

    const secretId = this.getCredential();
    const secretKey = this.getSecretKey();

    if (!secretKey) {
      throw new Error('SecretKey is required for Tencent ASR provider');
    }

    // Step 1: Build canonical request
    const httpRequestMethod = 'POST';
    const canonicalUri = '/';
    const canonicalQueryString = '';
    const canonicalHeaders = `content-type:application/json\nhost:${this.endpoint}\n`;
    const signedHeaders = 'content-type;host';

    // Hash payload
    const payloadStr = JSON.stringify(payload);
    const hashedRequestPayload = await this.sha256Hex(payloadStr);

    const canonicalRequest = [
      httpRequestMethod,
      canonicalUri,
      canonicalQueryString,
      canonicalHeaders,
      signedHeaders,
      hashedRequestPayload,
    ].join('\n');

    // Step 2: Build string to sign
    const algorithm = 'TC3-HMAC-SHA256';
    const credentialScope = `${date}/${this.service}/tc3_request`;
    const hashedCanonicalRequest = await this.sha256Hex(canonicalRequest);
    const stringToSign = [
      algorithm,
      timestamp.toString(),
      credentialScope,
      hashedCanonicalRequest,
    ].join('\n');

    // Step 3: Calculate signature
    const kDate = await this.hmacSha256(date, `TC3${secretKey}`);
    const kService = await this.hmacSha256(this.service, kDate);
    const kSigning = await this.hmacSha256('tc3_request', kService);
    const signature = await this.hmacSha256Hex(stringToSign, kSigning);

    // Build authorization header
    return [
      `${algorithm} Credential=${secretId}/${credentialScope}`,
      `SignedHeaders=${signedHeaders}`,
      `Signature=${signature}`,
    ].join(', ');
  }

  /**
   * SHA256 hash (returns hex string)
   */
  private async sha256Hex(message: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(message);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  /**
   * HMAC-SHA256 (returns ArrayBuffer)
   */
  private async hmacSha256(
    message: string,
    key: string | ArrayBuffer,
  ): Promise<ArrayBuffer> {
    const encoder = new TextEncoder();
    const keyData = typeof key === 'string' ? encoder.encode(key) : new Uint8Array(key);
    const messageData = encoder.encode(message);

    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );

    return await crypto.subtle.sign('HMAC', cryptoKey, messageData);
  }

  /**
   * HMAC-SHA256 (returns hex string)
   */
  private async hmacSha256Hex(message: string, key: string | ArrayBuffer): Promise<string> {
    const signature = await this.hmacSha256(message, key);
    const hashArray = Array.from(new Uint8Array(signature));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  // ==================== Helper Methods ====================

  /**
   * Get credential from config
   */
  private getCredential(): string {
    // 优先使用独立的 secretId 字段
    if (this.config.secretId) {
      return this.config.secretId;
    }
    
    // 回退到 apiKey 字段（兼容旧配置）
    if (this.config.apiKey) {
      const parts = this.config.apiKey.split(':');
      return parts[0];
    }
    
    throw new Error('SecretId is required for Tencent ASR provider');
  }

  /**
   * Get secret key from config
   */
  private getSecretKey(): string {
    // 优先使用独立的 secretKey 字段
    if (this.config.secretKey) {
      return this.config.secretKey;
    }
    
    // 回退到 apiKey 字段（兼容旧配置）
    if (this.config.apiKey) {
      const parts = this.config.apiKey.split(':');
      if (parts.length > 1) {
        return parts[1];
      }
    }
    
    throw new Error('SecretKey is required for Tencent ASR provider');
  }

  /**
   * Convert ArrayBuffer to Base64
   */
  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  /**
   * Determine engine type based on language
   */
  private getEngineType(language?: string): EngineTypeValue {
    const lang = language?.toLowerCase();
    
    // Check for mixed language first
    if (lang?.includes('zh_en') || lang?.includes('zh-en') || lang?.includes('mix')) {
      return EngineType.CHINESE_ENGLISH_16K;
    }
    
    // Then check for pure English
    if (lang?.includes('en')) {
      return EngineType.ENGLISH_16K;
    }
    
    // Default to Chinese engine
    return EngineType.CHINESE_16K;
  }

  private mapTencentError(params: {
    rawCode?: string;
    message: string;
    attemptCount: number;
  }) {
    const normalizedCode = this.mapTencentErrorCode(params.rawCode);
    return mapHttpError({
      provider: this.name,
      stage: 'asr',
      code: normalizedCode,
      message: params.message,
      retriable:
        normalizedCode === 'RATE_LIMIT_ERROR' ||
        (params.rawCode?.includes('InternalError') ?? false),
      attemptCount: params.attemptCount,
    });
  }

  private mapTencentErrorCode(rawCode?: string): ProviderErrorCode {
    const code = rawCode ?? '';
    if (code.includes('AuthFailure') || code.includes('UnauthorizedOperation')) {
      return 'AUTH_ERROR';
    }
    if (
      code.includes('LimitExceeded') ||
      code.includes('RequestLimitExceeded') ||
      code.includes('TooManyRequests') ||
      code.includes('Throttling')
    ) {
      return 'RATE_LIMIT_ERROR';
    }
    if (
      code.includes('InvalidParameter') ||
      code.includes('MissingParameter') ||
      code.includes('UnsupportedOperation')
    ) {
      return 'CONFIG_ERROR';
    }
    if (code.includes('InternalError') || code.includes('FailedOperation')) {
      return 'TRANSCRIBE_ERROR';
    }
    return 'INVALID_RESPONSE';
  }

  private inferLocalErrorCode(message: string): ProviderErrorCode {
    if (message.includes('SecretId is required') || message.includes('SecretKey is required')) {
      return 'CONFIG_ERROR';
    }
    return 'TRANSCRIBE_ERROR';
  }

  private normalizeEndpoint(endpoint?: string): string {
    const officialHost = 'asr.tencentcloudapi.com';
    if (!endpoint) {
      return officialHost;
    }
    const normalized = (() => {
      try {
        return new URL(endpoint).host || endpoint;
      } catch {
        return endpoint.replace(/^https?:\/\//, '').replace(/\/+$/, '');
      }
    })();

    if (normalized !== officialHost) {
      throw new Error(`Tencent ASR endpoint must use ${officialHost}`);
    }

    return normalized;
  }

  /**
   * Build tokens from Tencent Cloud result detail
   */
  private buildTokensFromResultDetail(
    resultDetail: Array<{
      FinalSentence?: string;
      StartMs?: number;
      EndMs?: number;
      Confidence?: number;
    }>,
    startMs: number,
  ): Array<{ text: string; startMs: number; endMs: number; confidence?: number }> {
    return resultDetail
      .filter((sentence) => sentence.FinalSentence)
      .map((sentence) => ({
        text: sentence.FinalSentence!,
        startMs: startMs + (sentence.StartMs || 0),
        endMs: startMs + (sentence.EndMs || 1000),
        confidence: sentence.Confidence,
      }));
  }

  /**
   * Fallback token builder when result detail is not available
   */
  private buildFallbackTokens(
    text: string,
    startMs: number,
    durationMs: number,
  ): Array<{ text: string; startMs: number; endMs: number }> {
    const chars = Array.from(text);
    if (chars.length === 0) {
      return [];
    }
    const step = durationMs / chars.length;
    return chars.map((char, index) => ({
      text: char,
      startMs: startMs + Math.round(index * step),
      endMs: startMs + Math.round((index + 1) * step),
    }));
  }

  private reportProgress(message: string) {
    this.progressListener?.(message);
  }

  private shouldReportPollProgress(attempt: number) {
    return attempt < 3 || (attempt + 1) % 5 === 0;
  }

  /**
   * Check if error is retriable for retry logic
   */
  private isRetriableProviderError(
    error: unknown,
    retryPolicy: { retryableStatusCodes: number[] },
  ): boolean {
    if (error instanceof Error && error.name === 'AbortError') {
      return true;
    }

    if (this.isProviderRequestError(error)) {
      return error.retriable;
    }

    if (error && typeof error === 'object' && 'status' in error) {
      const status = (error as ProviderRequestError).status;
      return typeof status === 'number' && retryPolicy.retryableStatusCodes.includes(status);
    }

    return error instanceof TypeError;
  }

  /**
   * Check if error is retriable
   */
  private isRetriableError(error: any): boolean {
    if (error instanceof TypeError) return true;
    if (error?.status === 429) return true; // Rate limit
    if (error?.status >= 500) return true; // Server error
    return false;
  }

  private isProviderRequestError(error: unknown): error is ProviderRequestError {
    return (
      error instanceof ProviderRequestError ||
      (typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        'provider' in error &&
        'stage' in error &&
        'retriable' in error)
    );
  }

  /**
   * Check if HTTP status is retriable
   */
  private isRetriableStatus(status: number): boolean {
    return status === 429 || status >= 500;
  }
}
