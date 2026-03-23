// Mock ASR Provider - 返回假的 transcript 数据
// 用于开发和测试，不需要真实的 ASR API

import type { AsrProvider, TranscriptChunk } from '@listen-graphic/schema';
import { generateId } from '@listen-graphic/shared-utils';

// 预设的 mock transcript 内容
const MOCK_TRANSCRIPTS = [
  '今天我们来聊聊 AI 创业的挑战。',
  '大模型公司很难靠 API 获得稳定利润。',
  '推理成本高，而且价格竞争非常激烈。',
  '开源模型的追赶速度比预期快很多。',
  '纯 API 模式可能是一条死路。',
  '那什么样的 AI 公司才能真正赚钱呢？',
  '关键是要做垂直场景的深度整合。',
  '通用能力很难形成真正的壁垒。',
  '法律 AI 比通用对话助手更赚钱。',
  'AI 创业必须找场景，不能只做模型。',
  '差异化来自于数据和领域知识。',
  '用户体验也是重要的护城河。',
  '很多团队忽视了产品的打磨。',
  '技术只是手段，不是目的。',
  '最终还是要回到用户价值上来。',
];

export class MockAsrProvider implements AsrProvider {
  name = 'mock-asr';

  async transcribeChunk(input: {
    audio: Blob | ArrayBuffer;
    startMs: number;
    endMs: number;
    sessionId: string;
    language?: string;
  }): Promise<TranscriptChunk> {
    // 模拟 ASR 处理延迟
    await new Promise((resolve) => setTimeout(resolve, 200));

    // 使用 chunk 时间位置推导输出，避免 worker 重载后序列回退
    const chunkSpanMs = Math.max(1, input.endMs - input.startMs);
    const transcriptIndex = Math.floor(input.startMs / chunkSpanMs);
    const text = MOCK_TRANSCRIPTS[transcriptIndex % MOCK_TRANSCRIPTS.length];

    // 生成假的 token 数据
    const words = text.split('');
    const durationMs = input.endMs - input.startMs;
    const msPerChar = durationMs / words.length;

    const tokens = words.map((char, i) => ({
      text: char,
      startMs: input.startMs + i * msPerChar,
      endMs: input.startMs + (i + 1) * msPerChar,
      confidence: 0.85 + Math.random() * 0.1, // 0.85 - 0.95
    }));

    const chunk: TranscriptChunk = {
      chunkId: generateId('chunk'),
      sessionId: input.sessionId,
      text,
      startMs: input.startMs,
      endMs: input.endMs,
      tokens,
      provider: this.name,
      confidence: 0.9,
      raw: {
        // 保留原始数据用于调试
        audioSize:
          input.audio instanceof Blob
            ? input.audio.size
            : input.audio.byteLength,
        language: input.language || 'zh',
      },
    };

    console.log('[MockAsrProvider] Generated transcript:', {
      chunkId: chunk.chunkId,
      text: chunk.text,
      startMs: chunk.startMs,
      endMs: chunk.endMs,
    });

    return chunk;
  }

  // 重置索引（用于新会话）
  reset() {
    // stateless mock provider: keep as no-op for compatibility
  }
}
