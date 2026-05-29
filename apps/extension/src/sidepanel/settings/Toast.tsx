// ---------------------------------------------------------------------------
// Toast 通知组件 —— 用于保存成功/失败的即时反馈
// 替代 console.log 方式，在窄侧边栏底部居中显示
// ---------------------------------------------------------------------------

import { useEffect, useState, useCallback } from 'react';
import { fontSize, colors } from './theme';

// ── 类型 ──────────────────────────────────────────────────────────────────

export type ToastProps = {
  /** 显示内容，null 时不渲染 */
  message: string | null;
  /** 通知类型：成功或错误 */
  type: 'success' | 'error';
  /** 自动消失延迟（毫秒），默认 3000 */
  durationMs?: number;
  /** 消失后的回调 */
  onDismiss: () => void;
};

export type ToastState = {
  message: string | null;
  type: 'success' | 'error';
};

// ── 颜色映射 ──────────────────────────────────────────────────────────────

const toastColors = {
  success: {
    background: colors.successBg,  // #ecfdf5
    border: 'var(--lg-success)',
    text: 'var(--lg-success)',
  },
  error: {
    background: colors.errorBg,    // #fef2f2
    border: 'var(--lg-danger)',
    text: 'var(--lg-danger)',
  },
} as const;

// ── Toast 组件 ────────────────────────────────────────────────────────────

export function Toast({ message, type, durationMs = 3000, onDismiss }: ToastProps) {
  // 用于控制淡入动画
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (message === null) return;

    // 下一帧触发淡入
    const raf = requestAnimationFrame(() => setVisible(true));

    const timer = setTimeout(() => {
      setVisible(false);
      // 等淡出动画结束后再触发 onDismiss
      setTimeout(onDismiss, 200);
    }, durationMs);

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
    };
  }, [message, durationMs, onDismiss]);

  if (message === null) return null;

  const palette = toastColors[type];

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 8,
        left: '50%',
        transform: `translateX(-50%) translateY(${visible ? '0' : '8px'})`,
        opacity: visible ? 1 : 0,
        maxWidth: 280,
        width: 'auto',
        textAlign: 'center',
        fontSize: fontSize.base,
        padding: '6px 12px',
        borderRadius: 4,
        backgroundColor: palette.background,
        border: `1px solid ${palette.border}`,
        color: palette.text,
        boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
        zIndex: 9999,
        transition: 'opacity 200ms ease, transform 200ms ease',
        pointerEvents: 'none',
        whiteSpace: 'nowrap',
      }}
    >
      {message}
    </div>
  );
}

// ── useToast hook ─────────────────────────────────────────────────────────

export function useToast(): {
  toast: ToastState;
  showSuccess: (msg: string) => void;
  showError: (msg: string) => void;
  dismiss: () => void;
} {
  const [toast, setToast] = useState<ToastState>({
    message: null,
    type: 'success',
  });

  const showSuccess = useCallback((msg: string) => {
    setToast({ message: msg, type: 'success' });
  }, []);

  const showError = useCallback((msg: string) => {
    setToast({ message: msg, type: 'error' });
  }, []);

  const dismiss = useCallback(() => {
    setToast((prev) => ({ ...prev, message: null }));
  }, []);

  return { toast, showSuccess, showError, dismiss };
}
