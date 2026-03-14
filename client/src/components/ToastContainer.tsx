import { useToast, type Toast, type ToastType } from '../context/ToastContext.js';

const ICON_MAP: Record<ToastType, string> = {
  error: '\u2716',   // ✖
  success: '\u2714', // ✔
  info: '\u2139',    // ℹ
};

const COLOR_MAP: Record<ToastType, { text: string; border: string; bg: string }> = {
  error: {
    text: 'text-[var(--danger)]',
    border: 'border-[var(--danger)]',
    bg: 'bg-[var(--danger-bg)]',
  },
  success: {
    text: 'text-[var(--safe)]',
    border: 'border-[var(--safe)]',
    bg: 'bg-[rgba(40,167,69,0.15)]',
  },
  info: {
    text: 'text-[var(--info)]',
    border: 'border-[var(--info)]',
    bg: 'bg-[var(--info-bg)]',
  },
};

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const colors = COLOR_MAP[toast.type];

  return (
    <div
      role="alert"
      className={`
        glass ${colors.border} ${colors.bg} px-4 py-2.5
        flex items-center gap-2.5 text-sm
        animate-toast-in cursor-pointer
        min-w-[280px] max-w-[min(420px,90vw)]
      `}
      onClick={onDismiss}
    >
      <span className={`${colors.text} text-base flex-shrink-0`} aria-hidden="true">
        {ICON_MAP[toast.type]}
      </span>
      <span className={colors.text}>{toast.message}</span>
    </div>
  );
}

export function ToastContainer() {
  const { toasts, removeToast } = useToast();

  if (toasts.length === 0) return null;

  return (
    <div
      aria-live="polite"
      aria-label="Notifications"
      className="fixed top-[calc(1rem+var(--safe-top))] left-1/2 -translate-x-1/2 z-[9999] flex flex-col items-center gap-2 pointer-events-none"
    >
      {toasts.map(toast => (
        <div key={toast.id} className="pointer-events-auto">
          <ToastItem toast={toast} onDismiss={() => removeToast(toast.id)} />
        </div>
      ))}
    </div>
  );
}
