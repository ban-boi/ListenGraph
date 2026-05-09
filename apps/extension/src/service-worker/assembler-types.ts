import type { TranscriptChunk } from '@listen-graphic/schema';

// ===== 汇编器类型定义 =====

export type PendingStructureBuffer = {
  utterances: TranscriptChunk[];
  startedAt: number;
  updatedAt: number;
  totalChars: number;
  effectiveChars: number;
  sawTerminalPunctuation: boolean;
  sawIncompleteTail: boolean;
};

export type StructureUnitCommitReason =
  | 'commit_rule'
  | 'commit_timeout'
  | 'commit_force_flush'
  | 'merge_with_prev'
  | 'commit_score'
  | 'commit_llm';

export type StructureUnit = {
  unitId: string;
  sourceChunkIds: string[];
  startMs: number;
  endMs: number;
  text: string;
  reason: StructureUnitCommitReason;
  transcript: TranscriptChunk;
};

export type AssemblerSignals = {
  waitMs: number;
  hasBootstrapReadyContext: boolean;
  forceBootstrapExternal: boolean;
  forceBootstrapCompleted: boolean;
  hitHardWait: boolean;
  hitMaxBufferedUtterances: boolean;
  hitMaxBufferedChars: boolean;
};

export type AssemblerDecision =
  | { type: 'skip_current'; reason: string }
  | { type: 'wait'; reason: string; score?: number }
  | { type: 'commit'; reason: StructureUnitCommitReason; score?: number };

// ===== 汇编器配置常量 =====

export const STRUCTURER_WINDOW_SIZE = 3;
export const STRUCTURER_BOOTSTRAP_MIN_CHUNKS = 2;
export const STRUCTURER_BOOTSTRAP_MIN_DURATION_MS = 45_000;
export const STRUCTURER_BOOTSTRAP_MIN_CHAR_COUNT = 160;
export const STRUCTURE_UNIT_ASSEMBLER_ENABLED =
  typeof process !== 'undefined' && process.env?.LISTEN_GRAPHIC_STRUCTURE_UNIT_ASSEMBLER_ENABLED != null
    ? process.env.LISTEN_GRAPHIC_STRUCTURE_UNIT_ASSEMBLER_ENABLED === 'true'
    : true;
export const STRUCTURE_UNIT_SOFT_WAIT_MS = 1_800;
export const STRUCTURE_UNIT_HARD_WAIT_MS = 4_000;
export const STRUCTURE_UNIT_MIN_EFFECTIVE_CHARS_FOR_COMMIT = 28;
export const STRUCTURE_UNIT_MAX_BUFFERED_UTTERANCES = 3;
export const STRUCTURE_UNIT_MAX_BUFFERED_CHARS = 72;
export const STRUCTURE_UNIT_SCORE_COMMIT_THRESHOLD = 2;
export const STRUCTURE_UNIT_SCORE_WAIT_THRESHOLD = 1;
/** 有效字符达到此值时获得额外加分 */
export const SCORE_BONUS_CHAR_THRESHOLD = 40;
/** 有效字符低于此值时扣分 */
export const SCORE_PENALTY_CHAR_THRESHOLD = 8;
/** 最低 utterance 数量获得加分 */
export const SCORE_BONUS_UTTERANCE_MIN = 2;
/** 判定不完整语句的字符上限 */
export const INCOMPLETE_UTTERANCE_CHAR_LIMIT = 6;
/** 判定补全前一句的字符上限 */
export const COMPLETION_AFTER_PREV_CHAR_LIMIT = 8;
