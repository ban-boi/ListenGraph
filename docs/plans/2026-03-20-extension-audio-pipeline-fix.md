# Extension Audio Pipeline Fix Implementation Plan

> 2026-03 baseline note:
> This plan is obsolete and retained only as historical context.
> It targets `apps/extension/public/service-worker.js` and a `tabCapture + offscreen` path that is no longer the active mainline.
> For the current baseline, use `docs/plans/2026-03-21-extension-execution-baseline.md`.

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the ListenGraph Chrome Extension audio capture pipeline to properly process audio from browser tabs through mock ASR and structuring providers, generating real-time graph updates in the sidepanel with working start/stop functionality.

**Architecture:** Fix the core audio processing pipeline in the service worker by implementing correct tabCapture API usage, ensuring proper message passing between service worker, offscreen document, and sidepanel, and resetting session state correctly to enable restart functionality.

**Tech Stack:** Chrome Extension (MV3), JavaScript, Web Audio API, AudioWorklet, React Flow, Mock ASR/Structuring providers

---

### Task 1: Fix service worker tabCapture implementation

**Files:**

- Modify: `apps/extension/public/service-worker.js:113-116`

**Step 1: Write the failing test**

We'll verify this works by:

1. Loading the extension in Chrome
2. Clicking the extension icon
3. Checking if tabCapture succeeds without error
4. Seeing appropriate logs in service worker console

**Step 2: Replace incorrect tabCapture API usage**

Replace the current click handler (lines 113-116) with proper tabCapture implementation:

```javascript
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;
  console.log(
    '[Service Worker] Extension icon clicked, requesting tab capture for tab:',
    tab.id,
  );

  // Use correct tabCapture API with constraints
  const constraints = {
    audio: true,
    video: false,
  };

  try {
    const stream = await new Promise((resolve, reject) => {
      chrome.tabCapture.capture(constraints, (stream) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve(stream);
        }
      });
    });

    console.log('[Service Worker] Got audio stream');

    if (!offscreenCreated) {
      console.log('[Service Worker] Creating offscreen document');
      await chrome.offscreen.createDocument({
        url: 'offscreen/offscreen.html',
        reasons: ['USER_MEDIA'],
        justification: 'Audio capture for Listen Graphic',
      });
      offscreenCreated = true;
      console.log('[Service Worker] Offscreen document created');
    }

    // Send audio stream to offscreen for processing
    await chrome.runtime.sendMessage({
      type: 'START_AUDIO_PROCESSING',
      target: 'offscreen',
      payload: { stream },
    });

    // Reset session state
    currentSessionId = 'session_' + Date.now();
    chunkIndex = 0;
    mergedGraph = null;

    // Notify sidepanel
    await notifySidepanel('SESSION_STATE_CHANGED', {
      sessionId: currentSessionId,
      state: 'capturing',
    });

    console.log('[Service Worker] Session started:', currentSessionId);
    return { success: true, sessionId: currentSessionId };
  } catch (error) {
    console.error('[Service Worker] Failed to start session:', error);
    throw error;
  }
});
```

**Step 3: Test the implementation**

- Build extension: `cd apps/extension && pnpm vite build`
- Reload extension in Chrome
- Click extension icon
- Check service worker console for "Got audio stream" and "Session started"

**Step 4: Commit**

```bash
git add apps/extension/public/service-worker.js
git commit -m "fix: implement correct tabCapture API usage"
```

### Task 2: Fix offscreen document to handle MediaStream and process audio

**Files:**

- Modify: `apps/extension/src/offscreen/offscreen.ts`

**Step 1: Write the failing test**

- Verify offscreen document can receive MediaStream from service worker
- Verify it initializes AudioContext and AudioWorklet correctly
- Verify it sends AUDIO_CHUNK_READY messages back to service worker

**Step 2: Update offscreen.ts to handle MediaStream**

Replace the content of offscreen.ts with:

