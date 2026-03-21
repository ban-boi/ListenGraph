// Offscreen Document - 处理音频捕获和处理
// 因为 MV3 Service Worker 没有 DOM，需要 offscreen 来使用 Web Audio API
// 注意：chrome.tabCapture API 只能在 offscreen document 中调用，不能在 service worker 中调用

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
    case 'START_CAPTURE':
      // 注意：tabCapture 现在由 offscreen 自己调用
      console.log('[Offscreen] Starting capture via chrome.tabCapture...');
      startAudioCaptureWithTabCapture()
        .then(() => {
          console.log('[Offscreen] START_CAPTURE completed successfully');
          sendResponse({ success: true });
        })
        .catch((err) => {
          console.error('[Offscreen] START_CAPTURE failed:', err);
          sendResponse({ success: false, error: err.message });
        });
      return true; // 保持消息通道开启

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

// 使用 chrome.tabCapture API 开始音频捕获
// 注意：这个函数在 offscreen document 中执行，可以访问 chrome.tabCapture API
async function startAudioCaptureWithTabCapture() {
  console.log('[Offscreen] Starting audio capture with chrome.tabCapture...');
  const startTime = Date.now();

  try {
    // 检查 tabCapture API 是否可用
    if (!chrome.tabCapture) {
      throw new Error(
        'chrome.tabCapture API is not available in offscreen document',
      );
    }

    // 使用 chrome.tabCapture.capture() 获取音频流
    console.log('[Offscreen] Calling chrome.tabCapture.capture()...');
    const constraints = {
      audio: true,
      video: false,
    };

    mediaStream = await new Promise<MediaStream>((resolve, reject) => {
      chrome.tabCapture.capture!(constraints, (stream: MediaStream | null) => {
        if (chrome.runtime.lastError) {
          reject(
            new Error(chrome.runtime.lastError.message || 'tabCapture failed'),
          );
        } else if (!stream) {
          reject(new Error('tabCapture returned null stream'));
        } else {
          resolve(stream);
        }
      });
    });

    console.log(
      '[Offscreen] Tab capture succeeded after',
      Date.now() - startTime,
      'ms',
    );
    console.log('[Offscreen] Stream ID:', mediaStream.id);
    console.log(
      '[Offscreen] Audio tracks:',
      mediaStream.getAudioTracks().length,
    );

    // 创建 AudioContext
    audioContext = new AudioContext({ sampleRate: SAMPLE_RATE });
    console.log(
      '[Offscreen] AudioContext created with sampleRate:',
      SAMPLE_RATE,
    );

    // 创建源节点
    sourceNode = audioContext.createMediaStreamSource(mediaStream);
    console.log('[Offscreen] MediaStreamSource created');

    // 加载 AudioWorklet
    console.log('[Offscreen] Loading AudioWorklet module...');
    const workletStartTime = Date.now();
    await audioContext.audioWorklet.addModule(
      new URL('./audio-processor.worklet.ts', import.meta.url).href,
    );
    console.log(
      '[Offscreen] AudioWorklet loaded in',
      Date.now() - workletStartTime,
      'ms',
    );

    // 创建处理器节点
    processorNode = new AudioWorkletNode(audioContext, 'audio-chunk-processor');
    console.log('[Offscreen] AudioWorkletNode created');

    // 监听来自 worklet 的音频数据
    processorNode.port.onmessage = (event: MessageEvent) => {
      if (event.data && event.data.type === 'AUDIO_CHUNK') {
        const chunkDurationMs = event.data.endMs - event.data.startMs;
        console.log('[Offscreen] Received audio chunk from worklet:', {
          chunkIndex: event.data.startMs / 30000,
          startMs: event.data.startMs,
          endMs: event.data.endMs,
          durationMs: chunkDurationMs,
          audioDataLength: event.data.audioData.byteLength,
        });

        // 验证是否为预期的 30 秒间隔
        if (Math.abs(chunkDurationMs - 30000) > 100) {
          console.warn(
            '[Offscreen] Unexpected chunk duration:',
            chunkDurationMs,
            'ms (expected 30000ms)',
          );
        }

        // 发送音频 chunk 到 service worker
        chrome.runtime.sendMessage({
          type: 'AUDIO_CHUNK_READY',
          target: 'service-worker',
          payload: {
            audioData: event.data.audioData,
            startMs: event.data.startMs,
            endMs: event.data.endMs,
          },
        });

        console.log('[Offscreen] Sent audio chunk to service worker');
      }
    };

    // 连接节点
    sourceNode.connect(processorNode);
    // 注意：不连接到 destination，避免回放音频
    // processorNode.connect(audioContext.destination);

    console.log(
      '[Offscreen] Audio capture started successfully in',
      Date.now() - startTime,
      'ms',
    );
  } catch (error) {
    console.error('[Offscreen] Failed to start audio capture:', error);
    // 清理可能已创建的资源
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
