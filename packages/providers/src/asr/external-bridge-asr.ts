import type { AsrProvider, AsrProviderConfig, TranscriptChunk } from '@listen-graphic/schema';

export class ExternalBridgeAsrProvider implements AsrProvider {
  name = 'external-bridge-asr';

  constructor(private readonly config: AsrProviderConfig) {}

  async transcribeChunk(input: {
    audio: Blob | ArrayBuffer;
    startMs: number;
    endMs: number;
    sessionId: string;
    language?: string;
  }): Promise<TranscriptChunk> {
    void input;
    throw new Error(
      `External ASR bridge (${this.config.endpoint ?? 'unknown endpoint'}) requires websocket streaming and does not support batch transcribeChunk()`,
    );
  }

  reset() {
    // Websocket bridge sessions are managed by the extension runtime.
  }
}
