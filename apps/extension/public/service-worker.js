// Deprecated: 当前构建不再从本文件生成扩展的 service worker。
// 运行时入口已切换到 `src/service-worker/index.ts` 并输出为 `dist/service-worker.js`。
// 保留此文件仅用于对照旧实现，避免与当前主链路混淆。

let currentSessionId = null;
let offscreenCreated = false;
let chunkIndex = 0;
let mergedGraph = null;

// ============ Mock 数据（后续替换为真实 Provider）===========

const MOCK_TRANSCRIPTS = [
  '今天我们来聊聊 AI 创业的挑战。',
  '大模型公司很难靠 API 获得稳定利润。',
  '推理成本高，而且价格竞争非常激烈。',
  '开源模型的追赶速度比预期快很多。',
  '纯 API 模式可能是一条死路。',
  '那什么样的 AI 公司才能真正赚钱呢？',
  '关键是要做垂直场景的深度整合。',
  '通用能力很难形成真正的壁垒。',
];

const NODE_TYPES = ['claim', 'reason', 'example', 'question', 'conclusion'];
const EDGE_TYPES = ['supports', 'opposes', 'causes', 'follows', 'example_of'];

// Mock ASR：返回假 transcript
function mockTranscribe(startMs, endMs) {
  const text = MOCK_TRANSCRIPTS[chunkIndex % MOCK_TRANSCRIPTS.length];
  chunkIndex++;
  console.log('[Service Worker] Mock ASR:', { text, startMs, endMs });
  return {
    chunkId: `chunk_${Date.now()}`,
    sessionId: currentSessionId,
    text,
    startMs,
    endMs,
    provider: 'mock-asr',
    confidence: 0.9,
  };
}

// Mock Structurer：从 transcript 生成 graph segment
function mockExtractGraph(transcript) {
  const nodeType = NODE_TYPES[Math.floor(Math.random() * NODE_TYPES.length)];
  const speakers = ['主持人', '嘉宾A', '嘉宾B'];

  const nodeId = `n_${Date.now()}`;
  const nodes = [
    {
      id: nodeId,
      type: nodeType,
      text: transcript.text,
      speaker: speakers[Math.floor(Math.random() * speakers.length)],
      timestampMs: transcript.startMs,
      status: 'confirmed',
      confidence: 0.85 + Math.random() * 0.1,
    },
  ];

  // 如果有之前的节点，添加一条边
  const edges = [];
  if (mergedGraph && mergedGraph.nodes.length > 0) {
    const lastNode = mergedGraph.nodes[mergedGraph.nodes.length - 1];
    edges.push({
      id: `e_${Date.now()}`,
      source: lastNode.id,
      target: nodeId,
      type: EDGE_TYPES[Math.floor(Math.random() * EDGE_TYPES.length)],
      confidence: 0.8 + Math.random() * 0.15,
    });
  }

  const segment = {
    segmentId: `seg_${Date.now()}`,
    sessionId: currentSessionId,
    startMs: transcript.startMs,
    endMs: transcript.endMs,
    topic: 'AI 创业讨论',
    nodes,
    edges,
    provider: 'mock-structurer',
  };

  console.log('[Service Worker] Mock Structurer generated segment:', {
    nodeId: segment.nodes[0].id,
    text: segment.nodes[0].text,
  });

  return segment;
}

// 合并 graph segment 到 mergedGraph
function mergeSegment(segment) {
  if (!mergedGraph) {
    mergedGraph = {
      sessionId: currentSessionId,
      revision: 1,
      topics: [
        { topicId: 't1', title: '当前话题', startMs: 0, endMs: segment.endMs },
      ],
      nodes: [...segment.nodes],
      edges: [...segment.edges],
      updatedAt: Date.now(),
    };
  } else {
    mergedGraph = {
      ...mergedGraph,
      revision: mergedGraph.revision + 1,
      nodes: [...mergedGraph.nodes, ...segment.nodes],
      edges: [...mergedGraph.edges, ...segment.edges],
      updatedAt: Date.now(),
    };
  }
  console.log('[Service Worker] Merged graph updated:', {
    nodes: mergedGraph.nodes.length,
    edges: mergedGraph.edges.length,
  });
  return mergedGraph;
}

// ============ Service Worker 核心逻辑 ============

chrome.runtime.onInstalled.addListener(() => {
  console.log('[Service Worker] Service Worker installed');
});

