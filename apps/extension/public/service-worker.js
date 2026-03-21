// Service Worker - 音频捕获 + ASR + Structurer 协调器

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

  // 注意：chrome.tabCapture 在 MV3 service worker 中不可用
  // 我们通过 offscreen document 来调用 tabCapture API

  try {
    // 创建 offscreen document（如果还没有）
    // 注意：service worker 重启后 offscreenCreated 会丢失，需要先检查
    let hasExistingOffscreen = false;
    try {
      const existingClients = await chrome.runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT'],
      });
      hasExistingOffscreen = existingClients.length > 0;
      console.log(
        '[Service Worker] Existing offscreen docs:',
        existingClients.length,
      );
    } catch (e) {
      console.log('[Service Worker] getContexts not available:', e.message);
    }

    if (!offscreenCreated && !hasExistingOffscreen) {
      console.log('[Service Worker] Creating offscreen document');
      await chrome.offscreen.createDocument({
        url: 'offscreen/offscreen.html',
        reasons: ['USER_MEDIA'],
        justification: 'Audio capture for Listen Graphic',
      });
      offscreenCreated = true;
      console.log('[Service Worker] Offscreen document created');
    } else {
      console.log(
        '[Service Worker] Offscreen document already exists, reusing',
      );
      offscreenCreated = true;
    }

    // 请求 offscreen document 开始捕获
    // 注意：tabCapture 现在由 offscreen 自己调用
    console.log('[Service Worker] Requesting offscreen to start capture');
    await chrome.runtime.sendMessage({
      type: 'START_CAPTURE',
      target: 'offscreen',
      payload: {},
    });
    console.log('[Service Worker] START_CAPTURE message sent');

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

  try {
    // 1. 停止 offscreen 音频捕获
    console.log('[Service Worker] Sending STOP_CAPTURE to offscreen');
    await chrome.runtime.sendMessage({
      type: 'STOP_CAPTURE',
      target: 'offscreen',
      payload: {},
    });

    // 2. 关闭 offscreen document
    if (offscreenCreated) {
      console.log('[Service Worker] Closing offscreen document');
      await chrome.offscreen.closeDocument();
    }
  } catch (error) {
    // 即使停止过程中出错，也要继续清理状态
    console.error(
      '[Service Worker] Error during stop cleanup (continuing with state reset):',
      error,
    );
  } finally {
    // 确保状态总是被重置，无论上面的操作成功还是失败
    console.log('[Service Worker] Resetting session state');
    currentSessionId = null;
    offscreenCreated = false;
    chunkIndex = 0;
    mergedGraph = null;

    try {
      // 4. 通知 sidepanel
      await notifySidepanel('SESSION_STATE_CHANGED', {
        sessionId: currentSessionId,
        state: 'stopped',
      });
    } catch (notifyError) {
      console.error(
        '[Service Worker] Failed to notify sidepanel about stop:',
        notifyError,
      );
    }

    console.log('[Service Worker] Session stopped and state reset');
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