```typescript
// Offscreen Document - 处理音频捕获和处理
// 因为 MV3 Service Worker 没有 DOM，需要 offscreen 来使用 Web Audio API

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

  switch (message.type) {
    case 'START_AUDIO_PROCESSING':
      startAudioProcessing(message.stream)
        .then(() => sendResponse({ success: true }))
        .catch((err) => sendResponse({ success: false, error: err.message }));
      return true; // 保持消息通道开启

    case 'STOP_AUDIO_PROCESSING':
      stopAudioProcessing()
        .then(() => sendResponse({ success: true }))
        .catch((err) => sendResponse({ success: false, error: err.message }));
      return true;

    default:
      console.log('[Offscreen] Unknown message type:', message.type);
  }
});

// 开始音频处理
async function startAudioProcessing(stream: MediaStream) {
  console.log('[Offscreen] Starting audio processing');

  // 创建 AudioContext
  audioContext = new AudioContext({ sampleRate: SAMPLE_RATE });

  // 使用传入的媒体流
  mediaStream = stream;

  // 创建源节点
  sourceNode = audioContext.createMediaStreamSource(mediaStream);

  // 加载 AudioWorklet
  await audioContext.audioWorklet.addModule(
    new URL('./audio-processor.worklet.ts', import.meta.url).href,
  );

  // 创建处理器节点
  processorNode = new AudioWorkletNode(audioContext, 'audio-chunk-processor');

  // 监听来自 worklet 的音频数据
  processorNode.port.onmessage = (event) => {
    if (event.data.type === 'AUDIO_CHUNK') {
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
    }
  };

  // 连接节点
  sourceNode.connect(processorNode);
  // 不连接到 destination，避免回放音频

  console.log('[Offscreen] Audio processing started');
}

// 停止音频处理
async function stopAudioProcessing() {
  console.log('[Offscreen] Stopping audio processing');

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

  console.log('[Offscreen] Audio processing stopped');
}
```

**Step 3: Test the implementation**

- Build extension
- Reload in Chrome
- Start capture
- Check offscreen console for "Audio processing started"

**Step 4: Commit**

```bash
git add apps/extension/src/offscreen/offscreen.ts
git commit -m "fix: implement proper MediaStream handling in offscreen document"
```

### Task 3: Add missing AUDIO_CHUNK_READY handling in service worker

**Files:**

- Modify: `apps/extension/public/service-worker.js`

**Step 1: Write the failing test**

- Verify service worker receives AUDIO_CHUNK_READY from offscreen
- Verify it processes the chunk through mock ASR → structurer → merge pipeline

**Step 2: Add message listener for AUDIO_CHUNK_READY from offscreen**

Add this to the existing message listener in service-worker.js (around line 118):

```javascript
// 处理来自 offscreen 的音频数据
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target && message.target !== 'service-worker') return;

  if (message.type === 'AUDIO_CHUNK_READY') {
    console.log('[Service Worker] Received audio chunk from offscreen');
    handleAudioChunk(message.payload)
      .then((result) => sendResponse(result))
      .catch((err) => {
        console.error('[Service Worker] Error processing audio chunk:', err);
        sendResponse({ success: false, error: err.message });
      });
    return true;
  }

  return false;
});
```

**Step 3: Test the implementation**

- Build extension
- Reload in Chrome
- Start capture
- Check service worker console for "Received audio chunk from offscreen"

**Step 4: Commit**

```bash
git add apps/extension/public/service-worker.js
git commit -m "fix: add AUDIO_CHUNK_READY message handling from offscreen document"
```

### Task 4: Fix session state reset in stopSession

**Files:**

- Modify: `apps/extension/public/service-worker.js:184-211`

**Step 1: Write the failing test**

- Verify that after stopping a session, starting again works correctly
- Verify that mergedGraph, chunkIndex, etc. are properly reset

**Step 2: Update stopSession function**

Replace the stopSession function (lines 184-211) with:

