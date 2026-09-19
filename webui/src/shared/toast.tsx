import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

type ToastKind = 'info' | 'success' | 'error';

interface ToastAction {
  label: string;
  onClick: () => void;
}

interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
  /** Sticky toasts never auto-dismiss (update available, install hints). */
  sticky?: boolean;
  action?: ToastAction;
}

interface ToastApi {
  info: (message: string) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  /** Persistent toast with an action button; returns a dismiss function. */
  sticky: (message: string, action?: ToastAction) => () => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const MAX_TOASTS = 4;
const DISMISS_MS: Record<ToastKind, number> = { info: 5000, success: 5000, error: 8000 };

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Map<number, number>());

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
    const timer = timers.current.get(id);
    if (timer) window.clearTimeout(timer);
    timers.current.delete(id);
  }, []);

  const push = useCallback((kind: ToastKind, message: string, options: { sticky?: boolean; action?: ToastAction } = {}) => {
    const id = nextId.current++;
    setToasts((current) => [...current.slice(-(MAX_TOASTS - 1)), { id, kind, message, ...options }]);
    if (!options.sticky) timers.current.set(id, window.setTimeout(() => dismiss(id), DISMISS_MS[kind]));
    return id;
  }, [dismiss]);

  const pause = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer) window.clearTimeout(timer);
    timers.current.delete(id);
  }, []);

  const resume = useCallback((id: number, kind: ToastKind, sticky?: boolean) => {
    if (sticky) return;
    timers.current.set(id, window.setTimeout(() => dismiss(id), DISMISS_MS[kind]));
  }, [dismiss]);

  const api = useMemo<ToastApi>(() => ({
    info: (message) => push('info', message),
    success: (message) => push('success', message),
    error: (message) => push('error', message),
    sticky: (message, action) => {
      const id = push('info', message, { sticky: true, action });
      return () => dismiss(id);
    },
  }), [dismiss, push]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      {toasts.length > 0 && createPortal(
        <div className="toast-stack">
          {toasts.map((toast) => (
            <div
              key={toast.id}
              className={`toast toast--${toast.kind}`}
              role={toast.kind === 'error' ? 'alert' : 'status'}
              onMouseEnter={() => pause(toast.id)}
              onMouseLeave={() => resume(toast.id, toast.kind, toast.sticky)}
            >
              <span className="toast-message">{toast.message}</span>
              {toast.action && (
                <button type="button" className="toast-action" onClick={toast.action.onClick}>
                  {toast.action.label}
                </button>
              )}
              <button type="button" className="toast-close" aria-label="Dismiss" onClick={() => dismiss(toast.id)}>×</button>
            </div>
          ))}
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error('useToast must be used inside ToastProvider');
  return api;
}
