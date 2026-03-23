/**
 * SessionOrchestrator - 会话编排器
 *
 * 注意：
 * 2026-03 的扩展主链路暂未启用本文件。
 * 当前实际运行的是 `src/service-worker/index.ts -> content-script -> sidepanel`。
 * 本文件保留为后续切回 `offscreen + orchestrator` 方案时的实验实现。
 *
 * 负责协调整个音频转写和图谱生成流程：
 * 1. 音频数据接收（从 offscreen document）
 * 2. ASR 转写（使用 MockAsrProvider）
 * 3. 结构化提取（使用 MockStructurerProvider）
 * 4. 图谱合并（使用 domain 包的 merge 函数）
 * 5. 数据持久化（使用 ListenGraphicDB）
 */

import { generateId } from '@listen-graphic/shared-utils';
import type {
  MergedGraph,
  SegmentGraph,
  TranscriptChunk,
} from '@listen-graphic/schema';
import { ListenGraphicDB } from '@listen-graphic/storage';
import { MockAsrProvider } from '@listen-graphic/providers';
import { MockStructurerProvider } from '@listen-graphic/providers';

// 导入 merge 函数（需要确认 domain 包中是否存在）
// import { mergeSegmentGraph } from '@listen-graphic/domain';

/**
 * 回调函数类型定义
 */
export interface SessionCallbacks {
  /** 当新的 transcript 生成时调用 */
  onTranscriptReady?: (transcript: TranscriptChunk) => void | Promise<void>;
  /** 当 merged graph 更新时调用 */
  onGraphUpdated?: (graph: MergedGraph) => void | Promise<void>;
  /** 当会话状态变化时调用 */
  onStateChanged?: (state: SessionState) => void | Promise<void>;
}

export type SessionState =
  | 'idle'
  | 'starting'
  | 'recording'
  | 'paused'
  | 'stopping'
  | 'error';

export interface SessionInfo {
  sessionId: string;
  tabId?: number;
  sourceType: 'tab' | 'file';
  state: SessionState;
  startedAt: number;
  pausedAt?: number;
  totalPausedMs: number;
  durationMs: number;
  chunkCount: number;
  lastError?: string;
}

export interface StartOptions {
  tabId?: number;
  file?: File;
}

/**
 * 会话编排器类
 */
export class SessionOrchestrator {
  private db: ListenGraphicDB;
  private asrProvider: MockAsrProvider;
  private structurerProvider: MockStructurerProvider;

  private currentSession: SessionInfo | null = null;
  private pendingAudioChunks: Array<{ audio: Blob; startMs: number }> = [];
  private transcriptWindow: TranscriptChunk[] = [];
  private currentMergedGraph: MergedGraph | null = null;
  private callbacks: SessionCallbacks = {};

  // 配置参数
  private readonly CHUNK_FLUSH_INTERVAL_MS = 5000; // 5秒刷新一次
  private readonly MIN_CHUNK_DURATION_MS = 3000; // 最小片段时长 3秒
  private readonly TRANSCRIPT_WINDOW_SIZE = 5; // 保留最近5个 transcript 用于结构化

