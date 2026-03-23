import type { AppMessage } from '../shared/messages';

let audioContext: AudioContext | null = null;
let mediaStream: MediaStream | null = null;
let sourceNode: MediaStreamAudioSourceNode | null = null;
let processorNode: AudioWorkletNode | null = null;
let isCapturing = false;
let hasReportedCaptureEnd = false;

const SAMPLE_RATE = 16000;

chrome.runtime.onMessage.addListener((message: AppMessage | any, _sender, sendResponse) => {
  if (message.target && message.target !== 'content-script') return false;

  switch (message.type) {
    case 'START_CAPTURE':
      startTabCapture()
        .then(() => sendResponse({ success: true }))
        .catch((error: Error) =>
          sendResponse({ success: false, error: error.message }),
        );
      return true;
    case 'STOP_CAPTURE':
      stopCapture()
        .then(() => sendResponse({ success: true }))
        .catch((error: Error) =>
          sendResponse({ success: false, error: error.message }),
        );
      return true;
    case 'SEEK_TO_TIMESTAMP':
      seekToTimestamp(message.payload.timestampMs)
        .then(() => sendResponse({ success: true }))
        .catch((error: Error) =>
          sendResponse({ success: false, error: error.message }),
        );
      return true;
    default:
      return false;
  }
});

async function startTabCapture() {
  if (isCapturing) {
    return;
  }

  try {
    hasReportedCaptureEnd = false;

    // 真实浏览器里通常需要同时请求 tab 视频，音频轨道才会稳定返回。
    const constraints = {
      audio: true,
      video: true,
      preferCurrentTab: true,
      selfBrowserSurface: 'include',
    } as DisplayMediaStreamOptions & Record<string, unknown>;

    mediaStream = await navigator.mediaDevices.getDisplayMedia({
      ...constraints,
    });

    const videoTrack = mediaStream.getVideoTracks()[0];
    const displaySurface = videoTrack?.getSettings?.().displaySurface;
    if (displaySurface && displaySurface !== 'browser') {
      throw new Error('请选择浏览器标签页作为共享目标，而不是整个窗口或屏幕');
    }

    if (mediaStream.getAudioTracks().length === 0) {
      throw new Error('捕获到的流里没有音频轨道');
    }

    mediaStream.getVideoTracks().forEach((track) => {
      track.enabled = false;
    });
    mediaStream.getTracks().forEach((track) => {
      track.onended = () => {
        void reportCaptureEnded('share-ended');
        void stopCapture();
      };
    });

    audioContext = new AudioContext({ sampleRate: SAMPLE_RATE });
    sourceNode = audioContext.createMediaStreamSource(mediaStream);

    const workletUrl = chrome.runtime.getURL('offscreen/audio-processor.worklet.js');
    await audioContext.audioWorklet.addModule(workletUrl);

    processorNode = new AudioWorkletNode(audioContext, 'audio-chunk-processor');
    processorNode.port.onmessage = (event: MessageEvent) => {
      if (event.data?.type !== 'AUDIO_CHUNK') return;

      void chrome.runtime.sendMessage({
        type: 'AUDIO_CHUNK_READY',
        target: 'service-worker',
        payload: {
          audioData: Array.from(new Uint8Array(event.data.audioData)),
          startMs: event.data.startMs,
          endMs: event.data.endMs,
        },
      } as AppMessage);
    };

    sourceNode.connect(processorNode);
    isCapturing = true;
  } catch (error) {
    await stopCapture();
    throw error instanceof Error ? error : new Error('启动标签页采集失败');
  }
}

async function stopCapture() {
  isCapturing = false;

  if (processorNode) {
    processorNode.port.onmessage = null;
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
}

async function reportCaptureEnded(
  reason: 'share-ended' | 'pagehide' | 'beforeunload',
) {
  if (hasReportedCaptureEnd) {
    return;
  }

  hasReportedCaptureEnd = true;
  await chrome.runtime.sendMessage({
    type: 'CAPTURE_ENDED',
    target: 'service-worker',
    payload: { reason },
  } as AppMessage);
}

async function seekToTimestamp(timestampMs: number) {
  const mediaElement = findMediaElement(document);
  if (!mediaElement) {
    throw new Error('当前页面没有可控制的音频或视频元素');
  }

  mediaElement.currentTime = timestampMs / 1000;
}

function findMediaElement(root: Document | ShadowRoot): HTMLMediaElement | null {
  const directMatch = root.querySelector('audio, video');
  if (directMatch instanceof HTMLMediaElement) {
    return directMatch;
  }

  for (const element of Array.from(root.querySelectorAll('*'))) {
    const host = element as HTMLElement & { shadowRoot?: ShadowRoot | null };
    if (host.shadowRoot) {
      const nestedMatch = findMediaElement(host.shadowRoot);
      if (nestedMatch) {
        return nestedMatch;
      }
    }
  }

  return null;
}

window.addEventListener('beforeunload', () => {
  void reportCaptureEnded('beforeunload');
  void stopCapture();
});

window.addEventListener('pagehide', () => {
  void reportCaptureEnded('pagehide');
  void stopCapture();
});