// 启动会话的核心逻辑
async function startSession() {
  console.log('[Service Worker] Starting session...');

  // 检查是否已经在运行
  if (currentSessionId) {
    console.log('[Service Worker] Session already running:', currentSessionId);
    return { success: true, sessionId: currentSessionId, alreadyRunning: true };
  }

  // 获取当前标签页
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    return { success: false, error: 'No active tab' };
  }

  console.log('[Service Worker] Active tab ID:', tab.id);

  try {
    // ========== 核心：先注入 Content Script，再发送消息 ==========
    console.log('[Service Worker] Injecting content script...');

    // 动态注入 content script
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content-script/content-script.js'],
    });

    console.log(
      '[Service Worker] Content script injected, sending START_CAPTURE...',
    );

    // 等待一小段时间确保脚本加载完成
    await new Promise((resolve) => setTimeout(resolve, 100));

    // 向 content script 发送消息
    const response = await chrome.tabs.sendMessage(tab.id, {
      type: 'START_CAPTURE',
      target: 'content-script',
      payload: {},
    });

    console.log('[Service Worker] Content script response:', response);

    if (!response?.success) {
      throw new Error(
        response?.error || 'Content script failed to start capture',
      );
    }

    // 重置状态
    currentSessionId = 'session_' + Date.now();
    chunkIndex = 0;
    mergedGraph = null;

    // 通知 sidepanel 状态变更
    await notifySidepanel('SESSION_STATE_CHANGED', {
      sessionId: currentSessionId,
      state: 'capturing',
    });

    console.log(
      '[Service Worker] Session started successfully:',
      currentSessionId,
    );
    return { success: true, sessionId: currentSessionId };
  } catch (error) {
    console.error('[Service Worker] Failed to start session:', error);
    // 通知 sidepanel 启动失败
    try {
      await notifySidepanel('ERROR', {
        code: 'START_FAILED',
        message: error.message || String(error),
      });
    } catch (notifyError) {
      console.error(
        '[Service Worker] Failed to notify sidepanel about error:',
        notifyError,
      );
    }
    return { success: false, error: error.message || String(error) };
  }
}

// 扩展图标点击监听器
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;
  console.log('[Service Worker] Extension icon clicked for tab:', tab.id);

  await startSession();
});

// 监听来自 sidepanel 和 offscreen 的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.target && message.target !== 'service-worker') return;

  handleMessage(message, sender)
    .then(sendResponse)
    .catch((err) => {
      console.error('[Service Worker] Error handling message:', err);
      sendResponse({ success: false, error: err.message });
    });

  return true; // 保持消息通道开启
});

async function handleMessage(message, _sender) {
  console.log('[Service Worker] Received message:', message.type);
  switch (message.type) {
    case 'SESSION_START':
      // 调用核心启动逻辑
      return await startSession();
    case 'SESSION_STOP':
      return await stopSession();
    case 'AUDIO_CHUNK_READY':
      return await handleAudioChunk(message.payload);
    default:
      console.log('[Service Worker] Unknown message type:', message.type);
      return { success: false, error: 'Unknown message type' };
  }
}

async function stopSession() {
  console.log('[Service Worker] Stopping session');

  // 获取当前标签页
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  try {
    // 通知 content script 停止捕获
    if (tab?.id) {
      console.log('[Service Worker] Sending STOP_CAPTURE to content script');
      await chrome.tabs.sendMessage(tab.id, {
        type: 'STOP_CAPTURE',
        target: 'content-script',
        payload: {},
      });
    }
  } catch (error) {
    console.error('[Service Worker] Error stopping capture:', error.message);
  } finally {
    // 确保状态总是被重置
    console.log('[Service Worker] Resetting session state');
    currentSessionId = null;
    chunkIndex = 0;
    mergedGraph = null;

    try {
      // 通知 sidepanel
      await notifySidepanel('SESSION_STATE_CHANGED', {
        sessionId: currentSessionId,
        state: 'stopped',
      });
    } catch (notifyError) {
      console.log(
        '[Service Worker] Could not notify sidepanel:',
        notifyError.message,
      );
    }

    console.log('[Service Worker] Session stopped');
  }

  return { success: true };
}

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

// 通知 sidepanel
async function notifySidepanel(type, payload) {
  try {
    console.log('[Service Worker] Sending to sidepanel:', type);
    await chrome.runtime.sendMessage({
      type,
      target: 'sidepanel',
      payload,
    });
    console.log('[Service Worker] Message sent successfully');
  } catch (err) {
    // sidepanel 可能还没打开，这很正常
    console.log(
      '[Service Worker] Could not notify sidepanel (may be closed):',
      err.message,
    );
  }
}

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