```javascript
async function stopSession() {
  console.log('[Service Worker] Stopping session');

  try {
    // 1. 停止 offscreen 音频捕获
    console.log('[Service Worker] Sending STOP_AUDIO_PROCESSING to offscreen');
    await chrome.runtime.sendMessage({
      type: 'STOP_AUDIO_PROCESSING',
      target: 'offscreen',
      payload: {},
    });

    // 2. 关闭 offscreen document
    if (offscreenCreated) {
      console.log('[Service Worker] Closing offscreen document');
      await chrome.offscreen.closeDocument();
      offscreenCreated = false;
    }

    // 3. 重置所有状态变量
    console.log('[Service Worker] Resetting session state');
    currentSessionId = null;
    offscreenCreated = false;
    chunkIndex = 0;
    mergedGraph = null;

    // 4. 通知 sidepanel
    await notifySidepanel('SESSION_STATE_CHANGED', {
      sessionId: currentSessionId,
      state: 'stopped',
    });

    console.log('[Service Worker] Session stopped and state reset');
    return { success: true };
  } catch (error) {
    console.error('[Service Worker] Failed to stop session:', error);
    throw error;
  }
}
```

**Step 3: Test the implementation**

- Build extension
- Reload in Chrome
- Start session → wait for some chunks → stop session
- Start session again → verify it works (should not fail)

**Step 4: Commit**

```bash
git add apps/extension/public/service-worker.js
git commit -m "fix: properly reset session state in stopSession"
```

### Task 5: Add comprehensive logging throughout the pipeline

**Files:**

- Modify: `apps/extension/public/service-worker.js`

**Step 1: Write the failing test**

- Verify we see logs at each stage: capturing started, receiving chunk, ASR processing, structuring, merging, sending to sidepanel

**Step 2: Enhance logging in handleAudioChunk function**

Replace the handleAudioChunk function (lines 214-271) with:

```javascript
// 核心：音频 chunk → ASR → Structurer → Merge → Sidepanel
async function handleAudioChunk(payload) {
  console.log('[Service Worker] Processing audio chunk:', {
    startMs: payload.startMs,
    endMs: payload.endMs,
    size: payload.audioData.byteLength,
  });

  if (!currentSessionId) {
    console.log('[Service Worker] No active session, ignoring chunk');
    return { success: false, error: 'No active session' };
  }

  try {
    // 1. ASR 转写
    await notifySidepanel('SESSION_STATE_CHANGED', {
      sessionId: currentSessionId,
      state: 'transcribing',
    });

    const transcript = mockTranscribe(payload.startMs, payload.endMs);
    console.log(
      '[Service Worker] Transcript received:',
      `"${transcript.text}"`,
    );

    await notifySidepanel('TRANSCRIPT_READY', { transcript });

    // 2. 结构抽取
    await notifySidepanel('SESSION_STATE_CHANGED', {
      sessionId: currentSessionId,
      state: 'structuring',
    });

    const segment = mockExtractGraph(transcript);
    console.log('[Service Worker] Segment generated:', {
      nodeId: segment.nodes[0]?.id,
      text: segment.nodes[0]?.text?.substring(0, 30) + '...',
      nodes: segment.nodes.length,
      edges: segment.edges.length,
    });

    // 3. 合并到总图
    const updatedGraph = mergeSegment(segment);
    console.log('[Service Worker] Merged graph updated:', {
      nodes: updatedGraph.nodes.length,
      edges: updatedGraph.edges.length,
      revision: updatedGraph.revision,
    });

    // 4. 发送给 sidepanel
    await notifySidepanel('MERGED_GRAPH_UPDATED', { graph: updatedGraph });

    // 5. 恢复捕获状态
    await notifySidepanel('SESSION_STATE_CHANGED', {
      sessionId: currentSessionId,
      state: 'capturing',
    });

    console.log('[Service Worker] Chunk processed successfully');
    return { success: true };
  } catch (error) {
    console.error('[Service Worker] Error processing chunk:', error);
    await notifySidepanel('ERROR', {
      code: 'CHUNK_PROCESS_ERROR',
      message: error.message,
    });
    return { success: false, error: error.message };
  }
}
```

**Step 3: Test the implementation**

- Build extension
- Reload in Chrome
- Start capture
- Watch service worker console for detailed logs at each stage

**Step 4: Commit**

```bash
git add apps/extension/public/service-worker.js
git commit -m "fix: add comprehensive logging to audio processing pipeline"
```

### Task 6: Verify mock data generation produces varied output

**Files:**

- Modify: `apps/extension/packages/providers/src/mock/mock-asr.ts`
- Modify: `apps/extension/packages/providers/src/mock/mock-structurer.ts`

