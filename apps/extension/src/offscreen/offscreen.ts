// Offscreen Document - 预留给后续 tabCapture/offscreen 方案
// 注意：当前扩展主链路并未启用本文件。
// 2026-03 版本实际运行的是 `service-worker -> content-script -> sidepanel`。

let audioContext: AudioContext | null = null;
let mediaStream: MediaStream | null = null;
let sourceNode: MediaStreamAudioSourceNode | null = null;
let processorNode: AudioWorkletNode | null = null;

// 音频配置
const SAMPLE_RATE = 16000;
const CHUNK_DURATION_MS = 30000; // 30 秒一个 chunk

// 监听来自 service worker 的消息
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.target !== 'offscreen') return;

  console.log(
    '[Offscreen] Received message from service worker:',
    message.type,
  );

  switch (message.type) {
    case 'START_CAPTURE_WITH_TRACK':
      // Service Worker 已经调用了 tabCapture，将轨道 ID 传给我们
      console.log(
        '[Offscreen] Starting capture with track ID:',
        message.payload.trackId,
      );
      startAudioCaptureWithTrack(
        message.payload.trackId,
        message.payload.streamId,
      )
        .then(() => {
          console.log('[Offscreen] START_CAPTURE completed successfully');
          sendResponse({ success: true });
        })
        .catch((err) => {
          console.error('[Offscreen] START_CAPTURE failed:', err);
          sendResponse({ success: false, error: err.message });
        });
      return true;

    case 'STOP_CAPTURE':
      console.log('[Offscreen] Processing STOP_CAPTURE');
      stopAudioCapture()
        .then(() => {
          console.log('[Offscreen] STOP_CAPTURE completed successfully');
          sendResponse({ success: true });
        })
        .catch((err) => {
          console.error('[Offscreen] STOP_CAPTURE failed:', err);
          sendResponse({ success: false, error: err.message });
        });
      return true;

    default:
      console.log('[Offscreen] Unknown message type:', message.type);
  }
});

// 使用传入的音频轨道 ID 创建 MediaStream 并处理
async function startAudioCaptureWithTrack(trackId: string, streamId: string) {
  console.log('[Offscreen] Starting audio capture with track ID:', trackId);
  const startTime = Date.now();

  try {
    // 使用 track ID 重建 MediaStream
    // 注意：在 MV3 中我们需要通过 AudioContext 捕获系统音频
    // 这里使用 createMediaStreamSource 从已有流创建

    // 尝试通过 chrome.runtime.connect 方式重建流
    // 由于 Service Worker 已经获取了流，我们需要另一种方式

    // 方案：使用 AudioContext 创建一个"假"的处理流
    // 实际上，在 MV3 中正确的做法是：
    // 1. Service Worker 获取 MediaStream
    // 2. 将 MediaStream 的轨道通过 MessageChannel 传给 offscreen
    // 但 MessageChannel 不能跨上下文传递

    // 替代方案：使用 OffscreenCanvas + AudioWorklet 处理
    // 这里我们创建一个模拟的音频处理流程

    console.log('[Offscreen] Creating AudioContext...');
    audioContext = new AudioContext({ sampleRate: SAMPLE_RATE });

    // 创建一个 MediaStreamDestination 用于接收来自 service worker 的音频
    const mediaStreamDest = audioContext.createMediaStreamDestination();
    console.log('[Offscreen] MediaStreamDestination created');

    // 创建音频处理节点
    console.log('[Offscreen] Loading AudioWorklet module...');
    await audioContext.audioWorklet.addModule(
      new URL('./audio-processor.worklet.ts', import.meta.url).href,
    );
    console.log('[Offscreen] AudioWorklet loaded');

    processorNode = new AudioWorkletNode(audioContext, 'audio-chunk-processor');
    console.log('[Offscreen] AudioWorkletNode created');

    // 连接节点
    mediaStreamDest.stream.getAudioTracks().forEach((track) => {
      // 这里需要连接到处理器
      console.log('[Offscreen] Track ready for processing:', track.id);
    });

    // 注意：由于 MediaStream 不能跨上下文传递，
    // 我们需要一个 content script 作为中间人
    // 简化方案：在 sidepanel 中直接使用 Web Audio API

    console.log(
      '[Offscreen] Audio processing pipeline ready in',
      Date.now() - startTime,
      'ms',
    );

    // 发送就绪消息
    chrome.runtime.sendMessage({
      type: 'OFFSCREEN_READY',
      target: 'service-worker',
      payload: { streamId: mediaStreamDest.stream.id },
    });
  } catch (error) {
    console.error('[Offscreen] Failed to setup audio processing:', error);
    await stopAudioCapture();
    throw error;
  }
}

// 停止音频捕获
async function stopAudioCapture() {
  console.log('[Offscreen] Stopping audio capture');

  if (processorNode) {
    processorNode.disconnect();
    processorNode = null;
  }

  if (sourceNode) {
    sourceNode.disconnect();
    sourceNode = null;
  }

  if (mediaStream) {
    mediaStream.getTracks().forEach((track) => track.stop());
    mediaStream = null;
  }

  if (audioContext) {
    await audioContext.close();
    audioContext = null;
  }

  console.log('[Offscreen] Audio capture stopped');
}
