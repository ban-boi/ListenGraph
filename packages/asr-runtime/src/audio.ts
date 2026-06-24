// 主机无关的音频编码工具：Float32 采样 ↔ PCM16，以及字节 → base64。
// 不依赖 Node Buffer，可在浏览器 content-script 与 Node 双环境运行。

/**
 * 将 [-1, 1] 的 Float32 采样钳位并转换为 16 位有符号整数（PCM_S16LE 样本）。
 * 负数按 32768 缩放、正数按 32767 缩放，避免正满幅溢出。
 */
export function float32ToPcm16(samples: Float32Array): Int16Array {
  const pcm = new Int16Array(samples.length);
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index]));
    pcm[index] = sample < 0 ? Math.round(sample * 32768) : Math.round(sample * 32767);
  }
  return pcm;
}

const BASE64_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * 将字节序列编码为 base64 字符串，不使用 Node 的 Buffer。
 * 不足 3 字节的尾部按标准补 '=' 填充。
 */
export function bytesToBase64(bytes: Uint8Array): string {
  let result = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index] ?? 0;
    const b = bytes[index + 1] ?? 0;
    const c = bytes[index + 2] ?? 0;
    const value = (a << 16) | (b << 8) | c;
    result += BASE64_ALPHABET[(value >> 18) & 63];
    result += BASE64_ALPHABET[(value >> 12) & 63];
    result += index + 1 < bytes.length ? BASE64_ALPHABET[(value >> 6) & 63] : '=';
    result += index + 2 < bytes.length ? BASE64_ALPHABET[value & 63] : '=';
  }
  return result;
}
