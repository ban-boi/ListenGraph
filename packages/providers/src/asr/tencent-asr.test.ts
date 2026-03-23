/**
 * Tests for TencentAsrProvider
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TencentAsrProvider } from './tencent-asr'
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
})
