import type { AsrProviderConfig } from '@listen-graphic/schema';

const TENCENT_REALTIME_HOST = 'asr.cloud.tencent.com';
const TENCENT_REALTIME_PATH_PREFIX = '/asr/v2/';
const DEFAULT_VOICE_FORMAT = 1;
const DEFAULT_SIGNATURE_TTL_SECONDS = 60 * 60;

export type TencentRealtimeSessionConfig = {
  signedUrl: string;
  voiceId: string;
  expiresAt: number;
};

export async function createTencentRealtimeSessionConfig(
  config: AsrProviderConfig,
): Promise<TencentRealtimeSessionConfig> {
  const appId = config.appId?.trim();
  if (!appId) {
    throw new Error('Tencent realtime ASR requires appId');
  }

  const secretId = getTencentSecretId(config);
  const secretKey = getTencentSecretKey(config);
  if (!secretId || !secretKey) {
    throw new Error('Tencent realtime ASR requires secretId and secretKey');
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  const expiresAt = nowSeconds + DEFAULT_SIGNATURE_TTL_SECONDS;
  const voiceId = crypto.randomUUID();
  const params = new Map<string, string>([
    ['secretid', secretId],
    ['timestamp', String(nowSeconds)],
    ['expired', String(expiresAt)],
    ['nonce', String(randomNonce())],
    ['engine_model_type', (config.model || '16k_zh').trim()],
    ['voice_id', voiceId],
    ['voice_format', String(DEFAULT_VOICE_FORMAT)],
    ['needvad', config.needVad === false ? '0' : '1'],
    ['filter_dirty', '0'],
    ['filter_modal', '0'],
    ['filter_punc', '0'],
    ['convert_num_mode', '1'],
    ['word_info', String(config.wordInfo ?? 0)],
  ]);

  if (config.hotwordId?.trim()) {
    params.set('hotword_id', config.hotwordId.trim());
  }
  if (config.hotwordList?.trim()) {
    params.set('hotword_list', config.hotwordList.trim());
  }
  if (config.vadSilenceTimeMs && config.vadSilenceTimeMs > 0) {
    params.set('vad_silence_time', String(config.vadSilenceTimeMs));
  }
  if (config.maxSpeakTimeMs && config.maxSpeakTimeMs > 0) {
    params.set('max_speak_time', String(config.maxSpeakTimeMs));
  }

  const sortedEntries = [...params.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  );
  const query = buildQueryString(sortedEntries);
  const signature = await signTencentRealtimeQuery({
    appId,
    query,
    secretKey,
  });

  return {
    signedUrl: `wss://${TENCENT_REALTIME_HOST}${TENCENT_REALTIME_PATH_PREFIX}${appId}?${query}&signature=${encodeURIComponent(signature)}`,
    voiceId,
    expiresAt,
  };
}

async function signTencentRealtimeQuery(params: {
  appId: string;
  query: string;
  secretKey: string;
}) {
  const signTarget = `${TENCENT_REALTIME_HOST}${TENCENT_REALTIME_PATH_PREFIX}${params.appId}?${params.query}`;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(params.secretKey),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(signTarget),
  );

  return arrayBufferToBase64(signature);
}

function buildQueryString(entries: Array<[string, string]>) {
  return entries
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function randomNonce() {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return (values[0] ?? 0) % 1_000_000_000;
}

function getTencentSecretId(config: AsrProviderConfig) {
  if (config.secretId?.trim()) {
    return config.secretId.trim();
  }

  const [legacySecretId] = (config.apiKey ?? '').split(':');
  return legacySecretId?.trim() || '';
}

function getTencentSecretKey(config: AsrProviderConfig) {
  if (config.secretKey?.trim()) {
    return config.secretKey.trim();
  }

  const [, legacySecretKey] = (config.apiKey ?? '').split(':');
  return legacySecretKey?.trim() || '';
}
