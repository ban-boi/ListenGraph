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

const menuItemStyle = {
  display: 'block',
  width: '100%',
  padding: '6px 10px',
  border: 'none',
  background: 'transparent',
  color: 'var(--lg-ink)',
  fontSize: 'var(--text-xs)',
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
        className="lg-btn lg-btn-ghost lg-btn-sm"
        style={{
          backgroundColor: open ? 'var(--lg-calm)' : undefined,
          color: open ? 'var(--lg-signal)' : undefined,
        }}
      >
        更多
        <span
          style={{
            display: 'inline-block',
            marginLeft: 4,
            fontSize: 'var(--text-2xs)',
            transition: 'transform var(--dur-fast) var(--ease-out)',
            transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
          }}
        >
          &#9660;
        </span>
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
            border: '1px solid var(--lg-rim)',
            borderRadius: 'var(--radius-md)',
            backgroundColor: 'var(--lg-surface)',
            boxShadow: 'var(--shadow-md)',
            padding: '4px 0',
            animation: 'fadeIn var(--dur-fast) var(--ease-out)',
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
              color: canExport ? 'var(--lg-ink)' : 'var(--lg-mist)',
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
              color: canExport ? 'var(--lg-ink)' : 'var(--lg-mist)',
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
              color: canExport ? 'var(--lg-ink)' : 'var(--lg-mist)',
            }}
          >
            导出 Mermaid
          </button>
          <div style={{ height: 1, backgroundColor: 'var(--lg-rim)', margin: '4px 0' }} />
          <button
            type="button"
            role="menuitem"
            data-testid="overflow-menu-debug"
            onClick={() => closeAnd(onToggleDebug)}
            style={{
              ...menuItemStyle,
              backgroundColor: debugOpen ? 'var(--lg-calm)' : 'transparent',
              color: debugOpen ? 'var(--lg-signal)' : 'var(--lg-ink)',
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
              color: canReplay ? (replayOpen ? 'var(--lg-signal)' : 'var(--lg-ink)') : 'var(--lg-mist)',
              backgroundColor: replayOpen && canReplay ? 'var(--lg-calm)' : 'transparent',
            }}
          >
            回放
          </button>
          <div style={{ height: 1, backgroundColor: 'var(--lg-rim)', margin: '4px 0' }} />
          <div
            data-testid="build-info"
            style={{
              padding: '6px 10px',
              fontSize: 'var(--text-2xs)',
              color: 'var(--lg-muted)',
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
