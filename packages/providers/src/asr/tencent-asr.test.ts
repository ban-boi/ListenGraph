/**
 * Tests for TencentAsrProvider
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { TencentAsrProvider } from './tencent-asr'
import { ProviderRequestError } from '../http/retry'
import type { AsrProviderConfig } from '@listen-graphic/schema'

// Mock global crypto API
const mockCrypto = {
  subtle: {
    digest: vi.fn().mockResolvedValue(new Uint8Array(32).fill(1)),
    importKey: vi.fn().mockResolvedValue('mock-key'),
    sign: vi.fn().mockResolvedValue(new Uint8Array(32).fill(2)),
  },
}

// Mock fetch and crypto
global.fetch = vi.fn()
Object.defineProperty(global, 'crypto', {
  value: mockCrypto,
  writable: true,
})
Object.defineProperty(global, 'btoa', {
  value: vi.fn((str: string) => Buffer.from(str, 'binary').toString('base64')),
  writable: true,
})

describe('TencentAsrProvider', () => {
  let provider: TencentAsrProvider
  let config: AsrProviderConfig
  const fetchMock = vi.mocked(global.fetch)

  beforeEach(() => {
    config = {
      type: 'tencent',
      mode: 'direct',
      secretId: 'test-secret-id',
      secretKey: 'test-secret-key',
      region: 'ap-shanghai',
    }
    provider = new TencentAsrProvider(config)
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('constructor', () => {
    it('should create provider with correct name', () => {
      expect(provider.name).toBe('tencent-asr')
    })

    it('should accept config with secretId and secretKey', () => {
      const config = {
        type: 'tencent' as const,
        mode: 'direct' as const,
        secretId: 'AKIDxxx',
        secretKey: 'xxxx',
        region: 'ap-guangzhou',
      }
      const provider = new TencentAsrProvider(config)
      expect(provider.name).toBe('tencent-asr')
    })

    it('should accept legacy apiKey format', () => {
      const config = {
        type: 'tencent' as const,
        mode: 'direct' as const,
        apiKey: 'secretId:secretKey',
      }
      const provider = new TencentAsrProvider(config)
      expect(provider.name).toBe('tencent-asr')
    })
  })

  describe('getEngineType', () => {
    it('should return Chinese engine by default', () => {
      // @ts-ignore - private method
      const engineType = (provider as any).getEngineType()
      expect(engineType).toBe('16k_zh')
    })

    it('should return Chinese engine for zh language', () => {
      // @ts-ignore - private method
      const engineType = (provider as any).getEngineType('zh')
      expect(engineType).toBe('16k_zh')
    })

    it('should return English engine for en-US language', () => {
      // @ts-ignore - private method
      const engineType = (provider as any).getEngineType('en-US')
      expect(engineType).toBe('16k_en')
    })

    it('should return mixed engine for zh-en language', () => {
      // @ts-ignore - private method
      const engineType = (provider as any).getEngineType('zh-en')
      expect(engineType).toBe('16k_zh_en')
    })

    it('should return mixed engine for zh_en language', () => {
      // @ts-ignore - private method
      const engineType = (provider as any).getEngineType('zh_en')
      expect(engineType).toBe('16k_zh_en')
    })

    it('should return mixed engine for mix language', () => {
      // @ts-ignore - private method
      const engineType = (provider as any).getEngineType('mix')
      expect(engineType).toBe('16k_zh_en')
    })
  })

  describe('arrayBufferToBase64', () => {
    it('should convert ArrayBuffer to base64 string', () => {
      const buffer = new ArrayBuffer(4)
      const view = new Uint8Array(buffer)
      view.set([72, 101, 108, 108]) // "Hell"

      // @ts-ignore - private method
      const base64 = (provider as any).arrayBufferToBase64(buffer)
      
      expect(typeof base64).toBe('string')
      expect(base64.length).toBeGreaterThan(0)
    })
  })

  describe('getCredential', () => {
    it('should return secretId from config', () => {
      // @ts-ignore - private method
      const credential = (provider as any).getCredential()
      expect(credential).toBe('test-secret-id')
    })

    it('should parse secretId from apiKey format', () => {
      const config = {
        type: 'tencent' as const,
        mode: 'direct' as const,
        apiKey: 'parsed-secret-id:parsed-secret-key',
      }
      const provider = new TencentAsrProvider(config)
      
      // @ts-ignore - private method
      const credential = (provider as any).getCredential()
      expect(credential).toBe('parsed-secret-id')
    })
  })

  describe('getSecretKey', () => {
    it('should return secretKey from config', () => {
      // @ts-ignore - private method
      const secretKey = (provider as any).getSecretKey()
      expect(secretKey).toBe('test-secret-key')
    })

    it('should parse secretKey from apiKey format', () => {
      const config = {
        type: 'tencent' as const,
        mode: 'direct' as const,
        apiKey: 'parsed-secret-id:parsed-secret-key',
      }
      const provider = new TencentAsrProvider(config)
      
      // @ts-ignore - private method
      const secretKey = (provider as any).getSecretKey()
      expect(secretKey).toBe('parsed-secret-key')
    })
  })

  describe('transcribeChunk', () => {
    it('should create task, poll result, and preserve request headers', async () => {
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            Response: {
              RequestId: 'req-create',
              Data: {
                TaskId: 9527,
              },
            },
          }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            Response: {
              RequestId: 'req-poll',
              Data: {
                TaskId: 9527,
                TaskStatus: 2,
                StatusStr: 'success',
                Result: '你好世界',
                ResultDetail: [
                  {
                    FinalSentence: '你好世界',
                    StartMs: 0,
                    EndMs: 800,
                    Confidence: 98,
                  },
                ],
              },
            },
          }),
        } as Response)

      const transcript = await provider.transcribeChunk({
        audio: new Blob([new Uint8Array([82, 73, 70, 70, 0, 0, 0, 0])], { type: 'audio/wav' }),
        startMs: 1000,
        endMs: 2000,
        sessionId: 'session-1',
        language: 'zh',
      })

      expect(transcript.text).toBe('你好世界')
      expect(transcript.provider).toBe('tencent-asr')
      expect(transcript.tokens).toEqual([
        expect.objectContaining({
          text: '你好世界',
          startMs: 1000,
          endMs: 1800,
          confidence: 98,
        }),
      ])
      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect(fetchMock.mock.calls[0]?.[0]).toBe('https://asr.tencentcloudapi.com')
      expect(fetchMock.mock.calls[0]?.[1]).toEqual(
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-TC-Action': 'CreateRecTask',
            'X-TC-Region': 'ap-shanghai',
          }),
        }),
      )
      const createPayload = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))
      const wavBytes = Uint8Array.from(Buffer.from(createPayload.Data, 'base64'))
      expect(String.fromCharCode(...wavBytes.slice(0, 4))).toBe('RIFF')
      expect(createPayload.DataLen).toBe(wavBytes.byteLength)
    })

    it('should report Tencent task progress to the debug listener', async () => {
      const progressMessages: string[] = []
      provider.setProgressListener((message) => {
        progressMessages.push(message)
      })

      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            Response: {
              RequestId: 'req-create-progress',
              Data: {
                TaskId: 9527,
              },
            },
          }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            Response: {
              RequestId: 'req-poll-progress-1',
              Data: {
                TaskId: 9527,
                TaskStatus: 1,
                StatusStr: 'running',
              },
            },
          }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            Response: {
              RequestId: 'req-poll-progress-2',
              Data: {
                TaskId: 9527,
                TaskStatus: 2,
                StatusStr: 'success',
                Result: '调试日志已就绪',
              },
            },
          }),
        } as Response)

      const transcript = await provider.transcribeChunk({
        audio: new Uint8Array([1, 2, 3, 4]).buffer,
        startMs: 0,
        endMs: 1000,
        sessionId: 'session-progress',
      })

      expect(transcript.text).toBe('调试日志已就绪')
      expect(progressMessages).toEqual([
        '腾讯 ASR 正在创建识别任务，第 1 次请求',
        '腾讯 ASR 任务已创建，TaskId=9527',
        '腾讯 ASR 轮询中，TaskId=9527，第 1 次，状态=running',
        '腾讯 ASR 完成，TaskId=9527，耗时约 4 秒',
      ])
    })

    it('should treat Tencent Status=2 plus StatusStr=success as a completed task', async () => {
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            Response: {
              RequestId: 'req-create-status',
              Data: {
                TaskId: 9531,
              },
            },
          }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            Response: {
              RequestId: 'req-poll-status',
              Data: {
                TaskId: 9531,
                Status: 2,
                StatusStr: 'success',
                Result: '按文档字段完成',
              },
            },
          }),
        } as Response)

      const transcript = await provider.transcribeChunk({
        audio: new Uint8Array([1, 2, 3, 4]).buffer,
        startMs: 0,
        endMs: 1000,
        sessionId: 'session-status',
      })

      expect(transcript.text).toBe('按文档字段完成')
    })

    it('should not spam repeated poll logs when Tencent task stays in the same status', async () => {
      const progressMessages: string[] = []
      provider.setProgressListener((message) => {
        progressMessages.push(message)
      })

      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            Response: {
              RequestId: 'req-create-repeat',
              Data: {
                TaskId: 9532,
              },
            },
          }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            Response: {
              RequestId: 'req-poll-repeat-1',
              Data: {
                TaskId: 9532,
                Status: 1,
                StatusStr: 'doing',
              },
            },
          }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            Response: {
              RequestId: 'req-poll-repeat-2',
              Data: {
                TaskId: 9532,
                Status: 1,
                StatusStr: 'doing',
              },
            },
          }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            Response: {
              RequestId: 'req-poll-repeat-3',
              Data: {
                TaskId: 9532,
                Status: 2,
                StatusStr: 'success',
                Result: '日志去噪成功',
              },
            },
          }),
        } as Response)

      const transcript = await provider.transcribeChunk({
        audio: new Uint8Array([1, 2, 3, 4]).buffer,
        startMs: 0,
        endMs: 1000,
        sessionId: 'session-repeat-status',
      })

      expect(transcript.text).toBe('日志去噪成功')
      expect(
        progressMessages.filter((message) => message.includes('轮询中')).length,
      ).toBe(1)
      expect(progressMessages).toContain(
        '腾讯 ASR 轮询中，TaskId=9532，第 1 次，状态=doing',
      )
      expect(progressMessages.at(-1)).toBe(
        '腾讯 ASR 完成，TaskId=9532，耗时约 6 秒',
      )
    })

    it('should map Tencent auth errors to AUTH_ERROR without overwriting them', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          Response: {
            RequestId: 'req-auth',
            Error: {
              Code: 'AuthFailure.SignatureExpire',
              Message: 'signature expired',
            },
          },
        }),
      } as Response)

      await expect(
        provider.transcribeChunk({
          audio: new Uint8Array([1, 2, 3, 4]).buffer,
          startMs: 0,
          endMs: 1000,
          sessionId: 'session-1',
        }),
      ).rejects.toMatchObject({
        code: 'AUTH_ERROR',
        provider: 'tencent-asr',
        stage: 'asr',
      })
    })

    it('should retry Tencent internal errors as transient upstream failures', async () => {
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            Response: {
              RequestId: 'req-retry-1',
              Error: {
                Code: 'InternalError',
                Message: 'temporary upstream issue',
              },
            },
          }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            Response: {
              RequestId: 'req-create',
              Data: {
                TaskId: 9530,
              },
            },
          }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            Response: {
              RequestId: 'req-poll',
              Data: {
                TaskId: 9530,
                TaskStatus: 2,
                StatusStr: 'success',
                Result: '重试成功',
              },
            },
          }),
        } as Response)

      const transcript = await provider.transcribeChunk({
        audio: new Uint8Array([1, 2, 3, 4]).buffer,
        startMs: 0,
        endMs: 1000,
        sessionId: 'session-1',
      })

      expect(transcript.text).toBe('重试成功')
      expect(fetchMock).toHaveBeenCalledTimes(3)
    })

    it('should keep task failure as ProviderRequestError instead of generic TRANSCRIBE_ERROR wrapper', async () => {
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            Response: {
              RequestId: 'req-create',
              Data: {
                TaskId: 9528,
              },
            },
          }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            Response: {
              RequestId: 'req-poll',
              Data: {
                TaskId: 9528,
                TaskStatus: 3,
                StatusStr: 'failed',
              },
            },
          }),
        } as Response)

      await expect(
        provider.transcribeChunk({
          audio: new Uint8Array([1, 2, 3, 4]).buffer,
          startMs: 0,
          endMs: 1000,
          sessionId: 'session-1',
        }),
      ).rejects.toBeInstanceOf(ProviderRequestError)
    })

    it('should map polling timeout to TIMEOUT_ERROR', async () => {
      vi.useFakeTimers()
      const progressMessages: string[] = []
      provider.setProgressListener((message) => {
        progressMessages.push(message)
      })
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            Response: {
              RequestId: 'req-create',
              Data: {
                TaskId: 9529,
              },
            },
          }),
        } as Response)
        .mockImplementation(async () => ({
          ok: true,
          json: async () => ({
            Response: {
              RequestId: 'req-poll',
              Data: {
                TaskId: 9529,
                TaskStatus: 1,
                StatusStr: 'running',
              },
            },
          }),
        }) as Response)

      const pendingExpectation = expect(
        provider.transcribeChunk({
          audio: new Uint8Array([1, 2, 3, 4]).buffer,
          startMs: 0,
          endMs: 1000,
          sessionId: 'session-1',
        }),
      ).rejects.toMatchObject({
        code: 'TIMEOUT_ERROR',
        message: 'ASR task 9529 did not complete within 120 seconds',
        provider: 'tencent-asr',
        stage: 'asr',
      })

      await vi.runAllTimersAsync()
      await pendingExpectation
      expect(progressMessages.at(-1)).toBe(
        '腾讯 ASR 超时，TaskId=9529，超过 120 秒仍未完成',
      )
    })

    it('should reject non-official Tencent endpoints but still honor explicit engine model', async () => {
      expect(
        () =>
          new TencentAsrProvider({
            ...config,
            endpoint: 'https://custom.tencent.endpoint',
          }),
      ).toThrow(/asr\.tencentcloudapi\.com/i)

      const customProvider = new TencentAsrProvider({
        ...config,
        model: '16k_zh_large',
      })

      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            Response: {
              RequestId: 'req-create',
              Data: {
                TaskId: 9999,
              },
            },
          }),
        } as Response)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            Response: {
              RequestId: 'req-poll',
              Data: {
                TaskId: 9999,
                TaskStatus: 2,
                StatusStr: 'success',
                Result: '模型测试',
              },
            },
          }),
        } as Response)

      await customProvider.transcribeChunk({
        audio: new Blob([new Uint8Array([82, 73, 70, 70])], { type: 'audio/wav' }),
        startMs: 0,
        endMs: 1000,
        sessionId: 'session-1',
        language: 'en-US',
      })

      expect(fetchMock.mock.calls[0]?.[0]).toBe('https://asr.tencentcloudapi.com')
      const createPayload = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))
      expect(createPayload.EngineModelType).toBe('16k_zh_large')
    })
  })
})
