import type { ReplaySessionData } from '../shared/messages';
import { formatTime } from '@listen-graphic/ui';

export type ReplayPanelProps = {
  replayData: ReplaySessionData | null;
  replayPlaying: boolean;
  currentTimeMs: number;
  activeReplayTranscript: { text?: string } | null;
  onTogglePlay: () => void;
  onScrub: (event: React.ChangeEvent<HTMLInputElement>) => void;
};

export function ReplayPanel({
  replayData,
  replayPlaying,
  currentTimeMs,
  activeReplayTranscript,
  onTogglePlay,
  onScrub,
}: ReplayPanelProps) {
  return (
    <div
      data-testid="replay-panel"
      style={{
        borderTop: '1px solid var(--lg-rim)',
        backgroundColor: 'var(--lg-insight-glow)',
        padding: '8px 12px',
        fontSize: 'var(--text-xs)',
        color: 'var(--lg-insight-dim)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: 6,
        }}
      >
        <div style={{ fontWeight: 600 }}>Replay</div>
        <button
          className="lg-btn lg-btn-sm lg-btn-secondary"
          onClick={onTogglePlay}
          disabled={!replayData}
          style={{ cursor: replayData ? 'pointer' : 'not-allowed' }}
        >
          {replayPlaying ? '暂停' : '播放'}
        </button>
        <span>回放时长: {formatTime(replayData?.durationMs ?? 0)}</span>
      </div>
      <input
        type="range"
        min={0}
        max={replayData?.durationMs ?? 0}
        step={1000}
        value={Math.min(currentTimeMs, replayData?.durationMs ?? 0)}
        onChange={onScrub}
        style={{ width: '100%', marginBottom: 6, accentColor: 'var(--lg-signal)', height: 4, cursor: replayData ? 'pointer' : 'not-allowed' }}
      />
      <div style={{ marginBottom: 4 }}>回放当前时间: {formatTime(currentTimeMs)}</div>
      <div>
        当前片段: {activeReplayTranscript?.text ?? '暂无 transcript'}
      </div>
    </div>
  );
}
