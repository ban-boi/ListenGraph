/**
 * Tests for TencentAsrProvider
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TencentAsrProvider } from './tencent-asr';
import type { AsrProviderConfig } from '@listen-graphic/schema';

// Mock global crypto API
const mockCrypto = {
  subtle: {
    digest: vi.fn().mockResolvedValue(new Uint8Array(32).fill(1));
    importKey: vi.fn().mockResolvedValue('mock-key');
    sign: vi.fn().mockResolvedValue(new Uint8Array(32).fill(2));
  }
}

// Mock fetch
global.fetch = vi.fn();
global.crypto = mockCrypto as any;
global.btoa = vi.fn((str: string) => Buffer.from(str, 'binary').toString('base64'));

describe('TencentAsrProvider', () => {
  let provider: TencentAsrProvider;
  let config: AsrProviderConfig;

  beforeEach(() => {
    config = {
      type: 'tencent',
      mode: 'direct',
      apiKey: 'test-secret-id:test-secret-key',
      region: 'ap-shanghai',
    };
    provider = new TencentAsrProvider(config);

    // Reset mocks
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should create provider with correct name', () => {
      expect(provider.name).toBe('tencent-asr');
    });
  });

  describe('transcribeChunk', () => {
    it('should handle successful transcription', async () => {
      // Mock crypto operations
      const mockDigestResult = new Uint8Array(32).fill(1);
      mockCrypto.subtle.digest.mockResolvedValue(mockDigestResult);
      mockCrypto.subtle.importKey.mockResolvedValue('mock-key');
      mockCrypto.subtle.sign.mockResolvedValue(new Uint8Array(32).fill(2));

      // Mock CreateRecTask response
      const mockCreateResponse = {
        Response: {
          RequestId: 'test-request-id',
          Data: {
            TaskId: 12345,
          },
        },
      };

      // Mock DescribeTaskStatus response
      const mockStatusResponse = {
        Response: {
          RequestId: 'test-request-id-2',
          Data: {
            TaskId: 12345,
            TaskStatus: 2, // SUCCESS
            StatusStr: 'success',
            Result: '测试识别结果',
            ResultDetail: [
              {
                FinalSentence: '测试识别信息',
                StartMs: 0,
                EndMs: 3000,
                Confidence: 0.95,
              },
            ],
          },
        },
      }

      let callCount = 0;
      (global.fetch as any).mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return {
            ok: true,
            json: async () => mockCreateResponse,
          }
        } else {
          return {
            ok: true,
            json: async () => mockStatusResponse,
          }
        }
      })

      const result = await provider.transcribeChunk({
        audio: new ArrayBuffer(1024),
        startMs: 0,
        endMs: 30000,
        sessionId: 'test-session',
        language: 'zh',
      })

      expect(result.text).toBe('测试识别信息')
      expect(result.sessionId).toBe('test-session')
      expect(result.provider).toBe('tencent-asr')
      expect(result.tokens).toHaveLength(1)
      expect(result.tokens[0].text).toBe('测试识别信息')
    })

    it('should handle API errors', async () => {
      const mockErrorResponse = {
        Response: {
          RequestId: 'test-request-id',
          Error: {
            Code: 'AuthFailure',
            Message: 'Authentication failed',
          },
        },
      }

      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => mockErrorResponse,
      })

      await expect(
        provider.transcribeChunk({
          audio: new ArrayBuffer(1024),
          startMs: 0,
          endMs: 30000,
          sessionId: 'test-session',
        }),
      ).rejects.toThrow()
    })

    it('should handle task timeout', async () => {
      // Mock crypto operations
      mockCrypto.subtle.digest.mockResolvedValue(new Uint8Array(32).fill(1))
      mockCrypto.subtle.importKey.mockResolvedValue('mock-key')
      mockCrypto.subtle.sign.mockResolvedValue(new Uint8Array(32).fill(2))

      // Mock CreateRecTask response
      const mockCreateResponse = {
        Response: {
          RequestId: 'test-request-id',
          Data: {
            TaskId: 12345,
          },
        },
      }

      // Mock DescribeTaskStatus response (always processing)
      const mockStatusResponse = {
        Response: {
          RequestId: 'test-request-id-2',
          Data: {
            TaskId: 12345,
            TaskStatus: 1, // PROCESSING
            StatusStr: 'processing'
          },
        },
      }

      let callCount = 0
      (global.fetch as any).mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return {
            ok: true,
            json: async () => mockCreateResponse,
          }
        } else {
          return {
            ok: true,
            json: async () => mockStatusResponse,
          }
        }
      })

      await expect(
        provider.transcribeChunk({
          audio: new ArrayBuffer(1024),
          startMs: 0,
          endMs: 30000,
          sessionId: 'test-session',
        }),
      ).rejects.toThrow('did not complete within')
    }, 10000)
  })

  describe('getEngineType', () => {
    it('should return Chinese engine by default', () => {
      const provider = new TencentAsrProvider(config);
      // @ts-ignore - private method
      const engineType = (provider as any).getEngineType();
      expect(engineType).toBe('16k_zh')
    })

    it('should return English engine for English language', () => {
      const provider = new TencentAsrProvider(config);
      const engineType = (provider as any).getEngineType('en-US')
      expect(engineType).toBe('16k_en')
    })

    it('should return mixed engine for zh-en language', () => {
      const provider = new TencentAsrProvider(config)
      const engineType = (provider as any).getEngineType('zh-en')
      expect(engineType).toBe('16k_zh_en')
    })
  })
})
