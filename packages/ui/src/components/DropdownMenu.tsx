import { useEffect, useRef, useState } from 'react';

export type DropdownMenuItem = {
  id: string;
  label: string;
  disabled?: boolean;
  /** 渲染为激活/选中态 */
  active?: boolean;
  /** 可选的 data-testid */
  testId?: string;
};

export type DropdownMenuProps = {
  /** 触发按钮文本 */
  triggerLabel: string;
  /** 菜单项列表 */
  items: DropdownMenuItem[];
  /** 选择回调 */
  onSelect: (id: string) => void;
  /** 触发按钮额外的 className */
  triggerClassName?: string;
  /** 底部额外内容（如 build info） */
  footer?: React.ReactNode;
};

export function DropdownMenu({
  triggerLabel,
  items,
  onSelect,
  triggerClassName,
  footer,
}: DropdownMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleMouseDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
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

  const handleSelect = (id: string) => {
    onSelect(id);
    setOpen(false);
  };

  return (
    <div ref={rootRef} data-testid="dropdown-menu" style={{ position: 'relative' }}>
      <button
        type="button"
        data-testid="dropdown-menu-toggle"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
        className={`lg-btn lg-btn-ghost lg-btn-sm ${triggerClassName ?? ''}`}
        style={{
          backgroundColor: open ? 'var(--lg-calm)' : undefined,
          color: open ? 'var(--lg-signal)' : undefined,
        }}
      >
        {triggerLabel}
        <span
          style={{
            display: 'inline-block',
            marginLeft: 4,
            fontSize: 'var(--text-2xs)',
            transition: 'transform var(--dur-fast) var(--ease-out)',
            transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
          }}
        >
          ▼
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
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              data-testid={item.testId}
              disabled={item.disabled}
              onClick={() => handleSelect(item.id)}
              style={{
                display: 'block',
                width: '100%',
                padding: '6px 10px',
                border: 'none',
                background: item.active ? 'var(--lg-calm)' : 'transparent',
                color: item.active
                  ? 'var(--lg-signal)'
                  : item.disabled
                    ? 'var(--lg-mist)'
                    : 'var(--lg-ink)',
                fontSize: 'var(--text-xs)',
                textAlign: 'left',
                cursor: item.disabled ? 'not-allowed' : 'pointer',
              }}
            >
              {item.label}
            </button>
          ))}
          {footer && (
            <>
              <div style={{ height: 1, backgroundColor: 'var(--lg-rim)', margin: '4px 0' }} />
              <div data-testid="build-info" style={{ padding: '6px 10px', fontSize: 'var(--text-2xs)', color: 'var(--lg-muted)', fontFamily: 'monospace', wordBreak: 'break-word' }}>
                {footer}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