  private chunkFlushTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.db = new ListenGraphicDB();
    this.asrProvider = new MockAsrProvider();
    this.structurerProvider = new MockStructurerProvider();
  }

  /**
   * 注册回调函数
   */
  on(callbacks: SessionCallbacks): void {
    this.callbacks = { ...this.callbacks, ...callbacks };
  }

  /**
   * 启动一个新会话
   */
  async start(options: StartOptions): Promise<void> {
    if (this.currentSession?.state === 'recording') {
      throw new Error('已有会话正在录制中');
    }

    const sessionId = generateId('session');
    const sourceType: 'tab' | 'file' = options.file ? 'file' : 'tab';

    // 重置 providers 状态
    this.asrProvider.reset();

    // 创建会话记录
    const sessionRecord = {
      sessionId,
      sourceType,
      createdAt: Date.now(),
    };

    await this.db.sessions.add(sessionRecord);

    // 初始化当前会话状态
    this.currentSession = {
      sessionId,
      tabId: options.tabId,
      sourceType,
      state: 'recording',
      startedAt: Date.now(),
      totalPausedMs: 0,
      durationMs: 0,
      chunkCount: 0,
    };

    // 重置内部状态
    this.pendingAudioChunks = [];
    this.transcriptWindow = [];
    this.currentMergedGraph = null;

    // 启动定时刷新
    this.startChunkFlushTimer();

    // 通知状态变化
    this.callbacks.onStateChanged?.(this.currentSession.state);

    console.log('[SessionOrchestrator] 会话已启动:', sessionId);
  }

  /**
   * 停止当前会话
   */
  async stop(): Promise<void> {
    if (!this.currentSession) {
      throw new Error('没有活动的会话');
    }

    this.currentSession.state = 'stopping';

    // 停止定时刷新
    this.stopChunkFlushTimer();

    // 处理所有待处理的音频块
    await this.flushAllChunks();

    // 更新会话记录
    await this.db.sessions.update(this.currentSession.sessionId, {
      endedAt: Date.now(),
    });

    const sessionId = this.currentSession.sessionId;
    this.currentSession = null;

    console.log('[SessionOrchestrator] 会话已停止:', sessionId);
  }

  /**
   * 暂停会话
   */
  async pause(): Promise<void> {
    if (!this.currentSession || this.currentSession.state !== 'recording') {
      throw new Error('没有正在录制的会话');
    }

    this.currentSession.state = 'paused';
    this.currentSession.pausedAt = Date.now();

    // 停止定时刷新
    this.stopChunkFlushTimer();

    console.log('[SessionOrchestrator] 会话已暂停');
  }

  /**
   * 恢复会话
   */
  async resume(): Promise<void> {
    if (!this.currentSession || this.currentSession.state !== 'paused') {
      throw new Error('没有暂停的会话');
    }

    // 计算暂停时长
    const pausedDuration = Date.now() - (this.currentSession.pausedAt || 0);
    this.currentSession.totalPausedMs += pausedDuration;
    this.currentSession.pausedAt = undefined;
    this.currentSession.state = 'recording';

    // 重新启动定时刷新
    this.startChunkFlushTimer();

    console.log('[SessionOrchestrator] 会话已恢复');
  }

  /**
   * 获取当前会话状态
   */
  getState(): SessionState {
    if (!this.currentSession) {
      return 'idle';
    }
    return this.currentSession.state;
  }

  /**
   * 获取当前会话信息
   */
  getSessionInfo(): SessionInfo | null {
    return this.currentSession;
  }

  /**
   * 添加音频数据（从 offscreen document 接收）
   */
  async addAudioData(audio: Blob, startMs: number): Promise<void> {
    if (!this.currentSession || this.currentSession.state !== 'recording') {
      console.warn('[SessionOrchestrator] 会话未在录制状态，忽略音频数据');
      return;
    }

    this.pendingAudioChunks.push({ audio, startMs });

    // 更新会话时长
    this.currentSession.durationMs = startMs;

    console.log('[SessionOrchestrator] 添加音频块:', {
      startMs,
      size: audio.size,
      pendingCount: this.pendingAudioChunks.length,
    });
  }

  /**
   * 启动定时刷新
   */
  private startChunkFlushTimer(): void {
    if (this.chunkFlushTimer) {
      clearInterval(this.chunkFlushTimer);
    }

    this.chunkFlushTimer = setInterval(() => {
      this.flushPendingChunks().catch((error) => {
        console.error('[SessionOrchestrator] 定时刷新失败:', error);
        this.setError(error.message);
      });
    }, this.CHUNK_FLUSH_INTERVAL_MS);
  }

  /**
   * 停止定时刷新
   */
  private stopChunkFlushTimer(): void {
    if (this.chunkFlushTimer) {
      clearInterval(this.chunkFlushTimer);
      this.chunkFlushTimer = null;
    }
  }

  /**
   * 刷新待处理的音频块
   */
  private async flushPendingChunks(): Promise<void> {
    if (this.pendingAudioChunks.length === 0) {
      return;
    }

    // 获取会话开始后的实际时间（扣除暂停时间）
    const sessionStartRealTime = this.currentSession!.startedAt;
    const totalPausedMs = this.currentSession!.totalPausedMs;
    const currentRealTime = Date.now();
    const elapsedMs = currentRealTime - sessionStartRealTime - totalPausedMs;

    // 查找可以刷新的音频块
    const flushableChunks: typeof this.pendingAudioChunks = [];
    const remainingChunks: typeof this.pendingAudioChunks = [];

    for (const chunk of this.pendingAudioChunks) {
      // 如果这个块的结束时间已经超过了最小片段时长
      if (chunk.startMs + this.MIN_CHUNK_DURATION_MS <= elapsedMs) {
        flushableChunks.push(chunk);
      } else {
        remainingChunks.push(chunk);
      }
    }

    this.pendingAudioChunks = remainingChunks;

    // 处理可刷新的块
    for (const { audio, startMs } of flushableChunks) {
      await this.processAudioChunk(audio, startMs);
    }

    if (flushableChunks.length > 0) {
      console.log('[SessionOrchestrator] 刷新了', flushableChunks.length, '个音频块');
    }
  }

  /**
   * 处理所有待处理的块（停止时调用）
   */
  private async flushAllChunks(): Promise<void> {
    const chunks = [...this.pendingAudioChunks];
    this.pendingAudioChunks = [];

    for (const { audio, startMs } of chunks) {
      await this.processAudioChunk(audio, startMs);
    }
  }

  /**
   * 处理单个音频块
   */
  private async processAudioChunk(audio: Blob, startMs: number): Promise<void> {
    const session = this.currentSession!;
    const endMs = startMs + audio.size / 1000; // 简单估算结束时间

    // 1. ASR 转写
    const transcriptChunk = await this.asrProvider.transcribeChunk({
      audio,
      startMs,
      endMs,
      sessionId: session.sessionId,
      language: 'zh',
    });

    // 2. 保存 transcript 到数据库
    await this.db.transcriptChunks.add(transcriptChunk);
    session.chunkCount++;

    // 3. 更新 transcript 窗口
    this.transcriptWindow.push(transcriptChunk);
    if (this.transcriptWindow.length > this.TRANSCRIPT_WINDOW_SIZE) {
      this.transcriptWindow.shift();
    }

    // 通知 transcript 就绪
    this.callbacks.onTranscriptReady?.(transcriptChunk);

    // 4. 结构化提取（当有足够数据时）
    if (this.transcriptWindow.length >= 2) {
      await this.extractAndMergeGraph();
    }
  }

  /**
   * 提取片段图谱并合并到全局图谱
   */
  private async extractAndMergeGraph(): Promise<void> {
    const session = this.currentSession!;

    try {
      // 1. 调用结构化 provider
      const segmentGraph = await this.structurerProvider.extractSegmentGraph({
        sessionId: session.sessionId,
        transcriptWindow: [...this.transcriptWindow],
        previousGraph: this.currentMergedGraph || undefined,
        language: 'zh',
      });

      // 2. 保存片段图谱
      await this.db.segmentGraphs.add(segmentGraph);

      // 3. 合并到全局图谱
      // 注意：这里需要 domain 包中的 mergeSegmentGraph 函数
      // 目前先简单处理，直接创建新的 MergedGraph
      if (!this.currentMergedGraph) {
        this.currentMergedGraph = {
          sessionId: session.sessionId,
          revision: 1,
          topics: segmentGraph.topic
            ? [
                {
                  topicId: generateId('topic'),
                  title: segmentGraph.topic,
                  startMs: segmentGraph.startMs,
                  endMs: segmentGraph.endMs,
                },
              ]
            : [],
          nodes: segmentGraph.nodes,
          edges: segmentGraph.edges,
          updatedAt: Date.now(),
        };
      } else {
        // 简单追加（实际应该使用 mergeSegmentGraph）
        this.currentMergedGraph = {
          ...this.currentMergedGraph,
          revision: this.currentMergedGraph.revision + 1,
          nodes: [...this.currentMergedGraph.nodes, ...segmentGraph.nodes],
          edges: [...this.currentMergedGraph.edges, ...segmentGraph.edges],
          updatedAt: Date.now(),
        };
      }

      // 4. 保存合并图谱
      await this.db.mergedGraphs.add(this.currentMergedGraph);

      // 通知图谱更新
      this.callbacks.onGraphUpdated?.(this.currentMergedGraph);

      console.log('[SessionOrchestrator] 图谱已更新:', {
        revision: this.currentMergedGraph.revision,
        nodeCount: this.currentMergedGraph.nodes.length,
        edgeCount: this.currentMergedGraph.edges.length,
      });
    } catch (error) {
      console.error('[SessionOrchestrator] 图谱提取失败:', error);
      this.setError(error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * 设置错误状态
   */
  private setError(message: string): void {
    if (this.currentSession) {
      this.currentSession.state = 'error';
      this.currentSession.lastError = message;
    }
  }

  /**
   * 清理资源
   */
  dispose(): void {
    this.stopChunkFlushTimer();
    this.currentSession = null;
    this.pendingAudioChunks = [];
    this.transcriptWindow = [];
    this.currentMergedGraph = null;
  }
}
