import type { DebugSessionData } from '../shared/messages';
import type { DebugExportMode } from './types';

export type DebugPanelProps = {
  debugData: DebugSessionData | null;
  sessionId: string | null;
  slimDebugExportPayload: unknown;
  onExportDebug: (mode: DebugExportMode) => void;
};

export function DebugPanel({
  debugData,
  sessionId,
  slimDebugExportPayload,
  onExportDebug,
}: DebugPanelProps) {
  return (
    <div
      data-testid="debug-panel"
      style={{
        borderTop: '1px solid #d1d5db',
        backgroundColor: '#f8fafc',
        padding: '8px 12px',
        fontSize: 11,
        color: '#334155',
        maxHeight: 220,
        overflowY: 'auto',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          marginBottom: 6,
        }}
      >
        <div style={{ fontWeight: 600 }}>Debug</div>
        <button
          data-testid="debug-export-button"
          type="button"
          onClick={() => onExportDebug('slim')}
          disabled={!debugData}
          style={{
            padding: '2px 8px',
            borderRadius: 4,
            border: '1px solid #cbd5e1',
            backgroundColor: debugData ? 'white' : '#e2e8f0',
            color: '#334155',
            fontSize: 11,
            cursor: debugData ? 'pointer' : 'not-allowed',
          }}
        >
          导出调试 JSON
        </button>
        <button
          data-testid="debug-export-full-button"
          type="button"
          onClick={() => onExportDebug('full')}
          disabled={!debugData}
          style={{
            padding: '2px 8px',
            borderRadius: 4,
            border: '1px solid #cbd5e1',
            backgroundColor: debugData ? 'white' : '#e2e8f0',
            color: '#334155',
            fontSize: 11,
            cursor: debugData ? 'pointer' : 'not-allowed',
          }}
        >
          导出完整调试 JSON
        </button>
      </div>
      <div style={{ marginBottom: 6 }}>
        sessionId: {debugData?.session?.sessionId ?? sessionId ?? 'none'}
      </div>
      <div style={{ marginBottom: 6 }}>
        transcript units: {debugData?.transcripts.length ?? 0}
      </div>
      <div style={{ marginBottom: 6 }}>
        structurer segments: {debugData?.segments.length ?? 0}
      </div>
      <div style={{ marginBottom: 6 }}>
        transcript traces: {debugData?.traces.length ?? 0}
      </div>
      <div style={{ marginBottom: 6 }}>
        structurer runs: {debugData?.structurerRuns?.length ?? 0}
      </div>
      <div style={{ marginBottom: 6 }}>
        merged graph nodes: {debugData?.graph?.nodes.length ?? 0}
      </div>
      <pre
        data-testid="debug-json"
        style={{
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          margin: 0,
          fontFamily: 'monospace',
        }}
      >
        {JSON.stringify(slimDebugExportPayload, null, 2)}
      </pre>
    </div>
  );
}
