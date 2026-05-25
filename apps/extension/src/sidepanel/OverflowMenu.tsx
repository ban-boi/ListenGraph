import { useEffect, useRef, useState } from 'react';
import type { ExportFormat } from '../shared/messages';

export type OverflowMenuProps = {
  canExport: boolean;
  canReplay: boolean;
  debugOpen: boolean;
  replayOpen: boolean;
  buildInfo: { uiLabel: string; workerLabel: string };
  onExport: (format: ExportFormat) => void;
  onToggleDebug: () => void;
  onToggleReplay: () => void;
};

const menuButtonStyle = {
  padding: '4px 8px',
  borderRadius: 4,
  border: '1px solid #d1d5db',
  backgroundColor: 'white',
  color: '#374151',
  fontSize: 11,
  cursor: 'pointer',
} as const;

const menuItemStyle = {
  display: 'block',
  width: '100%',
  padding: '6px 10px',
  border: 'none',
  background: 'transparent',
  color: '#374151',
  fontSize: 11,
  textAlign: 'left' as const,
  cursor: 'pointer',
};

export function OverflowMenu({
  canExport,
  canReplay,
  debugOpen,
  replayOpen,
  buildInfo,
  onExport,
  onToggleDebug,
  onToggleReplay,
}: OverflowMenuProps) {
  const [open, setOpen] = useState(false);
  const menuRootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const handleMouseDown = (event: MouseEvent) => {
      if (!menuRootRef.current?.contains(event.target as globalThis.Node)) {
        setOpen(false);
      }
    };

    const timer = window.setTimeout(() => {
      document.addEventListener('mousedown', handleMouseDown);
    }, 0);

    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('mousedown', handleMouseDown);
    };
  }, [open]);

  const closeAnd = (action: () => void) => {
    action();
    setOpen(false);
  };

  return (
    <div ref={menuRootRef} data-testid="overflow-menu" style={{ position: 'relative' }}>
      <button
        type="button"
        data-testid="overflow-menu-toggle"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((previous) => !previous)}
        style={{
          ...menuButtonStyle,
          backgroundColor: open ? '#eff6ff' : 'white',
          color: open ? '#1d4ed8' : '#374151',
        }}
      >
        更多
      </button>
      {open && (
        <div
          role="menu"
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            zIndex: 20,
            minWidth: 168,
            border: '1px solid #dbe4ee',
            borderRadius: 6,
            backgroundColor: 'white',
            boxShadow: '0 4px 12px rgba(15, 23, 42, 0.12)',
            padding: '4px 0',
          }}
        >
          <button
            type="button"
            role="menuitem"
            data-testid="overflow-menu-export-json"
            disabled={!canExport}
            onClick={() => closeAnd(() => void onExport('json'))}
            style={{
              ...menuItemStyle,
              cursor: canExport ? 'pointer' : 'not-allowed',
              color: canExport ? '#374151' : '#9ca3af',
            }}
          >
            导出 JSON
          </button>
          <button
            type="button"
            role="menuitem"
            data-testid="overflow-menu-export-markdown"
            disabled={!canExport}
            onClick={() => closeAnd(() => void onExport('markdown'))}
            style={{
              ...menuItemStyle,
              cursor: canExport ? 'pointer' : 'not-allowed',
              color: canExport ? '#374151' : '#9ca3af',
            }}
          >
            导出 Markdown
          </button>
          <button
            type="button"
            role="menuitem"
            data-testid="overflow-menu-export-mermaid"
            disabled={!canExport}
            onClick={() => closeAnd(() => void onExport('mermaid'))}
            style={{
              ...menuItemStyle,
              cursor: canExport ? 'pointer' : 'not-allowed',
              color: canExport ? '#374151' : '#9ca3af',
            }}
          >
            导出 Mermaid
          </button>
          <div style={{ height: 1, backgroundColor: '#e5e7eb', margin: '4px 0' }} />
          <button
            type="button"
            role="menuitem"
            data-testid="overflow-menu-debug"
            onClick={() => closeAnd(onToggleDebug)}
            style={{
              ...menuItemStyle,
              backgroundColor: debugOpen ? '#eff6ff' : 'transparent',
              color: debugOpen ? '#1d4ed8' : '#374151',
            }}
          >
            调试
          </button>
          <button
            type="button"
            role="menuitem"
            data-testid="overflow-menu-replay"
            disabled={!canReplay}
            onClick={() => closeAnd(() => void onToggleReplay())}
            style={{
              ...menuItemStyle,
              cursor: canReplay ? 'pointer' : 'not-allowed',
              color: canReplay ? (replayOpen ? '#1d4ed8' : '#374151') : '#9ca3af',
              backgroundColor: replayOpen && canReplay ? '#eff6ff' : 'transparent',
            }}
          >
            回放
          </button>
          <div style={{ height: 1, backgroundColor: '#e5e7eb', margin: '4px 0' }} />
          <div
            data-testid="build-info"
            style={{
              padding: '6px 10px',
              fontSize: 10,
              color: '#64748b',
              fontFamily: 'monospace',
              wordBreak: 'break-word',
            }}
          >
            {`UI ${buildInfo.uiLabel} | Worker ${buildInfo.workerLabel}`}
          </div>
        </div>
      )}
    </div>
  );
}
