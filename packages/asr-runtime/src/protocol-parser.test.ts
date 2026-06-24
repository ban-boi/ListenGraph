import { describe, expect, it } from 'vitest';
import { parseLocalAsrMessage } from './protocol-parser';

describe('parseLocalAsrMessage', () => {
  it('规范化一条 final 转写', () => {
    expect(
      parseLocalAsrMessage(
        JSON.stringify({
          type: 'transcript.final',
          utterance: {
            utteranceId: 'utt-1',
            revision: 2,
            text: '真实文本',
            startMs: 10,
            endMs: 900,
            finalReason: 'endpoint',
            stability: 'stable',
            confidence: 0.95,
          },
        }),
      ),
    ).toEqual({
      type: 'transcript.final',
      utterance: {
        utteranceId: 'utt-1',
        revision: 2,
        text: '真实文本',
        startMs: 10,
        endMs: 900,
        finalReason: 'endpoint',
        stability: 'stable',
        confidence: 0.95,
      },
      raw: expect.any(Object),
    });
  });

  it('规范化一条 partial 转写并保留 vendor 字段', () => {
    const event = parseLocalAsrMessage(
      JSON.stringify({
        type: 'transcript.partial',
        utterance: {
          utteranceId: 'utt-2',
          revision: 1,
          text: '部分',
          startMs: 0,
          endMs: 400,
        },
        vendor: { engine: 'sherpa' },
      }),
    );
    expect(event.type).toBe('transcript.partial');
    if (event.type === 'transcript.partial') {
      expect(event.utterance.utteranceId).toBe('utt-2');
      expect(event.vendor).toEqual({ engine: 'sherpa' });
    }
  });

  it('规范化 session.started 并透传 bridgeSessionId', () => {
    const event = parseLocalAsrMessage(
      JSON.stringify({
        type: 'session.started',
        session: { bridgeSessionId: 'bridge-1' },
      }),
    );
    expect(event).toMatchObject({
      type: 'session.started',
      bridgeSessionId: 'bridge-1',
    });
  });

  it('规范化 status 消息', () => {
    const event = parseLocalAsrMessage(
      JSON.stringify({ type: 'status', status: 'listening', detail: 'ok' }),
    );
    expect(event).toMatchObject({ type: 'status', status: 'listening', detail: 'ok' });
  });

  it('把 bridge error 负载规范化为带 BRIDGE_ERROR 的事件', () => {
    const event = parseLocalAsrMessage(
      JSON.stringify({ type: 'error', error: { code: 'DECODE_FAILED', message: '坏帧' } }),
    );
    expect(event.type).toBe('error');
    if (event.type === 'error') {
      expect(event.error.code).toBe('BRIDGE_ERROR');
      expect(event.error.message).toContain('坏帧');
    }
  });

  it('用稳定错误码拒绝畸形负载', () => {
    expect(() => parseLocalAsrMessage('{"type":"transcript.final"}')).toThrowError(
      expect.objectContaining({ code: 'INVALID_PROTOCOL_MESSAGE' }),
    );
  });

  it('拒绝未知消息类型', () => {
    expect(() => parseLocalAsrMessage('{"type":"totally.unknown"}')).toThrowError(
      expect.objectContaining({ code: 'INVALID_PROTOCOL_MESSAGE' }),
    );
  });

  it('拒绝非 JSON 字符串', () => {
    expect(() => parseLocalAsrMessage('not-json')).toThrowError(
      expect.objectContaining({ code: 'INVALID_PROTOCOL_MESSAGE' }),
    );
  });

  it('拒绝非字符串输入', () => {
    expect(() => parseLocalAsrMessage(null as unknown as string)).toThrowError(
      expect.objectContaining({ code: 'INVALID_PROTOCOL_MESSAGE' }),
    );
  });
});
