import { createContext, useContext, useCallback, useState, useRef, useMemo, type ReactNode } from 'react';

export type ToastType = 'error' | 'success' | 'info';

export interface Toast {
  id: number;
  message: string;
  type: ToastType;
  /** When the toast was created (ms since epoch) */
  createdAt: number;
}

export interface ToastContextValue {
  toasts: Toast[];
  addToast: (message: string, type?: ToastType) => void;
  removeToast: (id: number) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const MAX_TOASTS = 5;
const DEFAULT_DURATION_MS: Record<ToastType, number> = {
  error: 5000,
  success: 3000,
  info: 4000,
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextIdRef = useRef(0);

  const removeToast = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const addToast = useCallback((message: string, type: ToastType = 'error') => {
    const id = ++nextIdRef.current;
    const toast: Toast = { id, message, type, createdAt: Date.now() };

    setToasts(prev => {
      // Dedupe: if the same message and type already exists, don't add again
      if (prev.some(t => t.message === message && t.type === type)) return prev;
      const next = [...prev, toast];
      // Cap at MAX_TOASTS — remove oldest if we exceed
      return next.length > MAX_TOASTS ? next.slice(next.length - MAX_TOASTS) : next;
    });

    // Auto-dismiss after duration
    const duration = DEFAULT_DURATION_MS[type];
    setTimeout(() => removeToast(id), duration);
  }, [removeToast]);

  const value = useMemo(() => ({ toasts, addToast, removeToast }), [toasts, addToast, removeToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