**Step 1: Write the failing test**

- Verify mockTranscribe returns different text for different chunks
- Verify mockExtractGraph creates different node types and edges

**Step 2: Enhance mock-asr.ts to avoid repetition**

Replace mockTranscribe function in mock-asr.ts:

```typescript
async function mockTranscribe(
  startMs: number,
  endMs: number,
): Promise<TranscriptChunk> {
  // 模拟 ASR 处理延迟
  await new Promise((resolve) => setTimeout(resolve, 200));

  // 使用更丰富的mock数据并确保变化
  const textIndex = Math.floor(Math.random() * MOCK_TRANSCRIPTS.length);
  const text = MOCK_TRANSCRIPTS[textIndex];

  // 生成假的 token 数据
  const words = text.split(' ');
  const durationMs = endMs - startMs;
  const msPerWord = durationMs / Math.max(words.length, 1);

  const tokens = words.map((word, i) => ({
    text: word,
    startMs: startMs + i * msPerWord,
    endMs: startMs + (i + 1) * msPerWord,
    confidence: 0.8 + Math.random() * 0.15, // 0.8 - 0.95
  }));

  const chunk: TranscriptChunk = {
    chunkId: `chunk_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    sessionId: input.sessionId,
    text,
    startMs: input.startMs,
    endMs: input.endMs,
    tokens,
    provider: this.name,
    confidence: 0.9,
    raw: {
      audioSize:
        input.audio instanceof Blob ? input.audio.size : input.audio.byteLength,
      language: input.language || 'zh',
    },
  };

  console.log('[MockAsrProvider] Generated transcript:', {
    chunkId: chunk.chunkId,
    text: chunk.text.substring(0, 50) + (chunk.text.length > 50 ? '...' : ''),
    startMs: chunk.startMs,
    endMs: chunk.endMs,
  });

  return chunk;
}
```

**Step 3: Test the implementation**

- Build extension
- Reload in Chrome
- Start capture and let it run for several chunks
- Check service worker console for varied transcript text

**Step 4: Commit**

```bash
git add packages/providers/src/mock/mock-asr.ts
git commit -m "fix: enhance mock ASR to produce varied output"
```

### Task 7: Final integration test

**Files:**

- Test: Manual verification in Chrome

**Step 1: Write the failing test**

- Verify complete flow works: start → audio processing → graph updates → stop → restart

**Step 2: Perform integration test**

1. Build extension: `cd apps/extension && pnpm vite build`
2. Go to chrome://extensions/
3. Click "Load unpacked" and select the dist directory
4. Click the extension icon to open sidepanel
5. Play some audio in a browser tab (YouTube, etc.)
6. Click "开始" (Start) button
7. Wait 30-60 seconds and observe:
   - Service worker console shows processing logs
   - Sidepanel shows "状态: 捕获中"
   - Sidepanel log shows transcript receptions
   - Sidepanel log shows graph updates with increasing node count
   - Graph in sidepanel updates with new nodes
8. Click "停止" (Stop) button
9. Verify state resets to idle
10. Wait 10 seconds, then click "开始" again
11. Verify it works again (second session starts successfully)
12. Check that node count continues from where it left off or resets appropriately

**Step 3: Document success criteria**

- [ ] Extension loads without errors in Chrome
- [ ] Clicking start begins audio capture (requires audio playing in tab)
- [ ] Logs show: "Processing audio chunk", "Mock ASR:", "Mock Structurer generated segment:", "Merged graph updated:", "Sending to sidepanel: MERGED_GRAPH_UPDATED"
- [ ] Sidepanel graph updates with new nodes approximately every 30 seconds
- [ ] Stopping resets state and allows starting again
- [ ] No JavaScript errors in console
- [ ] Build succeeds: `pnpm build` in extension directory

**Step 4: Commit**

```bash
git add .
git commit -m "feat: complete audio pipeline integration tested and working"
```

## Plan Complete and Saved

**Plan complete and saved to `docs/plans/2026-03-20-extension-audio-pipeline-fix.md`. Two execution options:**

**1. Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints

**Which approach?**
